import type { HelpGuide } from './types.ts';
import { qboProjectProfitabilityGuide } from './qboProjectProfitability.ts';

export type { GuideBlock, GuideSection, GuideStep, HelpGuide } from './types.ts';

/**
 * Registry of all help guides. To document another page:
 * 1. add a `<page>.ts` guide module in this folder and list it here;
 * 2. add a `/help/<slug>` rule to PATH_PERMISSION_RULES in permissionRoutes.js
 *    using the same permission as the described page (test/helpGuides.test.mjs enforces this);
 * 3. optionally link to `/help/<slug>` from the page header ("How this page works").
 */
export const HELP_GUIDES: readonly HelpGuide[] = [
  qboProjectProfitabilityGuide,
];

export function getHelpGuide(slug: string): HelpGuide | null {
  const normalized = String(slug || '').trim().toLowerCase();
  return HELP_GUIDES.find((guide) => guide.slug === normalized) || null;
}

export function helpGuidePath(guide: Pick<HelpGuide, 'slug'>): string {
  return `/help/${guide.slug}`;
}

/** Mirrors Navigation's canAccessLink: the page permission or its group fallback. */
export function canAccessHelpGuide(expandedPermissions: readonly string[], guide: HelpGuide): boolean {
  const has = (permission: string) => expandedPermissions.some(
    (assigned) => assigned.toLowerCase() === permission.toLowerCase(),
  );
  return has(guide.pagePermission) || (Boolean(guide.fallbackPermission) && has(guide.fallbackPermission as string));
}

export function groupHelpGuidesByCategory(guides: readonly HelpGuide[]): Array<{ category: string; guides: HelpGuide[] }> {
  const groups = new Map<string, HelpGuide[]>();
  for (const guide of guides) {
    const list = groups.get(guide.category) || [];
    list.push(guide);
    groups.set(guide.category, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, list]) => ({
      category,
      guides: [...list].sort((left, right) => left.title.localeCompare(right.title)),
    }));
}
