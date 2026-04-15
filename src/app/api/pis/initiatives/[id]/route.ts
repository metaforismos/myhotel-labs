import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const initId = parseInt(id, 10);
  if (isNaN(initId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM pis_initiatives WHERE id = $1`,
      [initId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ initiative: result.rows[0] });
  } catch (err) {
    console.error("[PIS Initiative GET]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const initId = parseInt(id, 10);
  if (isNaN(initId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { title, description, hypothesis, products, author, celula, jornadas } = body;

    const result = await pool.query(
      `UPDATE pis_initiatives
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           hypothesis = COALESCE($3, hypothesis),
           products = COALESCE($4, products),
           author = COALESCE($5, author),
           celula = COALESCE($6, celula),
           jornadas = COALESCE($7, jornadas),
           pis_score = NULL,
           scoring_result = NULL,
           model_used = NULL,
           scored_at = NULL,
           status = 'draft',
           updated_at = NOW()
       WHERE id = $8
       RETURNING id, updated_at`,
      [title, description, hypothesis, products, author, celula, jornadas, initId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("[PIS Initiative PUT]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const initId = parseInt(id, 10);
  if (isNaN(initId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    await pool.query(
      `UPDATE pis_initiatives SET status = 'archived', updated_at = NOW() WHERE id = $1`,
      [initId]
    );
    return NextResponse.json({ archived: true });
  } catch (err) {
    console.error("[PIS Initiative DELETE]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
