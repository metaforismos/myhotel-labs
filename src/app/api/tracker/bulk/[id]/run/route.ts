import { NextRequest, NextResponse } from "next/server";
import { processBulkBatch, BULK_DEFAULT_BATCH } from "@/lib/tracker/bulk-run";

export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let body: { batch_size?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body allowed */
  }

  try {
    const result = await processBulkBatch(id, body.batch_size ?? BULK_DEFAULT_BATCH);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bulk/:id/run]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
