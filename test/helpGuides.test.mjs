import test from 'node:test';
import assert from 'node:assert/strict';
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
