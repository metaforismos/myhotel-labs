import type { GA4FunnelStep } from "@/lib/analytics/ga4-client";

export interface PLGFunnelBranch {
  id: string;
  title: string;
  steps: GA4FunnelStep[];
}

export interface PLGFunnelSpec {
  id: string;
  title: string;
  description: string;
  branches: PLGFunnelBranch[];
}

const sharedStep: GA4FunnelStep = {
  name: "Abre Concierge",
  eventName: "navigation_sidebar_click",
  paramFilters: [{ paramName: "product", stringValue: "concierge" }],
};

export const conciergePLGFunnel: PLGFunnelSpec = {
  id: "concierge-plg",
  title: "Concierge PLG Funnel",
  description:
    "Conversión desde la vista del producto Concierge hasta reservar demo o probar el free trial por WhatsApp.",
  branches: [
    {
      id: "demo",
      title: "Reservar demo",
      steps: [
        sharedStep,
        { name: "Click Agendar demo", eventName: "lead_generation_click" },
      ],
    },
    {
      id: "trial",
      title: "Free trial",
      steps: [
        sharedStep,
        { name: "Click Probar Concierge", eventName: "free_trial_start_click" },
        { name: "Envía teléfono (WhatsApp)", eventName: "lead_form_submission" },
      ],
    },
  ],
};
