import type { AgentTimelineSearchHit } from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

/**
 * Find-in-transcript over one agent's timeline. This is a find bar, not the
 * ranked recall that history search does: the user is looking for a phrase they
 * already read, so matching is literal and hits come back in transcript order.
 * Ranking them by relevance would make "next match" jump around the session.
 *
 * The whole timeline lives in memory for a loaded agent, so a scan is cheaper
 * than an index that would have to be invalidated on every appended row.
 */

/** One character matches nearly every row, which is noise rather than a result. */
export const MIN_TIMELINE_SEARCH_QUERY_LENGTH = 2;
export const DEFAULT_TIMELINE_SEARCH_LIMIT = 200;
export const MAX_TIMELINE_SEARCH_LIMIT = 500;

const PREVIEW_LEAD = 48;
const PREVIEW_MAX_LENGTH = 220;
const ELLIPSIS = "…";
/** Per row, so one `cat` of a large file cannot dominate the scan. */
const TOOL_CALL_TEXT_BUDGET = 20_000;

export interface TimelineSearchOptions {
  includeToolCalls?: boolean;
  limit?: number;
}

export interface TimelineSearchResult {
  hits: AgentTimelineSearchHit[];
  truncated: boolean;
}

type SearchableKind = AgentTimelineSearchHit["kind"];

interface SearchableRow {
  kind: SearchableKind;
  text: string;
}

/**
 * Lowercase without moving any offset. A few code points — Turkish dotted
 * capital I, German sharp S — lowercase to more than one, which would slide
 * every match offset after them, so those are left as they are.
 */
function foldCase(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;

  let folded = "";
  for (const character of text) {
    const lowered = character.toLowerCase();
    folded += lowered.length === character.length ? lowered : character;
  }
  return folded;
}

/**
 * String leaves of a tool call detail, walked rather than enumerated per detail
 * variant: the variants change with every provider, and a switch here would
 * silently stop searching the ones it had not been taught.
 */
function collectStrings(value: unknown, budget: number, out: string[]): number {
  if (budget <= 0) return 0;
  if (typeof value === "string") {
    const slice = value.length > budget ? value.slice(0, budget) : value;
    out.push(slice);
    return slice.length;
  }
  if (Array.isArray(value)) {
    let spent = 0;
    for (const entry of value) {
      spent += collectStrings(entry, budget - spent, out);
      if (spent >= budget) break;
    }
    return spent;
  }
  if (typeof value === "object" && value !== null) {
    let spent = 0;
    for (const entry of Object.values(value)) {
      spent += collectStrings(entry, budget - spent, out);
      if (spent >= budget) break;
    }
    return spent;
  }
  return 0;
}

function searchableRow(item: AgentTimelineItem, includeToolCalls: boolean): SearchableRow | null {
  switch (item.type) {
    case "user_message":
      return { kind: "user_message", text: item.text };
    case "assistant_message":
      return { kind: "assistant_message", text: item.text };
    case "reasoning":
      return { kind: "reasoning", text: item.text };
    case "error":
      return { kind: "error", text: item.message };
    case "tool_call": {
      if (!includeToolCalls) return null;
      const parts: string[] = [item.name];
      collectStrings(item.detail, TOOL_CALL_TEXT_BUDGET, parts);
      return { kind: "tool_call", text: parts.join("\n") };
    }
    default:
      return null;
  }
}

/** Non-overlapping, so "aa" reports two hits in "aaaa" rather than three. */
function matchOffsets(haystack: string, needle: string): number[] {
  const offsets: number[] = [];
  let position = 0;
  for (;;) {
    const found = haystack.indexOf(needle, position);
    if (found === -1) return offsets;
    offsets.push(found);
    position = found + needle.length;
  }
}

interface CollapsedWindow {
  text: string;
  /** Collapsed offset for each source offset, or -1 where the character was dropped. */
  offsets: number[];
}

/**
 * Collapses whitespace for display while recording where every surviving
 * character moved to, so a match found in the raw text can still be marked in
 * the preview the client renders.
 */
function collapseWindow(window: string): CollapsedWindow {
  const offsets = Array.from({ length: window.length }, () => -1);
  let text = "";
  let pendingSpace = false;
  for (let index = 0; index < window.length; index += 1) {
    const character = window[index];
    if (/\s/.test(character)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += " ";
      pendingSpace = false;
    }
    offsets[index] = text.length;
    text += character;
  }
  return { text, offsets };
}

function buildHit(input: {
  row: AgentTimelineRow;
  kind: SearchableKind;
  text: string;
  offsets: readonly number[];
  queryLength: number;
}): AgentTimelineSearchHit {
  const { row, kind, text, offsets, queryLength } = input;
  const firstMatch = offsets[0];
  const windowStart = Math.max(0, firstMatch - PREVIEW_LEAD);
  const windowEnd = Math.min(text.length, windowStart + PREVIEW_MAX_LENGTH);
  const window = text.slice(windowStart, windowEnd);
  const collapsed = collapseWindow(window);

  const lead = windowStart > 0 ? ELLIPSIS : "";
  const trail = windowEnd < text.length ? ELLIPSIS : "";
  const shift = lead.length;

  const ranges: AgentTimelineSearchHit["ranges"] = [];
  for (const offset of offsets) {
    const start = offset - windowStart;
    const end = start + queryLength;
    if (start < 0 || start >= collapsed.offsets.length) continue;

    let markStart = -1;
    let markEnd = -1;
    for (let index = start; index < Math.min(end, collapsed.offsets.length); index += 1) {
      const mapped = collapsed.offsets[index];
      if (mapped === -1) continue;
      if (markStart === -1) markStart = mapped;
      markEnd = mapped;
    }
    if (markStart === -1) continue;
    ranges.push({ start: markStart + shift, length: markEnd - markStart + 1 });
  }

  return {
    seq: row.seq,
    timestamp: row.timestamp,
    kind,
    preview: `${lead}${collapsed.text}${trail}`,
    ranges,
    matchCount: offsets.length,
  };
}

export function searchTimelineRows(
  query: string,
  rows: readonly AgentTimelineRow[],
  options: TimelineSearchOptions = {},
): TimelineSearchResult {
  const needle = foldCase(query.trim());
  if (needle.length < MIN_TIMELINE_SEARCH_QUERY_LENGTH) {
    return { hits: [], truncated: false };
  }

  const includeToolCalls = options.includeToolCalls === true;
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_TIMELINE_SEARCH_LIMIT, 1),
    MAX_TIMELINE_SEARCH_LIMIT,
  );

  const hits: AgentTimelineSearchHit[] = [];
  for (const row of rows) {
    const searchable = searchableRow(row.item, includeToolCalls);
    if (!searchable || !searchable.text) continue;

    const offsets = matchOffsets(foldCase(searchable.text), needle);
    if (offsets.length === 0) continue;

    if (hits.length >= limit) {
      return { hits, truncated: true };
    }
    hits.push(
      buildHit({
        row,
        kind: searchable.kind,
        text: searchable.text,
        offsets,
        queryLength: needle.length,
      }),
    );
  }

  return { hits, truncated: false };
}
