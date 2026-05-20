import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { PIS_PRODUCTS, type PisProduct } from "@/lib/pis/types";

interface CsvRow {
  producto: string;
  celula: string;
  nombre: string;
  descripcion: string;
  hipotesis: string;
  jornadas: string;
}

// Map CSV product names to canonical PIS product names (case-insensitive)
const PRODUCT_MAP: Record<string, PisProduct> = {
  prestay: "PreStay",
  onsite: "OnSite",
  followup: "FollowUp",
  "follow up": "FollowUp",
  "follow-up": "FollowUp",
  online: "Online",
  semantic: "Semantic",
  semántico: "Semantic",
  semantico: "Semantic",
  concierge: "Concierge",
  desk: "Desk",
  transversal: "Transversal",
};

function normalizeProduct(raw: string): PisProduct | null {
  const key = raw.trim().toLowerCase();
  if (PRODUCT_MAP[key]) return PRODUCT_MAP[key];
  // Direct match
  const direct = PIS_PRODUCTS.find(
    (p) => p.toLowerCase() === key
  );
  return direct || null;
}

function parseProducts(raw: string): PisProduct[] {
  // Support comma, semicolon, or pipe separated
  const parts = raw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  const products: PisProduct[] = [];
  for (const part of parts) {
    const p = normalizeProduct(part);
    if (p && !products.includes(p)) products.push(p);
  }
  return products;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\t" || ch === ",") && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { csv, author } = body as { csv: string; author?: string };

    if (!csv) {
      return NextResponse.json({ error: "csv es obligatorio" }, { status: 400 });
    }

    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      return NextResponse.json(
        { error: "El CSV debe tener al menos un encabezado y una fila de datos" },
        { status: 400 }
      );
    }

    // Parse header to detect column positions
    const headerFields = parseCsvLine(lines[0]).map((h) =>
      h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    );

    const colMap = {
      producto: headerFields.findIndex((h) => h.includes("producto")),
      celula: headerFields.findIndex((h) => h.includes("celula")),
      nombre: headerFields.findIndex((h) => h.includes("nombre") || h.includes("iniciativa")),
      descripcion: headerFields.findIndex((h) => h.includes("descripcion")),
      hipotesis: headerFields.findIndex((h) => h.includes("hipotesis")),
      jornadas: headerFields.findIndex((h) => h.includes("jornadas")),
    };

    // Validate required columns
    if (colMap.nombre === -1) {
      return NextResponse.json(
        { error: `Columna 'Nombre iniciativa' no encontrada. Encabezados: ${headerFields.join(", ")}` },
        { status: 400 }
      );
    }

    const results: { line: number; id?: number; error?: string; title: string }[] = [];
    const client = await pool.connect();

    try {
      for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        const title = colMap.nombre >= 0 ? fields[colMap.nombre] || "" : "";
        if (!title) {
          results.push({ line: i + 1, error: "Nombre vacío", title: "" });
          continue;
        }

        const productoRaw = colMap.producto >= 0 ? fields[colMap.producto] || "" : "";
        const products = parseProducts(productoRaw);
        if (products.length === 0 && productoRaw) {
          products.push("Transversal"); // fallback
        } else if (products.length === 0) {
          products.push("Transversal");
        }

        const celula = colMap.celula >= 0 ? fields[colMap.celula] || null : null;
        const descripcion = colMap.descripcion >= 0 ? fields[colMap.descripcion] || "" : "";
        const hipotesis = colMap.hipotesis >= 0 ? fields[colMap.hipotesis] || "" : "";
        const jornadasRaw = colMap.jornadas >= 0 ? fields[colMap.jornadas] || "" : "";
        const jornadas = jornadasRaw ? parseFloat(jornadasRaw.replace(",", ".")) : null;

        try {
          const result = await client.query(
            `INSERT INTO pis_initiatives (title, description, hypothesis, products, author, celula, jornadas)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [title, descripcion, hipotesis, products, author || "", celula, isNaN(jornadas!) ? null : jornadas]
          );
          results.push({ line: i + 1, id: result.rows[0].id, title });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "db_error";
          results.push({ line: i + 1, error: msg, title });
        }
      }
    } finally {
      client.release();
    }

    const created = results.filter((r) => r.id).length;
    const errors = results.filter((r) => r.error).length;

    return NextResponse.json({
      total: results.length,
      created,
      errors,
      results,
    });
  } catch (err) {
    console.error("[PIS Bulk Upload]", err);
    return NextResponse.json({ error: "bulk_upload_failed" }, { status: 500 });
  }
}
