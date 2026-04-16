import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (typeof body.is_customer === "boolean") {
    values.push(body.is_customer);
    fields.push(`is_customer = $${values.length}`);
  }
  if (typeof body.website_url === "string" || body.website_url === null) {
    values.push(body.website_url);
    fields.push(`website_url = $${values.length}`);
  }
  if (typeof body.category === "string" || body.category === null) {
    values.push(body.category);
    fields.push(`category = $${values.length}`);
  }

  if (!fields.length) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  values.push(id);
  try {
    const res = await pool.query(
      `UPDATE tracker_hotels
       SET ${fields.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, canonical_name, is_customer, website_url, category, updated_at`,
      values
    );
    if (!res.rowCount) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error("[Tracker Hotel PATCH]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
