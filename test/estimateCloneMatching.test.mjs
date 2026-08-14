import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseEstimateGenericCategoryMapping,
  chooseEstimateMappingByDescriptionPrefix,
  chooseEstimateMappingByGroupCategory,
  estimateCostItemTypeForCostCodeType,
  estimateCostTypeCode,
  estimateCostTypeName,
  estimateGroupCategory,
  normalizeEstimateCloneItemName,
} from '../src/lib/estimateCloneMatching.ts';

function mapping(itemId, costName, description = '') {
  return {
    old: { 'Cost Name': costName, Description: description },
    new: { ItemId: itemId, 'Cost Name': costName },
  };
}

test('estimate group names identify concrete categories', () => {
  assert.equal(estimateGroupCategory('10,728 Sq Ft. - 5" Slab on Grade (Villa A)'), 'sog');
  assert.equal(estimateGroupCategory('329 Sq Ft. - 4" Porch Slabs with Turndowns'), 'sog');
  assert.equal(estimateGroupCategory('Exterior Site Concrete'), 'site');
  assert.equal(estimateGroupCategory('Foundation Footings'), 'foundation');
  assert.equal(estimateGroupCategory('8 - P1 Piers'), 'foundation');
  assert.equal(estimateGroupCategory('4,676 Sq Ft. 4" Sidewalks (Giant)'), 'site');
  assert.equal(estimateGroupCategory('3,922 Sq Ft. - 8" Dock Slabs (Giant)'), 'site');
  assert.equal(estimateGroupCategory('576 Sq Ft. - 6" Dumpster Slab with Turndown'), 'site');
  assert.equal(estimateGroupCategory('Wall WF2'), 'wall');
  assert.equal(estimateGroupCategory('38,345 Sq Ft 6" Warehouse Slab'), 'sog');
  assert.equal(estimateGroupCategory('2 Ea 4" Pit Leveler Bases'), 'sog');
  assert.equal(estimateGroupCategory('48 Sq Ft 2" Pan Steps At Receptionist'), 'sog');
  assert.equal(estimateGroupCategory('40 Sq Ft 4" Stoop At Stair Tower'), 'site');
  assert.equal(estimateGroupCategory('36 Ea Primed Steel Bollards'), 'bollard');
});

test('legacy numeric item prefixes do not prevent a safe name match', () => {
  assert.equal(normalizeEstimateCloneItemName('8. Travel Labor'), 'travel labor');
  assert.equal(normalizeEstimateCloneItemName(' 1. Labor'), 'labor');
});

test('the workbook cost type populates the estimating Cost Type column', () => {
  assert.equal(estimateCostItemTypeForCostCodeType('CON', 'PART'), 'CUSTOM');
  assert.equal(estimateCostTypeName('CON'), 'Concrete');
  assert.equal(estimateCostItemTypeForCostCodeType('E', 'SUBCONTRACTOR'), 'EQUIPMENT');
  assert.equal(estimateCostTypeName('E'), 'Equipment');
  assert.equal(estimateCostItemTypeForCostCodeType('S', 'PART'), 'SUBCONTRACTOR');
  assert.equal(estimateCostTypeName('S'), 'Subcontractors');
  assert.equal(estimateCostTypeCode('Concrete'), 'CON');
  assert.equal(estimateCostTypeCode('equipment'), 'E');
  assert.equal(estimateCostItemTypeForCostCodeType('QC', 'PART'), 'CUSTOM');
  assert.equal(estimateCostTypeName('QC'), 'Quality Control');
  assert.equal(estimateCostTypeName('SVC'), 'Professional Services');
});

test('generic legacy labor and concrete select the category workbook code', () => {
  const matches = [
    { old: { 'Cost Code': '03-300-00-10' }, new: { ItemId: 'foundation-labor', 'Cost Code': '03-300-00-10' } },
    { old: { 'Cost Code': '03-300-20-10' }, new: { ItemId: 'sog-labor', 'Cost Code': '03-300-20-10' } },
    { old: { 'Cost Code': '03-300-20-20' }, new: { ItemId: 'sog-concrete', Name: 'Slab On Grade Concrete', 'Cost Code': '03-300-20-20' } },
    { old: { 'Cost Code': '03-300-20-20' }, new: { ItemId: 'sog-fiber', Name: 'Fiber', 'Cost Code': '03-300-20-20' } },
    { old: { 'Cost Code': '05-100-10-20' }, new: { ItemId: 'bollard-concrete', Name: 'Bollards Concrete', 'Cost Code': '05-100-10-20' } },
  ];

  assert.equal(
    chooseEstimateGenericCategoryMapping(matches, '1. Labor', '38,345 Sq Ft 6" Warehouse Slab')?.new.ItemId,
    'sog-labor'
  );
  assert.equal(
    chooseEstimateGenericCategoryMapping(matches, 'Concrete', '38,345 Sq Ft 6" Warehouse Slab')?.new.ItemId,
    'sog-concrete'
  );
  assert.equal(chooseEstimateGenericCategoryMapping(matches, 'Concrete', 'Miscellaneous'), null);
  assert.equal(
    chooseEstimateGenericCategoryMapping(matches, 'Concrete', '36 Ea Primed Steel Bollards')?.new.ItemId,
    'bollard-concrete'
  );
});

test('group category selects the SOG variant of repeated catalog items', () => {
  const matches = [
    mapping('foundation', 'Foundation Concrete Equipment'),
    mapping('wall', 'Wall Concrete Equipment'),
    mapping('sog', 'SOG Concrete Equipment'),
    mapping('site', 'Site Concrete Equipment'),
  ];

  assert.equal(
    chooseEstimateMappingByGroupCategory(matches, '6,958 Sq Ft. - Garage Slab on Grade')?.new.ItemId,
    'sog'
  );
});

test('description prefix distinguishes 5 gallon from 55 gallon material', () => {
  const matches = [
    mapping('55-gallon', 'Concrete Interior Sealers', 'L&M Curing Compound 55 Gal. / 350 Sq Ft. per Gal.'),
    mapping('5-gallon', 'Concrete Interior Sealers', 'L&M Curing Compound 5 Gal. / 350 Sq Ft. per Gal.'),
  ];

  assert.equal(
    chooseEstimateMappingByDescriptionPrefix(matches, 'L&M Curing Compound 5 Gal.')?.new.ItemId,
    '5-gallon'
  );
});

test('ambiguous descriptions remain unresolved', () => {
  const matches = [
    mapping('sog', 'SOG Concrete Equipment', 'Somero S-840'),
    mapping('site', 'Site Concrete Equipment', 'Somero S-840'),
  ];

  assert.equal(chooseEstimateMappingByDescriptionPrefix(matches, 'Somero S-840'), null);
});
