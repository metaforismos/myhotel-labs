import { NextResponse } from "next/server";
import { runGA4RealFunnelReport, type GA4FunnelStepResult } from "@/lib/analytics/ga4-client";
import { conciergePLGFunnel } from "@/lib/analytics/funnels/concierge-plg";

export const maxDuration = 60;

interface BranchResult {
  id: string;
  title: string;
  steps: GA4FunnelStepResult[];
  totalConversion: number;
}

interface ResponsePayload {
  dateRange: { startDate: string; endDate: string };
  branches: BranchResult[];
  generatedAt: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: ResponsePayload; expiresAt: number }>();

export async function POST(request: Request) {
  let startDate: string;
  let endDate: string;

  try {
    const body = await request.json();
    startDate = body.startDate;
    endDate = body.endDate;
  } catch {
    return NextResponse.json({ error: "[Concierge PLG] invalid body" }, { status: 400 });
  }

  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return NextResponse.json(
      { error: "[Concierge PLG] invalid date — expected YYYY-MM-DD" },
      { status: 400 },
    );
  }

  if (startDate > endDate) {
    return NextResponse.json(
      { error: "[Concierge PLG] startDate must be <= endDate" },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const bypassCache = url.searchParams.get("nocache") === "1";
  const cacheKey = `${startDate}|${endDate}`;

  if (!bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data, { headers: { "x-cache": "HIT" } });
    }
  }

  try {
    const reports = await Promise.all(
      conciergePLGFunnel.branches.map((branch) =>
        runGA4RealFunnelReport({ startDate, endDate, steps: branch.steps }).then((r) => ({
          branch,
          report: r,
        })),
      ),
    );

    const branches: BranchResult[] = reports.map(({ branch, report }) => {
      const last = report.steps[report.steps.length - 1];
      return {
        id: branch.id,
        title: branch.title,
        steps: report.steps,
        totalConversion: last?.conversionFromStart ?? 0,
      };
    });

    const payload: ResponsePayload = {
      dateRange: { startDate, endDate },
      branches,
      generatedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Concierge PLG]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
