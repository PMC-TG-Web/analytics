import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  out.push(current.trim());
  return out;
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = (cols[c] || '').trim();
    }
    rows.push(row);
  }

  return rows;
}

function normalizeEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  return v || null;
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/\D/g, '');
  return digits ? `${plus}${digits}` : null;
}

async function importEmployees(csvPath) {
  const absolutePath = path.resolve(csvPath);
  const text = await fs.readFile(absolutePath, 'utf8');
  const rows = parseCsv(text);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const firstName = String(row['First Name'] || '').trim();
    const lastName = String(row['Last Name'] || '').trim();
    const jobTitle = String(row['Job Title'] || '').trim() || null;

    if (!firstName || !lastName) {
      skipped += 1;
      continue;
    }

    const businessPhone = normalizePhone(row['Business Phone']);
    const mobilePhone = normalizePhone(row['Mobile Phone']);
    const personalEmail = normalizeEmail(row['Email']);
    const workEmail = normalizeEmail(row['Work Email']);
    const primaryEmail = workEmail || personalEmail;

    const data = {
      firstName,
      lastName,
      jobTitle,
      email: primaryEmail,
      phone: mobilePhone || businessPhone,
      isActive: true,
      customFields: {
        workEmail,
        otherEmail: personalEmail,
        workPhone: businessPhone,
        employeePhone: mobilePhone,
      },
    };

    if (primaryEmail) {
      const existing = await prisma.employee.findUnique({
        where: { email: primaryEmail },
        select: { id: true },
      });

      if (existing) {
        await prisma.employee.update({
          where: { id: existing.id },
          data,
        });
        updated += 1;
      } else {
        await prisma.employee.create({ data });
        created += 1;
      }
      continue;
    }

    const byName = await prisma.employee.findFirst({
      where: { firstName, lastName },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (byName) {
      await prisma.employee.update({
        where: { id: byName.id },
        data,
      });
      updated += 1;
    } else {
      await prisma.employee.create({ data });
      created += 1;
    }
  }

  return { totalRows: rows.length, created, updated, skipped };
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    throw new Error('Usage: node scripts/importEmployeesFromCsv.mjs "path/to/company-directory.csv"');
  }

  const result = await importEmployees(csvPath);
  console.log('Employee import complete:', result);
}

main()
  .catch((error) => {
    console.error('Employee import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
