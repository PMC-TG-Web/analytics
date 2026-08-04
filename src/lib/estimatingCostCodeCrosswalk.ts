import { createRequire } from "node:module";

export type EstimatingCostCodeCatalogEntry = {
  itemName: string;
  costCode: string;
  costName: string;
  description: string;
  reportingGroup: string;
  topLevelGroup: string;
};

export type EstimatingCostCodeCatalogMatch = EstimatingCostCodeCatalogEntry & {
  itemId: string;
};

const require = createRequire(import.meta.url);
const catalog = require("../../config/costCodeCatalog.json") as Record<string, EstimatingCostCodeCatalogEntry>;

export function normalizeEstimatingItemName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function loadEstimatingCostCodeCatalog(): Map<string, EstimatingCostCodeCatalogEntry> {
  return new Map(Object.entries(catalog));
}

function catalogIdentity(entry: EstimatingCostCodeCatalogEntry): string {
  return [entry.costCode, entry.reportingGroup, entry.topLevelGroup].join("|");
}

export function loadEstimatingCostCodeAliasCatalog(): Map<string, EstimatingCostCodeCatalogMatch[]> {
  const aliases = new Map<string, EstimatingCostCodeCatalogMatch[]>();
  for (const [itemId, entry] of Object.entries(catalog)) {
    for (const value of [entry.itemName, entry.costName, entry.description]) {
      const alias = normalizeEstimatingItemName(value);
      if (!alias) continue;
      const matches = aliases.get(alias) ?? [];
      if (!matches.some((match) => match.itemId === itemId)) matches.push({ itemId, ...entry });
      aliases.set(alias, matches);
    }
  }
  return aliases;
}

export function resolveEstimatingCostCodeAliases(
  values: unknown[],
  aliases = loadEstimatingCostCodeAliasCatalog(),
  categoryHint = "",
): EstimatingCostCodeCatalogMatch | null {
  const scores = new Map<string, { match: EstimatingCostCodeCatalogMatch; score: number }>();
  for (const value of values) {
    const alias = normalizeEstimatingItemName(value);
    if (!alias) continue;
    for (const match of aliases.get(alias) ?? []) {
      const current = scores.get(match.itemId) ?? { match, score: 0 };
      current.score += 1;
      scores.set(match.itemId, current);
    }
  }
  if (!scores.size) return null;

  const normalizedHint = normalizeEstimatingItemName(categoryHint);
  const ranked = [...scores.values()].map((candidate) => ({
    ...candidate,
    hinted: normalizedHint
      && normalizeEstimatingItemName(`${candidate.match.topLevelGroup} ${candidate.match.reportingGroup}`).includes(normalizedHint),
  }));
  const hinted = ranked.filter((candidate) => candidate.hinted);
  const pool = hinted.length ? hinted : ranked;
  const bestScore = Math.max(...pool.map((candidate) => candidate.score));
  const best = pool.filter((candidate) => candidate.score === bestScore);
  const identities = new Map(best.map((candidate) => [catalogIdentity(candidate.match), candidate.match]));
  return identities.size === 1 ? [...identities.values()][0] : null;
}

export function loadEstimatingCostCodeNameCatalog(): Map<string, EstimatingCostCodeCatalogEntry> {
  const entriesByName = new Map<string, EstimatingCostCodeCatalogEntry[]>();
  for (const entry of Object.values(catalog)) {
    const name = normalizeEstimatingItemName(entry.itemName);
    if (!name) continue;
    const entries = entriesByName.get(name) ?? [];
    entries.push(entry);
    entriesByName.set(name, entries);
  }

  const uniqueEntries = new Map<string, EstimatingCostCodeCatalogEntry>();
  for (const [name, entries] of entriesByName) {
    const identities = new Set(entries.map(catalogIdentity));
    if (identities.size === 1) uniqueEntries.set(name, entries[0]);
  }
  return uniqueEntries;
}