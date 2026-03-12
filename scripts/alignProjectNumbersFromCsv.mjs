import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

function parseArgs(argv) {
  const args = { apply: false, file: "C:/Users/ToddGilmore/Downloads/names and numbers.csv" };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token === "--file" && argv[i + 1]) {
      args.file = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeText(value) {
  return (value ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeProjectNumber(value) {
  const clean = (value ?? "").toString().trim().replace(/\s+/g, " ");
  return clean.length > 0 ? clean : null;
}

function mappingKey(customer, projectName) {
  return `${normalizeText(customer)}||${normalizeText(projectName)}`;
}

async function main() {
  const { apply, file } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const csvText = readFileSync(file, "utf8");
    const rows = parseCsv(csvText);
    if (rows.length < 2) {
      throw new Error("CSV appears empty or invalid");
    }

    const header = rows[0].map((h) => h.trim());
    const customerIdx = header.findIndex((h) => h.toLowerCase() === "customer");
    const projectNameIdx = header.findIndex((h) => h.toLowerCase() === "projectname");
    const projectNumberIdx = header.findIndex((h) => h.toLowerCase() === "projectnumber");

    if (customerIdx === -1 || projectNameIdx === -1 || projectNumberIdx === -1) {
      throw new Error("CSV must include headers: customer, projectName, projectNumber");
    }

    const desiredMap = new Map();
    const duplicateConflicts = [];
    let skippedBlankName = 0;

    for (const row of rows.slice(1)) {
      const customer = (row[customerIdx] ?? "").toString().trim();
      const projectName = (row[projectNameIdx] ?? "").toString().trim();
      const projectNumber = normalizeProjectNumber(row[projectNumberIdx]);

      if (!projectName) {
        skippedBlankName += 1;
        continue;
      }

      const key = mappingKey(customer, projectName);
      const existing = desiredMap.get(key);

      if (!existing) {
        desiredMap.set(key, { customer, projectName, projectNumber });
        continue;
      }

      const existingNum = normalizeProjectNumber(existing.projectNumber);
      const incomingNum = normalizeProjectNumber(projectNumber);

      if (existingNum === incomingNum) {
        continue;
      }

      if (!existingNum && incomingNum) {
        desiredMap.set(key, { customer, projectName, projectNumber: incomingNum });
        continue;
      }

      if (existingNum && !incomingNum) {
        continue;
      }

      duplicateConflicts.push({
        customer,
        projectName,
        first: existingNum,
        second: incomingNum,
      });
    }

    const projects = await prisma.project.findMany({
      select: {
        id: true,
        customer: true,
        projectName: true,
        projectNumber: true,
      },
    });

    const statuses = await prisma.status.findMany({
      select: {
        id: true,
        customer: true,
        projectName: true,
        projectNumber: true,
      },
    });

    const projectUpdates = [];
    for (const p of projects) {
      const key = mappingKey(p.customer, p.projectName);
      const desired = desiredMap.get(key);
      if (!desired) continue;

      const currentNum = normalizeProjectNumber(p.projectNumber);
      const desiredNum = normalizeProjectNumber(desired.projectNumber);
      if (currentNum === desiredNum) continue;

      projectUpdates.push({
        id: p.id,
        from: currentNum,
        to: desiredNum,
        customer: p.customer,
        projectName: p.projectName,
      });
    }

    const statusUpdates = [];
    for (const s of statuses) {
      const key = mappingKey(s.customer, s.projectName);
      const desired = desiredMap.get(key);
      if (!desired) continue;

      const currentNum = normalizeProjectNumber(s.projectNumber);
      const desiredNum = normalizeProjectNumber(desired.projectNumber);
      if (currentNum === desiredNum) continue;

      statusUpdates.push({
        id: s.id,
        from: currentNum,
        to: desiredNum,
        customer: s.customer,
        projectName: s.projectName,
      });
    }

    const matchedProjectKeys = new Set(
      projects
        .map((p) => mappingKey(p.customer, p.projectName))
        .filter((key) => desiredMap.has(key))
    );

    const unmatchedCsvKeys = Array.from(desiredMap.keys()).filter((key) => !matchedProjectKeys.has(key));

    console.log("=== Project Number Alignment Preview ===");
    console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`CSV file: ${file}`);
    console.log(`CSV mappings loaded: ${desiredMap.size}`);
    console.log(`CSV rows skipped (blank projectName): ${skippedBlankName}`);
    console.log(`CSV mapping conflicts detected: ${duplicateConflicts.length}`);
    console.log(`Project rows to update: ${projectUpdates.length}`);
    console.log(`Status rows to update: ${statusUpdates.length}`);
    console.log(`CSV mappings not found in Project table: ${unmatchedCsvKeys.length}`);

    if (duplicateConflicts.length > 0) {
      console.log("\nSample mapping conflicts (keeping first non-empty):");
      duplicateConflicts.slice(0, 10).forEach((c) => {
        console.log(`- ${c.customer} | ${c.projectName} => ${c.first} vs ${c.second}`);
      });
    }

    if (projectUpdates.length > 0) {
      console.log("\nSample Project updates:");
      projectUpdates.slice(0, 15).forEach((u) => {
        console.log(`- ${u.customer || ""} | ${u.projectName || ""}: ${u.from || "(blank)"} -> ${u.to || "(blank)"}`);
      });
    }

    if (!apply) {
      console.log("\nDry-run complete. Re-run with --apply to write changes.");
      return;
    }

    for (const update of projectUpdates) {
      await prisma.project.update({
        where: { id: update.id },
        data: { projectNumber: update.to },
      });
    }

    for (const update of statusUpdates) {
      await prisma.status.update({
        where: { id: update.id },
        data: { projectNumber: update.to },
      });
    }

    console.log("\nApply complete.");
    console.log(`Updated Project rows: ${projectUpdates.length}`);
    console.log(`Updated Status rows: ${statusUpdates.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
