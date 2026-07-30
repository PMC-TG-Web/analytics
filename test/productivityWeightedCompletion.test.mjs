import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateWeightedCompletion,
  classifyProductivityCompletionLine,
  normalizeProductivityCompletionUom,
} from "../src/lib/productivityWeightedCompletion.ts";

const line = (description, expectedQuantity, usedQuantity, uom = "EA", costCode = null) => ({
  description,
  expectedQuantity,
  usedQuantity,
  uom,
  costCode,
});

test("concrete, reinforcing, and other commitment lines are classified", () => {
  assert.equal(classifyProductivityCompletionLine(line("Slab On Grade Concrete", 100, 50, "CY")), "concrete");
  assert.equal(classifyProductivityCompletionLine(line("Wire Mesh 6 ga", 100, 50, "EA", "03-200-50-20")), "rebar");
  assert.equal(classifyProductivityCompletionLine(line("Vapor Barrier", 100, 50)), "other");
});

test("known concrete cost codes override inconsistent EA units", () => {
  for (const costCode of [
    "03-300-30-20",
    "03-300-20-20",
    "03-300-10-20",
    "03-300-00-20",
    "05-100-10-20",
  ]) {
    assert.equal(
      classifyProductivityCompletionLine(line("Legacy commitment line", 100, 50, "EA", costCode)),
      "concrete",
      costCode,
    );
    assert.equal(
      normalizeProductivityCompletionUom(line("Legacy commitment line", 100, 50, "EA", costCode)),
      "CY",
      costCode,
    );
  }
});

test("fiber remains eaches and is excluded from concrete yards", () => {
  for (const [description, sourceUom, costCode] of [
    ["Fiber - SOG", "ea", "03-300-20-20"],
    ["Fiber - Site", "CY", "03-300-30-20"],
    ["non-taxable SOG fiber", "ls", "03-300-20-20"],
  ]) {
    const fiber = line(description, 100, 50, sourceUom, costCode);
    assert.equal(classifyProductivityCompletionLine(fiber), "other", description);
    assert.equal(normalizeProductivityCompletionUom(fiber), "EA", description);
  }
});

test("EA sealers and repair products are not production concrete by description alone", () => {
  assert.equal(
    classifyProductivityCompletionLine(line("Concrete Repair Epoxy", 10, 0, "EA", "03-150-10-85")),
    "other",
  );
  assert.equal(
    classifyProductivityCompletionLine(line("Concrete Sealer 5 gal", 10, 0, "EA", "03-300-40-40")),
    "other",
  );
});

test("project major categories collectively receive eighty percent", () => {
  const result = calculateWeightedCompletion({
    lines: [
      line("Slab On Grade Concrete", 100, 50, "CY"),
      line("#4 Rebar", 100, 25, "EA", "03-200-30-20"),
      line("Vapor Barrier", 100, 100),
    ],
    labor: [{ expectedHours: 100, totalHours: 75 }],
  });

  assert.equal(result.breakdown.length, 4);
  assert.deepEqual(
    result.breakdown.map(({ category, weight }) => [category, Number(weight.toFixed(6))]),
    [
      ["concrete", 0.266667],
      ["rebar", 0.266667],
      ["labor", 0.266667],
      ["other", 0.2],
    ],
  );
  assert.equal(Number(result.ratio.toFixed(6)), 0.6);
});

test("PO completion uses concrete and rebar for eighty percent without labor", () => {
  const result = calculateWeightedCompletion({
    lines: [
      line("Ready Mix Concrete", 100, 50, "CY"),
      line("#5 Rebar", 100, 100, "EA", "03-200-10-20"),
      line("Forms", 100, 25, "SF"),
    ],
  });

  assert.equal(Number(result.ratio.toFixed(6)), 0.65);
  assert.deepEqual(
    result.breakdown.map(({ category, weight }) => [category, weight]),
    [["concrete", 0.4], ["rebar", 0.4], ["other", 0.2]],
  );
});

test("missing categories redistribute their share without penalizing completion", () => {
  const onlyConcrete = calculateWeightedCompletion({
    lines: [line("Foundation Concrete", 100, 50, "CY")],
  });
  assert.equal(onlyConcrete.ratio, 0.5);
  assert.deepEqual(onlyConcrete.breakdown.map(({ category, weight }) => [category, weight]), [["concrete", 1]]);

  const onlyOther = calculateWeightedCompletion({
    lines: [line("Vapor Barrier", 100, 25)],
  });
  assert.equal(onlyOther.ratio, 0.25);
  assert.deepEqual(onlyOther.breakdown.map(({ category, weight }) => [category, weight]), [["other", 1]]);
});

test("completion is capped at one hundred percent", () => {
  const result = calculateWeightedCompletion({
    lines: [line("Site Concrete", 100, 140, "CY")],
    labor: [{ expectedHours: 10, totalHours: 14 }],
  });
  assert.equal(result.ratio, 1);
});
