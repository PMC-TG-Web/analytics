import { HELP_GUIDE_SUMMARIES } from './catalog.ts';
import type { GuideStep, HelpGuide } from './types.ts';

type GuideDetails = {
  purpose: string;
  steps: GuideStep[];
  data: string[];
  terms: [string, string][];
  example: string;
  checks: string[];
};

/** Consistent beginner reading order, with page-specific instructions and definitions. */
export function defineGuide(slug: string, details: GuideDetails): HelpGuide {
  const summary = HELP_GUIDE_SUMMARIES.find((guide) => guide.slug === slug);
  if (!summary) throw new Error(`Missing help catalog entry: ${slug}`);
  return {
    ...summary,
    updated: '2026-10-08',
    sections: [
      { id: 'purpose', title: 'What this page is for', blocks: [{ type: 'paragraph', text: details.purpose }] },
      { id: 'using', title: 'Your first visit', blocks: [{ type: 'steps', items: details.steps }] },
      { id: 'data', title: 'Where the data comes from', blocks: [{ type: 'bullets', items: details.data }] },
      { id: 'reading', title: 'How to read it', blocks: [{ type: 'table', columns: ['Item', 'Meaning and interpretation'], rows: details.terms }] },
      { id: 'example', title: 'Example', intro: 'Illustrative only; these are not current project results.', blocks: [{ type: 'paragraph', text: details.example }] },
      { id: 'checks', title: 'If something looks wrong', blocks: [{ type: 'bullets', items: details.checks }] },
    ],
  };
}
