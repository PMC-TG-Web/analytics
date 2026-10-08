/**
 * Content model for in-app help guides.
 *
 * Every guide is plain data so the same source renders the /help web pages
 * and can be verified in tests without React.
 * Inline text supports a tiny markup subset: **bold**, *emphasis*, `code`.
 */

export type GuideStep = {
  title: string;
  /** A single paragraph, or a bullet list when an array is supplied. */
  body: string | string[];
};

export type GuideBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'steps'; items: GuideStep[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'callout'; title: string; blocks: GuideBlock[] }
  | { type: 'columns'; columns: Array<{ title: string; items: string[] }> };

export type GuideSection = {
  id: string;
  title: string;
  intro?: string;
  blocks: GuideBlock[];
};

export type HelpGuideSummary = {
  /** URL segment under /help. */
  slug: string;
  /** Guide title, e.g. "QBO P&L". */
  title: string;
  /** Navigation group shown in the directory. */
  category: string;
  /** One or two sentences for the directory card. */
  summary: string;
  /** One practical first action, shown before opening the full guide. */
  quickStart: string;
  /** Path of the page the guide describes. */
  pagePath: string;
  /** Navigation label of that page. */
  pageLabel: string;
  /** Page permission required for the described page (and this guide). */
  pagePermission: string;
  /** Group permission that also grants access, mirroring Navigation fallbackPage. */
  fallbackPermission?: string;
};

export type HelpGuide = HelpGuideSummary & {
  /** ISO date of the last content review, shown on the guide. */
  updated: string;
  sections: GuideSection[];
};
