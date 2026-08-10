import assert from "node:assert/strict";
import test from "node:test";

import {
  annotateMeetingGroups,
  evaluateMeetingSeriesFidelity,
  meetingIdentityKey,
  meetingSeriesKey,
  mergeMeetingListMetadata,
} from "../src/lib/procoreMeetingSeries.ts";

const sourcePayload = [{
  group_title: "PM Meeting",
  meetings: [
    { id: 12, title: "PM Meeting", position: 2, starts_at: "2026-02-01T15:00:00Z", ends_at: "2026-02-01T16:00:00Z", mode: "minutes", parent_id: 11, meeting_template_id: 50 },
    { id: 11, title: "PM Meeting", position: 1, starts_at: "2026-01-01T15:00:00Z", ends_at: "2026-01-01T16:00:00Z", mode: "minutes", parent_id: null, meeting_template_id: 50 },
  ],
}];

test("meeting list groups retain their series title, root, template, and parent metadata", () => {
  const meetings = annotateMeetingGroups(sourcePayload);
  assert.equal(meetings.length, 2);
  assert.equal(meetingSeriesKey(meetings[0]), "pm meeting");
  assert.equal(meetings[0].__meeting_series_group_id, "11");

  const merged = mergeMeetingListMetadata(meetings[0], { id: 12, title: "PM Meeting", overview: "detail" });
  assert.equal(merged.parent_id, 11);
  assert.equal(merged.meeting_template_id, 50);
  assert.equal(merged.__meeting_series_title, "PM Meeting");
});

test("meeting identity includes position so same-day meetings are not collapsed", () => {
  const [first] = annotateMeetingGroups(sourcePayload);
  assert.notEqual(meetingIdentityKey(first), meetingIdentityKey({ ...first, position: 3 }));
});

test("a recurring source series that is absent from the target is blocked", () => {
  const sourceMeetings = annotateMeetingGroups(sourcePayload);
  const result = evaluateMeetingSeriesFidelity({ sourceMeetings, targetMeetings: [], selectedSourceIds: ["11", "12"] });
  assert.equal(result.ready, false);
  assert.equal(result.issues[0].type, "series_creation_unsupported");
  assert.equal(result.series[0].sourceMeetingCount, 2);
});

test("an already-split target series is detected even when every meeting exists", () => {
  const sourceMeetings = annotateMeetingGroups(sourcePayload);
  const targetMeetings = sourceMeetings.map((meeting) => ({ ...meeting, id: Number(meeting.id) + 100, parent_id: null, meeting_template_id: null, __meeting_series_group_id: String(Number(meeting.id) + 100) }));
  const result = evaluateMeetingSeriesFidelity({ sourceMeetings, targetMeetings, selectedSourceIds: ["11", "12"] });
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.type === "series_split_in_target"));
});

test("an existing target series in one group passes the fidelity check", () => {
  const sourceMeetings = annotateMeetingGroups(sourcePayload);
  const targetMeetings = sourceMeetings.map((meeting) => ({ ...meeting, id: Number(meeting.id) + 100, __meeting_series_group_id: "111" }));
  const result = evaluateMeetingSeriesFidelity({ sourceMeetings, targetMeetings, selectedSourceIds: ["11", "12"] });
  assert.equal(result.ready, true);
  assert.deepEqual(result.issues, []);
});
