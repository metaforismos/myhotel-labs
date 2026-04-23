import { BetaAnalyticsDataClient, v1alpha } from "@google-analytics/data";

let client: BetaAnalyticsDataClient | null = null;
let alphaClient: v1alpha.AlphaAnalyticsDataClient | null = null;

function readCredentials(): Record<string, unknown> {
  const credentialsJson = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) {
    throw new Error("GA4_SERVICE_ACCOUNT_JSON env var is not set");
  }
  return JSON.parse(credentialsJson);
}

function getClient(): BetaAnalyticsDataClient {
  if (client) return client;
  client = new BetaAnalyticsDataClient({ credentials: readCredentials() });
  return client;
}

function getAlphaClient(): v1alpha.AlphaAnalyticsDataClient {
  if (alphaClient) return alphaClient;
  alphaClient = new v1alpha.AlphaAnalyticsDataClient({ credentials: readCredentials() });
  return alphaClient;
}

export function getPropertyId(): string {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error("GA4_PROPERTY_ID env var is not set");
  return id;
}

export interface GA4QueryParams {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dimensionFilter?: Record<string, unknown>;
  orderBys?: Record<string, unknown>[];
  limit?: number;
}

// Validate that a dimensionFilter has the structure GA4 API expects.
// A valid filter node must have exactly one of: filter, andGroup, orGroup, notExpression.
// If the LLM produces something invalid, we drop it to avoid API errors.
function sanitizeFilter(f: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!f || typeof f !== "object") return undefined;

  // Valid single filter: { filter: { fieldName, stringFilter|inListFilter|numericFilter|betweenFilter } }
  if (f.filter && typeof f.filter === "object") {
    const filter = f.filter as Record<string, unknown>;
    if (!filter.fieldName) return undefined;
    if (filter.stringFilter || filter.inListFilter || filter.numericFilter || filter.betweenFilter) {
      return { filter: f.filter };
    }
    return undefined;
  }

  // Valid group: { andGroup: { expressions: [...] } } or { orGroup: { expressions: [...] } }
  for (const groupKey of ["andGroup", "orGroup"] as const) {
    if (f[groupKey] && typeof f[groupKey] === "object") {
      const group = f[groupKey] as Record<string, unknown>;
      if (Array.isArray(group.expressions) && group.expressions.length > 0) {
        const validExpressions = group.expressions
          .map((expr: unknown) => sanitizeFilter(expr as Record<string, unknown>))
          .filter(Boolean);
        if (validExpressions.length > 0) {
          return { [groupKey]: { expressions: validExpressions } };
        }
      }
      return undefined;
    }
  }

  // Valid not: { notExpression: { ... } }
  if (f.notExpression && typeof f.notExpression === "object") {
    const inner = sanitizeFilter(f.notExpression as Record<string, unknown>);
    return inner ? { notExpression: inner } : undefined;
  }

  return undefined;
}

export async function runGA4Report(params: GA4QueryParams) {
  const analyticsClient = getClient();
  const propertyId = getPropertyId();

  const dimensionFilter = sanitizeFilter(params.dimensionFilter);

  const [response] = await analyticsClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: params.dateRanges,
    dimensions: params.dimensions,
    metrics: params.metrics,
    ...(dimensionFilter ? { dimensionFilter } : {}),
    orderBys: params.orderBys,
    limit: params.limit ?? 100,
  });

  return response;
}

// Funnel reports use the Alpha client which may not be available.
// For the POC, we simulate funnels using sequential standard reports.
export async function runGA4FunnelReport(params: {
  dateRanges: { startDate: string; endDate: string }[];
  funnelSteps: { name: string; filterExpression: Record<string, unknown> }[];
}) {
  // Run a standard report with eventName dimension to approximate funnel
  const analyticsClient = getClient();
  const propertyId = getPropertyId();

  const [response] = await analyticsClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: params.dateRanges,
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    limit: 50,
  });

  return response;
}

// ---------- Real sequenced funnel (v1alpha) ----------

export interface GA4FunnelStep {
  name: string;
  eventName: string;
  paramFilters?: { paramName: string; stringValue: string }[];
}

export interface GA4FunnelStepResult {
  name: string;
  users: number;
  conversionFromPrev: number;   // 0..1
  conversionFromStart: number;  // 0..1
  dropoffFromPrev: number;      // 0..1
}

export interface GA4FunnelRequest {
  startDate: string;
  endDate: string;
  steps: GA4FunnelStep[];
}

function buildFunnelStep(step: GA4FunnelStep) {
  const paramFilters = step.paramFilters ?? [];
  const funnelEventFilter: Record<string, unknown> = { eventName: step.eventName };

  if (paramFilters.length > 0) {
    const expressions = paramFilters.map((p) => ({
      funnelParameterFilter: {
        eventParameterName: p.paramName,
        stringFilter: { matchType: "EXACT" as const, value: p.stringValue },
      },
    }));
    funnelEventFilter.funnelParameterFilterExpression =
      expressions.length === 1 ? expressions[0] : { andGroup: { expressions } };
  }

  return {
    name: step.name,
    filterExpression: { funnelEventFilter },
  };
}

// Fallback note: if runFunnelReport is ever deprecated from the alpha surface,
// replace with sequential runReport calls grouped by eventName with totalUsers —
// less accurate (no enforced sequencing) but uses the stable beta API.
export async function runGA4RealFunnelReport(
  req: GA4FunnelRequest,
): Promise<{ steps: GA4FunnelStepResult[] }> {
  const analyticsClient = getAlphaClient();
  const propertyId = getPropertyId();

  const request = {
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
    funnel: {
      isOpenFunnel: false,
      steps: req.steps.map(buildFunnelStep),
    },
    funnelVisualizationType: "STANDARD_FUNNEL" as const,
  };

  const [response] = await analyticsClient.runFunnelReport(request);

  // Response has funnelVisualization (primary) and funnelTable.
  // Each row: dimensionValues = [stepName or stepIndex, ...], metricValues = [activeUsers]
  const sub = response.funnelVisualization ?? response.funnelTable;
  const rows = sub?.rows ?? [];

  // Sum users per step name across any extra dimensions (e.g., date for trended).
  // For STANDARD_FUNNEL the step dimension is typically `funnelStepName`.
  const usersByStepName = new Map<string, number>();
  for (const row of rows) {
    const stepNameVal = row.dimensionValues?.[0]?.value ?? "";
    const userCount = Number(row.metricValues?.[0]?.value ?? 0);
    usersByStepName.set(stepNameVal, (usersByStepName.get(stepNameVal) ?? 0) + userCount);
  }

  // Match back to the requested step order. GA4 typically returns step names
  // prefixed with "1. ", "2. ", etc. Try both exact and suffix match.
  const resolveUsers = (stepName: string, index: number): number => {
    if (usersByStepName.has(stepName)) return usersByStepName.get(stepName) ?? 0;
    const prefixed = `${index + 1}. ${stepName}`;
    if (usersByStepName.has(prefixed)) return usersByStepName.get(prefixed) ?? 0;
    for (const [key, value] of usersByStepName) {
      if (key.endsWith(stepName) || key === stepName) return value;
    }
    return 0;
  };

  const firstUsers = resolveUsers(req.steps[0].name, 0);

  const steps: GA4FunnelStepResult[] = req.steps.map((s, i) => {
    const users = resolveUsers(s.name, i);
    const prevUsers = i === 0 ? users : resolveUsers(req.steps[i - 1].name, i - 1);
    const conversionFromPrev = prevUsers > 0 ? users / prevUsers : 0;
    const conversionFromStart = firstUsers > 0 ? users / firstUsers : 0;
    const dropoffFromPrev = i === 0 ? 0 : 1 - conversionFromPrev;
    return {
      name: s.name,
      users,
      conversionFromPrev,
      conversionFromStart,
      dropoffFromPrev,
    };
  });

  return { steps };
}

export async function getGA4Metadata() {
  const analyticsClient = getClient();
  const propertyId = getPropertyId();

  const [response] = await analyticsClient.getMetadata({
    name: `properties/${propertyId}/metadata`,
  });

  return {
    dimensions: response.dimensions?.map((d) => ({
      apiName: d.apiName ?? "",
      uiName: d.uiName ?? "",
      description: d.description ?? "",
      category: d.category ?? "",
    })) ?? [],
    metrics: response.metrics?.map((m) => ({
      apiName: m.apiName ?? "",
      uiName: m.uiName ?? "",
      description: m.description ?? "",
      category: m.category ?? "",
      type: m.type ?? "",
    })) ?? [],
  };
}
