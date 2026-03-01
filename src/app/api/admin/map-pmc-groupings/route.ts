import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export const dynamic = 'force-dynamic';

type CsvRow = {
  customer?: string;
  projectNumber?: string;
  projectName?: string;
  PMCGroup?: string;
  hours?: string;
  sales?: string;
};

function normalize(value: unknown) {
  return (value ?? '').toString().trim().toLowerCase();
}

function cleanText(value: unknown) {
  const text = (value ?? '').toString().trim();
  return text.length ? text : null;
}

function parseNumber(value: unknown) {
  if (value === undefined || value === null) return 0;
  const cleaned = value.toString().replace(/[$,\s]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeKey(customer: unknown, projectNumber: unknown, projectName: unknown) {
  return `${normalize(customer)}|${normalize(projectNumber)}|${normalize(projectName)}`;
}

function choosePrimaryGroup(groupTotals: Record<string, number>) {
  const entries = Object.entries(groupTotals);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export async function POST() {
  try {
    const csvPath = path.join(process.cwd(), 'Bid_Distro-Preconstruction-Enriched.csv');
    if (!fs.existsSync(csvPath)) {
      return NextResponse.json(
        { success: false, error: 'Bid_Distro-Preconstruction-Enriched.csv not found' },
        { status: 400 }
      );
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const rows = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_quotes: true,
    }) as CsvRow[];

    const mapByTriple = new Map<string, Record<string, number>>();
    const mapByCustomerName = new Map<string, Record<string, number>>();

    for (const row of rows) {
      const customer = cleanText(row.customer);
      const projectNumber = cleanText(row.projectNumber);
      const projectName = cleanText(row.projectName);
      const pmcGroup = cleanText(row.PMCGroup);

      if (!customer || !projectName || !pmcGroup) continue;

      const hours = parseNumber(row.hours);
      const weight = hours;

      if (weight <= 0) continue;

      const keyTriple = makeKey(customer, projectNumber, projectName);
      const keyCustomerName = makeKey(customer, '', projectName);

      if (!mapByTriple.has(keyTriple)) mapByTriple.set(keyTriple, {});
      if (!mapByCustomerName.has(keyCustomerName)) mapByCustomerName.set(keyCustomerName, {});

      const tripleGroups = mapByTriple.get(keyTriple)!;
      tripleGroups[pmcGroup] = (tripleGroups[pmcGroup] || 0) + weight;

      const customerNameGroups = mapByCustomerName.get(keyCustomerName)!;
      customerNameGroups[pmcGroup] = (customerNameGroups[pmcGroup] || 0) + weight;
    }

    const projects = await prisma.project.findMany({
      select: {
        id: true,
        customer: true,
        projectNumber: true,
        projectName: true,
        customFields: true,
      },
    });

    let updated = 0;
    let mappedByTriple = 0;
    let mappedByCustomerName = 0;
    let unmapped = 0;

    for (const project of projects) {
      const keyTriple = makeKey(project.customer, project.projectNumber, project.projectName);
      const keyCustomerName = makeKey(project.customer, '', project.projectName);

      let breakdown = mapByTriple.get(keyTriple);
      let source = 'triple';

      if (!breakdown || Object.keys(breakdown).length === 0) {
        breakdown = mapByCustomerName.get(keyCustomerName);
        source = 'customer+name';
      }

      if (!breakdown || Object.keys(breakdown).length === 0) {
        unmapped += 1;
        continue;
      }

      const pmcGroup = choosePrimaryGroup(breakdown);
      const existingCustomFields =
        project.customFields && typeof project.customFields === 'object' && !Array.isArray(project.customFields)
          ? (project.customFields as Record<string, unknown>)
          : {};

      await prisma.project.update({
        where: { id: project.id },
        data: {
          customFields: {
            ...existingCustomFields,
            pmcGroup,
            pmcBreakdown: breakdown,
            pmcMappingSource: source,
          },
        },
      });

      if (source === 'triple') mappedByTriple += 1;
      if (source === 'customer+name') mappedByCustomerName += 1;
      updated += 1;
    }

    return NextResponse.json({
      success: true,
      data: {
        csvRows: rows.length,
        projectsScanned: projects.length,
        projectsUpdated: updated,
        mappedByTriple,
        mappedByCustomerName,
        unmapped,
      },
    });
  } catch (error) {
    console.error('Failed to map PMC groupings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to map PMC groupings' },
      { status: 500 }
    );
  }
}
