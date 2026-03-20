import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const projectId = searchParams.get("projectId") || "598134326278124";
    const startDate = searchParams.get("startDate") || "2025-08-01";
    const endDate =
      searchParams.get("endDate") || new Date().toISOString().split("T")[0];
    const page = Math.max(Number(searchParams.get("page") || "1"), 1);
    const perPage = Math.min(
      Math.max(Number(searchParams.get("perPage") || "50"), 1),
      200
    );

    const where: Prisma.ProductivityLogWhereInput = {
      date: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      },
      OR: [
        {
          customFields: {
            path: ["procoreProjectId"],
            equals: projectId,
          },
        },
        {
          jobKey: projectId,
        },
      ],
    };

    const [total, logs] = await Promise.all([
      prisma.productivityLog.count({ where }),
      prisma.productivityLog.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    const rows = logs.map((log) => {
      const custom = (log.customFields ?? {}) as Record<string, unknown>;
      const original = (custom.originalData ?? {}) as Record<string, unknown>;
      const createdBy = (original.created_by ?? {}) as Record<string, unknown>;
      const unpackedPaths = Array.isArray(custom.unpackedPaths) ? custom.unpackedPaths : [];
      const unpackedScalarFields =
        custom.unpackedScalarFields && typeof custom.unpackedScalarFields === "object"
          ? custom.unpackedScalarFields
          : {};
      const unpackedJsonFields =
        custom.unpackedJsonFields && typeof custom.unpackedJsonFields === "object"
          ? custom.unpackedJsonFields
          : {};

      return {
        id: log.id,
        date: log.date,
        procoreId: custom.procoreId ?? null,
        status: original.status ?? null,
        company: original.company ?? null,
        contract: original.contract ?? null,
        lineItemDescription: original.line_item_description ?? null,
        quantityUsed: original.quantity_used ?? null,
        quantityDelivered: original.quantity_delivered ?? null,
        previouslyUsed: original.previously_used ?? null,
        previouslyDelivered: original.previously_delivered ?? null,
        notes: (original.notes as string | null) ?? log.notes ?? null,
        createdByName: createdBy.name ?? null,
        createdByLogin: createdBy.login ?? null,
        unpackedFieldCount:
          typeof custom.unpackedFieldCount === "number" ? custom.unpackedFieldCount : unpackedPaths.length,
        unpackedPaths,
        unpackedScalarFields,
        unpackedJsonFields,
        raw: original,
      };
    });

    return NextResponse.json({
      success: true,
      projectId,
      startDate,
      endDate,
      page,
      perPage,
      total,
      totalPages: Math.max(Math.ceil(total / perPage), 1),
      count: rows.length,
      logs: rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch productivity logs from database",
        details: message,
      },
      { status: 500 }
    );
  }
}
