import assert from "node:assert/strict";
import test from "node:test";
import { excludeMarkedQboProjects } from "../src/lib/qboProjectExclusionFilter.ts";

test("QBO project exclusions persist by customer ID across snapshots", () => {
  const exclusions = new Set(["101"]);
  const oldSnapshot = [
    { qboCustomerId: "101", projectName: "Finished project" },
    { qboCustomerId: "202", projectName: "Current project" },
  ];
  const newSnapshot = [
    { qboCustomerId: "101", projectName: "Finished project" },
    { qboCustomerId: "202", projectName: "Current project" },
    { qboCustomerId: "303", projectName: "New project" },
  ];

  assert.deepEqual(excludeMarkedQboProjects(oldSnapshot, exclusions), [oldSnapshot[1]]);
  assert.deepEqual(excludeMarkedQboProjects(newSnapshot, exclusions), [newSnapshot[1], newSnapshot[2]]);
});

test("QBO project exclusion matching normalizes surrounding ID whitespace", () => {
  const rows = [{ qboCustomerId: " 101 " }, { qboCustomerId: "202" }];
  assert.deepEqual(excludeMarkedQboProjects(rows, ["101"]), [rows[1]]);
});
