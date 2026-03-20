import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function getCF(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
}

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, projectName: true, status: true, projectArchived: true, customFields: true },
    take: 100000,
  });

  let total = 0;
  let active = 0;
  let hasPmc = 0;
  let noPmc = 0;
  let noMatch = 0;
  let mapped = 0;
  const sampleMissing = [];

  for (const p of projects) {
    total++;
    if (p.projectArchived) continue;
    active++;

    const cf = getCF(p.customFields);
    const pmcGroup = cf.pmcGroup;
    const source = cf.pmcMappingSource;

    if (pmcGroup == null || pmcGroup === "") {
      noPmc++;
      if (sampleMissing.length < 20) sampleMissing.push({ id: p.id, projectName: p.projectName, status: p.status, source });
      continue;
    }

    hasPmc++;
    if (pmcGroup === "No Match") noMatch++;
    else mapped++;
  }

  console.log(JSON.stringify({
    totalProjects: total,
    activeProjects: active,
    activeWithPmcGroup: hasPmc,
    activeWithoutPmcGroup: noPmc,
    mapped,
    noMatch,
    sampleMissing,
  }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
