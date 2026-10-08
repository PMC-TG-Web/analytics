import type { HelpGuide } from './types.ts';
import { qboProjectProfitabilityGuide } from './qboProjectProfitability.ts';
import { reportGuides, productivityGuides } from './reportGuides.ts';
import { projectGuides } from './projectGuides.ts';
import { operationsGuides } from './operationsGuides.ts';
import { peopleGuides } from './peopleGuides.ts';
import { adminGuides } from './adminGuides.ts';

export type { GuideBlock, GuideSection, GuideStep, HelpGuide, HelpGuideSummary } from './types.ts';
export { HELP_GUIDE_SUMMARIES, canAccessHelpGuide, groupHelpGuidesByCategory, helpGuidePath } from './catalog.ts';

// Add catalog metadata, detailed content, and the matching permission route together.
export const HELP_GUIDES: readonly HelpGuide[] = [
  ...operationsGuides, ...projectGuides, ...reportGuides, ...productivityGuides,
  qboProjectProfitabilityGuide, ...peopleGuides, ...adminGuides,
];

export function getHelpGuide(slug: string): HelpGuide | null {
  const normalized = String(slug || '').trim().toLowerCase();
  return HELP_GUIDES.find((guide) => guide.slug === normalized) || null;
}
