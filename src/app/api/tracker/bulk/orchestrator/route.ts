import { NextResponse } from "next/server";
import {
  getOrchestratorState,
  startOrchestrator,
  stopOrchestrator,
} from "@/lib/tracker/bulk-orchestrator";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getOrchestratorState());
}

export async function POST() {
  const r = startOrchestrator();
  return NextResponse.json(r);
}

export async function DELETE() {
  const r = stopOrchestrator();
  return NextResponse.json(r);
}
