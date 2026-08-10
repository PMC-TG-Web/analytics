export type ProcoreMeetingRecord = Record<string, unknown>;

export type MeetingSeriesFidelityIssue = {
  type: "series_creation_unsupported" | "series_split_in_target";
  seriesKey: string;
  seriesTitle: string;
  sourceMeetingCount: number;
  matchedTargetCount: number;
  targetGroupCount: number;
  missingSourceMeetingIds: string[];
  message: string;
};

function isRecord(value: unknown): value is ProcoreMeetingRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalized(value: unknown): string {
  return text(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function templateTitle(meeting: ProcoreMeetingRecord): string {
  const template = isRecord(meeting.meeting_template) ? meeting.meeting_template : null;
  return text(template?.title || template?.name);
}

function annotateGroup(group: ProcoreMeetingRecord, groupIndex: number): ProcoreMeetingRecord[] {
  const meetings = Array.isArray(group.meetings) ? group.meetings.filter(isRecord) : [];
  if (meetings.length === 0) return [];

  const root = meetings.find((meeting) => {
    const id = text(meeting.id);
    const parentId = text(meeting.parent_id || meeting.parentId);
    return !parentId || parentId === id;
  });
  const groupId = text(root?.id || meetings[0]?.id) || `group-${groupIndex}`;
  const seriesTitle = text(group.group_title || group.title || group.name)
    || templateTitle(meetings[0])
    || text(meetings[0]?.title)
    || `Meeting series ${groupIndex + 1}`;

  return meetings.map((meeting) => ({
    ...meeting,
    __meeting_series_group_id: groupId,
    __meeting_series_title: seriesTitle,
  }));
}

export function annotateMeetingGroups(payload: unknown): ProcoreMeetingRecord[] {
  if (Array.isArray(payload)) {
    const rows: ProcoreMeetingRecord[] = [];
    payload.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      if (Array.isArray(entry.meetings)) {
        rows.push(...annotateGroup(entry, index));
        return;
      }
      const id = text(entry.id) || `row-${index}`;
      rows.push({
        ...entry,
        __meeting_series_group_id: id,
        __meeting_series_title: templateTitle(entry) || text(entry.title),
      });
    });
    return rows;
  }

  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.meetings)) return annotateGroup(payload, 0);
  if (Array.isArray(payload.data)) return annotateMeetingGroups(payload.data);
  return [];
}

export function meetingIdentityKey(meeting: ProcoreMeetingRecord): string {
  return [
    normalized(meeting.title),
    text(meeting.position),
    text(meeting.starts_at),
    text(meeting.ends_at),
    normalized(meeting.location),
    normalized(meeting.mode),
  ].join("|");
}

export function meetingSeriesKey(meeting: ProcoreMeetingRecord): string {
  return normalized(
    meeting.__meeting_series_title
      || templateTitle(meeting)
      || meeting.title,
  );
}

export function mergeMeetingListMetadata(
  listMeeting: ProcoreMeetingRecord,
  detailMeeting: ProcoreMeetingRecord,
): ProcoreMeetingRecord {
  return { ...listMeeting, ...detailMeeting };
}

function targetGroupId(meeting: ProcoreMeetingRecord): string {
  return text(meeting.__meeting_series_group_id) || text(meeting.id);
}

export function evaluateMeetingSeriesFidelity(params: {
  sourceMeetings: ProcoreMeetingRecord[];
  targetMeetings: ProcoreMeetingRecord[];
  selectedSourceIds: string[];
}) {
  const selectedIds = new Set(params.selectedSourceIds.map(text).filter(Boolean));
  const targetByIdentity = new Map<string, ProcoreMeetingRecord>();
  for (const meeting of params.targetMeetings) {
    const key = meetingIdentityKey(meeting);
    if (key && !targetByIdentity.has(key)) targetByIdentity.set(key, meeting);
  }

  const sourceSeries = new Map<string, ProcoreMeetingRecord[]>();
  const selectedSeriesKeys = new Set<string>();
  for (const meeting of params.sourceMeetings) {
    const key = meetingSeriesKey(meeting);
    if (!key) continue;
    const rows = sourceSeries.get(key) || [];
    rows.push(meeting);
    sourceSeries.set(key, rows);
    if (selectedIds.has(text(meeting.id))) selectedSeriesKeys.add(key);
  }

  const issues: MeetingSeriesFidelityIssue[] = [];
  const series = Array.from(selectedSeriesKeys).map((seriesKey) => {
    const sourceRows = sourceSeries.get(seriesKey) || [];
    const matchedTargets = sourceRows
      .map((meeting) => targetByIdentity.get(meetingIdentityKey(meeting)))
      .filter((meeting): meeting is ProcoreMeetingRecord => Boolean(meeting));
    const missingSourceMeetingIds = sourceRows
      .filter((meeting) => !targetByIdentity.has(meetingIdentityKey(meeting)))
      .map((meeting) => text(meeting.id))
      .filter(Boolean);
    const targetGroupIds = new Set(matchedTargets.map(targetGroupId).filter(Boolean));
    const seriesTitle = text(sourceRows[0]?.__meeting_series_title || sourceRows[0]?.title) || seriesKey;

    if (sourceRows.length > 1 && missingSourceMeetingIds.length > 0) {
      issues.push({
        type: "series_creation_unsupported",
        seriesKey,
        seriesTitle,
        sourceMeetingCount: sourceRows.length,
        matchedTargetCount: matchedTargets.length,
        targetGroupCount: targetGroupIds.size,
        missingSourceMeetingIds,
        message: `Procore's public Meetings API cannot create follow-up meetings or assign a meeting template, so ${seriesTitle} cannot be cloned without splitting its ${sourceRows.length} meetings into separate series.`,
      });
    }

    if (sourceRows.length > 1 && targetGroupIds.size > 1) {
      issues.push({
        type: "series_split_in_target",
        seriesKey,
        seriesTitle,
        sourceMeetingCount: sourceRows.length,
        matchedTargetCount: matchedTargets.length,
        targetGroupCount: targetGroupIds.size,
        missingSourceMeetingIds,
        message: `${seriesTitle} is already split across ${targetGroupIds.size} target series and cannot be repaired through Procore's public Meetings API.`,
      });
    }

    return {
      seriesKey,
      seriesTitle,
      sourceMeetingCount: sourceRows.length,
      matchedTargetCount: matchedTargets.length,
      targetGroupCount: targetGroupIds.size,
      missingSourceMeetingIds,
    };
  });

  return { ready: issues.length === 0, series, issues };
}
