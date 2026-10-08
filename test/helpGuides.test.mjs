import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { HELP_GUIDE_SUMMARIES, getHelpGuideSummaryForPath } from '../src/lib/helpGuides/catalog.ts';
import {
  canAccessHelpGuide,
  getHelpGuide,
  groupHelpGuidesByCategory,
  HELP_GUIDES,
  helpGuidePath,
} from '../src/lib/helpGuides/index.ts';
import { findInlineMarkupProblems, inlineToPlainText, parseInline } from '../src/lib/helpGuides/inline.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

function* walkText(blocks) {
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        yield block.text;
        break;
      case 'bullets':
        yield* block.items;
        break;
      case 'steps':
        for (const step of block.items) {
          yield step.title;
          yield* Array.isArray(step.body) ? step.body : [step.body];
        }
        break;
      case 'table':
        yield* block.columns;
        for (const row of block.rows) yield* row;
        break;
      case 'callout':
        yield block.title;
        yield* walkText(block.blocks);
        break;
      case 'columns':
        for (const column of block.columns) {
          yield column.title;
          yield* column.items;
        }
        break;
      default:
        assert.fail(`Unknown block type ${String(block.type)}`);
    }
  }
}

test('every help guide has a unique slug and resolves through the registry', () => {
  const slugs = HELP_GUIDES.map((guide) => guide.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const guide of HELP_GUIDES) {
    assert.match(guide.slug, /^[a-z0-9-]+$/);
    assert.equal(getHelpGuide(guide.slug), guide);
    assert.equal(getHelpGuide(guide.slug.toUpperCase()), guide);
    assert.equal(helpGuidePath(guide), `/help/${guide.slug}`);
  }
  assert.equal(getHelpGuide('does-not-exist'), null);
});

test('every main navigation destination has a complete beginner guide and a real page', () => {
  const navigation = readFileSync(new URL('../src/components/Navigation.tsx', import.meta.url), 'utf8');
  const destinations = [...navigation.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(destinations.length > 25, 'navigation destination extraction must not silently stop working');
  for (const path of destinations.filter((path) => path !== '/help')) {
    assert.ok(getHelpGuideSummaryForPath(path), `missing guide for ${path}`);
  }
  assert.deepEqual(HELP_GUIDE_SUMMARIES.map((g) => g.slug).sort(), HELP_GUIDES.map((g) => g.slug).sort());
  assert.equal(new Set(HELP_GUIDE_SUMMARIES.map((g) => g.pagePath)).size, HELP_GUIDE_SUMMARIES.length);
  for (const guide of HELP_GUIDES) {
    assert.ok(existsSync(new URL(`../src/app${guide.pagePath === '/' ? '' : guide.pagePath}/page.tsx`, import.meta.url)), guide.pagePath);
    assert.ok(guide.quickStart.length > 30, `${guide.slug} needs a useful first action`);
    assert.deepEqual(guide.sections.map((s) => s.id), ['purpose', 'using', 'data', 'reading', 'example', 'checks']);
    assert.ok(guide.sections.find((s) => s.id === 'using').blocks[0].items.length >= 3);
    assert.ok(guide.sections.find((s) => s.id === 'reading').blocks[0].rows.length >= 3);
  }
});

test('contextual help resolves exact pages without leaking into unrelated child routes', () => {
  assert.equal(getHelpGuideSummaryForPath('/procore/commitments-live/maker/').slug, 'commitment-maker');
  assert.equal(getHelpGuideSummaryForPath('/procore/commitments-live').slug, 'commitments');
  assert.equal(getHelpGuideSummaryForPath('/procore/test'), null);
  assert.equal(getHelpGuideSummaryForPath('/help'), null);
  assert.equal(getHelpGuideSummaryForPath('/login'), null);
  assert.equal(getHelpGuideSummaryForPath('/not-a-page'), null);
});

test('guide visibility honors individual permissions, group fallbacks, and signed-in Home access', () => {
  const visible = HELP_GUIDE_SUMMARIES.filter((g) => canAccessHelpGuide(['employees'], g)).map((g) => g.slug);
  assert.deepEqual(visible, ['home', 'employees']);
  assert.equal(canAccessHelpGuide(['PROCORE'], getHelpGuide('commitment-maker')), true);
  assert.equal(canAccessHelpGuide(['analytics'], getHelpGuide('cost-code-profitability')), true);
  assert.equal(canAccessHelpGuide(['kpi'], getHelpGuide('financial-wip')), false);
  for (const guide of HELP_GUIDES) {
    assert.equal(resolvePermissionForPath(`${helpGuidePath(guide)}/`), guide.pagePermission);
    assert.equal(resolvePermissionForPath(`${helpGuidePath(guide)}-unrelated`), null);
  }
  const policy = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(policy, /pathname === '\/help\/home'/, 'Home guide follows signed-in Home policy');
});

test('every help guide is protected by the same permission as the page it describes', () => {
  for (const guide of HELP_GUIDES) {
    assert.equal(
      resolvePermissionForPath(helpGuidePath(guide)),
      guide.pagePermission,
      `${helpGuidePath(guide)} must require ${guide.pagePermission} in permissionRoutes.js`,
    );
    assert.equal(
      resolvePermissionForPath(guide.pagePath),
      guide.pagePermission,
      `${guide.pagePath} permission drifted from guide ${guide.slug}`,
    );
  }
  assert.equal(resolvePermissionForPath('/help'), null, 'the help directory is open to any signed-in user');
});

test('help guide content has well-formed sections and inline markup', () => {
  for (const guide of HELP_GUIDES) {
    assert.ok(guide.sections.length > 0, `${guide.slug} has no sections`);
    const sectionIds = guide.sections.map((section) => section.id);
    assert.equal(new Set(sectionIds).size, sectionIds.length, `${guide.slug} has duplicate section ids`);
    for (const section of guide.sections) {
      const texts = [section.title, section.intro || '', ...walkText(section.blocks)];
      for (const text of texts) {
        assert.deepEqual(findInlineMarkupProblems(text), [], `${guide.slug}/${section.id}`);
      }
      for (const block of section.blocks) {
        if (block.type === 'table') {
          for (const row of block.rows) {
            assert.equal(row.length, block.columns.length, `${guide.slug}/${section.id} table row width`);
          }
        }
      }
    }
  }
});

test('canAccessHelpGuide mirrors page permission and group fallback', () => {
  const guide = getHelpGuide('qbo-project-profitability');
  assert.ok(guide);
  assert.equal(canAccessHelpGuide(['accounting-project-profitability'], guide), true);
  assert.equal(canAccessHelpGuide(['ADMIN', 'admin'], guide), true);
  assert.equal(canAccessHelpGuide(['accounting-direct-cost-bills'], guide), false);
  assert.equal(canAccessHelpGuide([], guide), false);
});

test('groupHelpGuidesByCategory sorts categories and titles', () => {
  const groups = groupHelpGuidesByCategory([
    { ...HELP_GUIDES[0], slug: 'b', title: 'Zeta', category: 'Scheduling' },
    { ...HELP_GUIDES[0], slug: 'a', title: 'Alpha', category: 'Scheduling' },
    { ...HELP_GUIDES[0], slug: 'c', title: 'Mid', category: 'Accounting' },
  ]);
  assert.deepEqual(groups.map((group) => group.category), ['Accounting', 'Scheduling']);
  assert.deepEqual(groups[1].guides.map((guide) => guide.title), ['Alpha', 'Zeta']);
});

test('parseInline handles bold, code, emphasis, and plain text', () => {
  assert.deepEqual(parseInline('Use **Refresh costs**, then `node x.mjs` *now*.'), [
    { kind: 'text', value: 'Use ' },
    { kind: 'bold', value: 'Refresh costs' },
    { kind: 'text', value: ', then ' },
    { kind: 'code', value: 'node x.mjs' },
    { kind: 'text', value: ' ' },
    { kind: 'em', value: 'now' },
    { kind: 'text', value: '.' },
  ]);
  assert.equal(inlineToPlainText('QBO − Procore is **not** an error'), 'QBO − Procore is not an error');
  assert.equal(inlineToPlainText('snake_case_names stay intact'), 'snake_case_names stay intact');
  assert.deepEqual(findInlineMarkupProblems('broken **bold'), ['unbalanced bold markers in: broken **bold']);
});
