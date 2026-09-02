import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { searchTimelineRows } from "./timeline-search.js";

function row(seq: number, item: AgentTimelineItem): AgentTimelineRow {
  return { seq, timestamp: `2026-01-01T00:00:0${seq}.000Z`, item };
}

describe("searchTimelineRows", () => {
  it("returns hits in transcript order across message kinds", () => {
    const rows = [
      row(1, { type: "user_message", text: "please fix the parser" }),
      row(2, { type: "reasoning", text: "the parser is recursive" }),
      row(3, { type: "assistant_message", text: "fixed the parser" }),
      row(4, { type: "todo", items: [] }),
      row(5, { type: "error", message: "parser crashed" }),
    ];

    const result = searchTimelineRows("parser", rows);

    expect(result.truncated).toBe(false);
    expect(result.hits.map((hit) => [hit.seq, hit.kind])).toEqual([
      [1, "user_message"],
      [2, "reasoning"],
      [3, "assistant_message"],
      [5, "error"],
    ]);
  });

  it("matches case-insensitively and marks every occurrence in the preview", () => {
    const rows = [row(1, { type: "assistant_message", text: "Parser and parser" })];

    const [hit] = searchTimelineRows("PARSER", rows).hits;

    expect(hit.preview).toBe("Parser and parser");
    expect(hit.ranges).toEqual([
      { start: 0, length: 6 },
      { start: 11, length: 6 },
    ]);
    expect(hit.matchCount).toBe(2);
  });

  it("marks the match after whitespace in the row has been collapsed", () => {
    const rows = [row(1, { type: "user_message", text: "hello\n\n   world" })];

    const [hit] = searchTimelineRows("world", rows).hits;

    expect(hit.preview).toBe("hello world");
    expect(hit.preview.slice(hit.ranges[0].start, hit.ranges[0].start + hit.ranges[0].length)).toBe(
      "world",
    );
  });

  it("windows a long row around the first match and marks it there", () => {
    const filler = "x".repeat(400);
    const rows = [row(1, { type: "assistant_message", text: `${filler} needle ${filler}` })];

    const [hit] = searchTimelineRows("needle", rows).hits;

    expect(hit.preview.startsWith("…")).toBe(true);
    expect(hit.preview.endsWith("…")).toBe(true);
    expect(hit.preview.slice(hit.ranges[0].start, hit.ranges[0].start + hit.ranges[0].length)).toBe(
      "needle",
    );
  });

  it("counts occurrences the preview window cannot show", () => {
    const filler = "x".repeat(400);
    const rows = [row(1, { type: "assistant_message", text: `needle ${filler} needle` })];

    const [hit] = searchTimelineRows("needle", rows).hits;

    expect(hit.matchCount).toBe(2);
    expect(hit.ranges).toHaveLength(1);
  });

  it("skips tool calls unless they are asked for", () => {
    const rows = [
      row(1, {
        type: "tool_call",
        callId: "call-1",
        name: "Bash",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "grep needle src", output: "needle found" },
      }),
    ];

    expect(searchTimelineRows("needle", rows).hits).toEqual([]);

    const [hit] = searchTimelineRows("needle", rows, { includeToolCalls: true }).hits;
    expect(hit.kind).toBe("tool_call");
    expect(hit.matchCount).toBe(2);
  });

  it("ignores a query below the minimum length", () => {
    const rows = [row(1, { type: "user_message", text: "a b c" })];

    expect(searchTimelineRows("a", rows).hits).toEqual([]);
    expect(searchTimelineRows("   ", rows).hits).toEqual([]);
  });

  it("stops at the limit and says so", () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      row(index + 1, { type: "assistant_message", text: "needle" }),
    );

    const result = searchTimelineRows("needle", rows, { limit: 3 });

    expect(result.hits).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("counts overlapping candidates once", () => {
    const rows = [row(1, { type: "assistant_message", text: "aaaa" })];

    expect(searchTimelineRows("aa", rows).hits[0].matchCount).toBe(2);
  });
});
