import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  try {
    let query = `SELECT id, title, products, author, celula, jornadas, status, pis_score,
                        scoring_result, model_used, scored_at, created_at, updated_at
                 FROM pis_initiatives`;
    const values: string[] = [];

    if (status && status !== "all") {
      query += ` WHERE status = $1`;
      values.push(status);
    } else {
      query += ` WHERE status != 'archived'`;
    }

    query += ` ORDER BY pis_score DESC NULLS LAST, created_at DESC`;

    const result = await pool.query(query, values);
    return NextResponse.json({ initiatives: result.rows });
  } catch (err) {
    console.error("[PIS Initiatives GET]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, hypothesis, products, author, celula, jornadas, status: reqStatus } = body;

    if (!title || !description || !hypothesis || !products?.length) {
      return NextResponse.json(
        { error: "Campos obligatorios: title, description, hypothesis, products" },
        { status: 400 }
      );
    }

    // Allow "pre-evaluacion" from public form, default to "draft" for internal
    const initStatus = reqStatus === "pre-evaluacion" ? "pre-evaluacion" : "draft";

    const result = await pool.query(
      `INSERT INTO pis_initiatives (title, description, hypothesis, products, author, celula, jornadas, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [title, description, hypothesis, products, author || "", celula || null, jornadas || null, initStatus]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("[PIS Initiatives POST]", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
