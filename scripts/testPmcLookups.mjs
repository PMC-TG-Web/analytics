import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

function normalize(value) {
  return (value ?? "").toString().trim().replace(/^"+|"+$/g, "").trim().toLowerCase();
}

async function main() {
  // Load all mappings
  const mappings = await p.pmcGroupMapping.findMany({
    select: { costItemNorm: true, costTypeNorm: true, pmcGroup: true, costItem: true },
  });
  console.log(`Loaded ${mappings.length} mappings\n`);

  // Load a sample of PO descriptions
  const details = await p.purchaseOrderLineItemContractDetail.findMany({
    where: { description: { not: null } },
    take: 2000,
    select: { description: true, costType: true, quantity: true },
  });
  console.log(`Testing against ${details.length} PO line item descriptions\n`);

  let exactMatches = 0;
  let fuzzyMatches = 0;
  let noMatches = 0;
  const noMatchSamples = [];
  const matchSamples = [];

  for (const detail of details) {
    const descNorm = normalize(detail.description);
    const costTypeNorm = normalize(detail.costType);

    const exact = mappings.filter((m) => m.costItemNorm === descNorm);
    const fuzzy = exact.length
      ? []
      : mappings.filter(
          (m) =>
            m.costItemNorm.split(/\s+/).length >= 2 &&
            (descNorm.includes(m.costItemNorm) || m.costItemNorm.includes(descNorm))
        );
    const candidates = exact.length ? exact : fuzzy;

    if (!candidates.length) {
      noMatches++;
      if (noMatchSamples.length < 10) noMatchSamples.push(detail.description);
      continue;
    }

    const withType = candidates.filter((c) => c.costTypeNorm && c.costTypeNorm === costTypeNorm);
    const chosen = withType.length ? withType[0] : candidates[0];

    if (exact.length) {
      exactMatches++;
      if (matchSamples.length < 5) {
        matchSamples.push({ desc: detail.description, mapped: chosen.pmcGroup, type: "exact" });
      }
    } else {
      fuzzyMatches++;
      if (matchSamples.length < 10) {
        matchSamples.push({ desc: detail.description, mapped: chosen.pmcGroup, matchedOn: chosen.costItem, type: "fuzzy" });
      }
    }
  }

  const total = exactMatches + fuzzyMatches + noMatches;
  console.log("=== MATCH RESULTS ===");
  console.log(`Exact matches:  ${exactMatches} (${((exactMatches / total) * 100).toFixed(1)}%)`);
  console.log(`Fuzzy matches:  ${fuzzyMatches} (${((fuzzyMatches / total) * 100).toFixed(1)}%)`);
  console.log(`No match:       ${noMatches} (${((noMatches / total) * 100).toFixed(1)}%)`);
  console.log(`Total tested:   ${total}\n`);

  console.log("=== SAMPLE MATCHES ===");
  for (const s of matchSamples) {
    if (s.type === "exact") {
      console.log(`  [EXACT] "${s.desc}" → ${s.mapped}`);
    } else {
      console.log(`  [FUZZY] "${s.desc}" → ${s.mapped}  (via: "${s.matchedOn}")`);
    }
  }

  console.log("\n=== SAMPLE NO-MATCHES (first 10 unmatched descriptions) ===");
  for (const d of noMatchSamples) {
    console.log(`  "${d}"`);
  }
}

main().catch(console.error).finally(() => p.$disconnect());
