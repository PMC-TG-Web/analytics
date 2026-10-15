import test from 'node:test';
import assert from 'node:assert/strict';
import { marketProjectFocus } from '../src/lib/marketProjectFocus.ts';

const project = (description, proposedUse = 'Residential', name = 'Example project', planType = 'Final Land Development Plan') => ({ name, description, proposedUse, planType });
test('commercial focus includes apartments, mixed use, warehouses, stores and institutional building work', () => {
  const examples = [
    project('Construct four new apartment buildings with associated stormwater facilities.'),
    project('Redevelop the site with mixed-use buildings including residential units and commercial space.'),
    project('Expand an existing warehouse and office building.', 'Commercial'),
    project('Construct a retail store with parking.', 'Commercial'),
    project('Construction of a school building.', 'Institutional'),
    project('Construction of a hotel with 145 rooms.', '', 'Business hotel'),
    project('Add a residential garage and a 7200 sf building for woodcraft business.', 'Commercial / Residential'),
    project('Redevelopment with a grain bin, receiving building and flour mill.', 'Agricultural'),
  ];
  for (const example of examples) assert.equal(marketProjectFocus(example).included, true, example.description);
  assert.equal(marketProjectFocus(examples[0]).category, 'Multifamily / mixed use');
  assert.equal(marketProjectFocus(examples[2]).category, 'Industrial / warehouse');
});
test('residential counts alone do not turn houses or townhomes into apartment projects', () => {
  for (const example of [
    project('Subdivide into 100 lots for single-family detached dwellings.'),
    project('Construction of 9 townhomes on an existing site.'),
    project('Construction of a single family dwelling.'),
    project('Construction of a residential garage.'),
    project('Subdivision of 24 lots.', 'Residential', 'Example Townhomes'),
    project('A residential project with 100 units.'),
  ]) assert.equal(marketProjectFocus(example).included, false, example.description);
});
test('site work remains excluded even on commercial or institutional properties', () => {
  for (const example of [
    project('Hill Road Relocation', 'Industrial'),
    project('Construction of an addition to the parking lot located at the existing medical building.', 'Commercial'),
    project('Installation of water and sewer improvements at an airport.', 'Industrial'),
    project('Improvements to the existing stormwater management and HVAC systems.', 'Institutional'),
    project('Construct two synthetic turf fields with fencing.', 'Institutional', 'School turf fields'),
    project('Annexation of a tract between properties.', 'Commercial'),
    project('Install a stormwater culvert at the store.', 'Commercial', 'Example', 'Stormwater Management Plan'),
  ]) assert.equal(marketProjectFocus(example).included, false, example.description);
  assert.equal(marketProjectFocus(project('Consolidation of two lots and construction of a 5400-square-foot addition to the existing church annex building.', 'Institutional')).included, true);
  assert.equal(marketProjectFocus(project('Subdivide and construct five apartment buildings.', 'Residential')).included, true);
});
