import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
// Allow larger payloads for bulk CSV imports (2000+ rows)
export const maxDuration = 60;

type MappingInput = {
  costItem?: string;
  costType?: string | null;
  pmcGroup?: string;
  source?: string | null;
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function esc(value: string) {
  return value.replace(/'/g, "''");
}

function toPayload(row: MappingInput) {
  const costItem = clean(row.costItem);
  const costType = clean(row.costType);
  const pmcGroup = clean(row.pmcGroup);

  if (!costItem || !pmcGroup) return null;

  return {
    id: crypto.randomUUID(),
    costItem,
    costType: costType || null,
    pmcGroup,
    costItemNorm: normalize(costItem),
    costTypeNorm: normalize(costType),
    source: clean(row.source) || "manual",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = clean(searchParams.get("query"));
    const limit = Math.min(500, Math.max(1, Number.parseInt(searchParams.get("limit") || "200", 10) || 200));

    const rows = await prisma.pmcGroupMapping.findMany({
      where: query
        ? {
            OR: [
              { costItem: { contains: query, mode: "insensitive" } },
              { costType: { contains: query, mode: "insensitive" } },
              { pmcGroup: { contains: query, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ costItem: "asc" }, { costType: "asc" }, { pmcGroup: "asc" }],
      take: limit,
    });

    return NextResponse.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error("Failed to fetch PMC mappings:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch mappings" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      rows?: MappingInput[];
      row?: MappingInput;
      replaceAll?: boolean;
    };

    const inputRows = Array.isArray(body.rows) ? body.rows : body.row ? [body.row] : [];
    const prepared = inputRows.map(toPayload).filter((r): r is NonNullable<ReturnType<typeof toPayload>> => Boolean(r));

    if (!prepared.length) {
      return NextResponse.json({ success: false, error: "No valid mapping rows supplied" }, { status: 400 });
    }

    if (body.replaceAll) {
      // Fast path: delete all then bulk insert (skipDuplicates handles CSV-internal duplicates from trailing spaces)
      await prisma.pmcGroupMapping.deleteMany();
      await prisma.pmcGroupMapping.createMany({ data: prepared, skipDuplicates: true });
      return NextResponse.json({ success: true, upserted: prepared.length });
    }

    // Incremental path: bulk raw upsert via raw SQL for speed
    const now = new Date().toISOString();
    const chunks = [];
    const CHUNK_SIZE = 200;
    for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
      chunks.push(prepared.slice(i, i + CHUNK_SIZE));
    }
    for (const chunk of chunks) {
      const values = chunk
        .map(
          (r) =>
            `('${r.id ?? ""}','${esc(r.costItem)}','${esc(r.costType ?? "")}','${esc(r.pmcGroup)}','${esc(r.costItemNorm)}','${esc(r.costTypeNorm)}','${esc(r.source ?? "manual")}','${now}','${now}')`
        )
        .join(",");
      await prisma.$executeRawUnsafe(`
        INSERT INTO "PmcGroupMapping" (id,"costItem","costType","pmcGroup","costItemNorm","costTypeNorm",source,"createdAt","updatedAt")
        VALUES ${values}
        ON CONFLICT ("costItem","costTypeNorm","pmcGroup")
        DO UPDATE SET
          "costItem" = EXCLUDED."costItem",
          "costType" = EXCLUDED."costType",
          source = EXCLUDED.source,
          "updatedAt" = EXCLUDED."updatedAt"
      `);
    }

    return NextResponse.json({ success: true, upserted: prepared.length });
  } catch (error) {
    console.error("Failed to upsert PMC mappings:", error);
    return NextResponse.json({ success: false, error: "Failed to upsert mappings" }, { status: 500 });
  }
}
