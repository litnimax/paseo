import type { AgentTimelineSearchPayload } from "@getpaseo/client/internal/daemon-client";

export type TimelineSearchHit = AgentTimelineSearchPayload["hits"][number];

/** Matches the daemon's floor, so the client never asks for a result it would refuse. */
export const MIN_TIMELINE_SEARCH_QUERY_LENGTH = 2;

/** Long enough that typing a word is one request, short enough to feel live. */
export const TIMELINE_SEARCH_DEBOUNCE_MS = 150;

export function normalizeSearchQuery(query: string): string {
  return query.trim();
}

export function isSearchableQuery(query: string): boolean {
  return normalizeSearchQuery(query).length >= MIN_TIMELINE_SEARCH_QUERY_LENGTH;
}

/**
 * A response is stale when the user has typed on since it was sent. The query is
 * echoed rather than compared by request id because the daemon coalesces nothing:
 * the newest query the user typed is the only one whose hits may be shown.
 */
export function shouldAcceptSearchResponse(current: string, responded: string): boolean {
  return normalizeSearchQuery(current) === normalizeSearchQuery(responded);
}

/**
 * Wraps, because a find bar that stops at the last match makes the user re-aim at
 * the top of a transcript they are reading bottom-up.
 */
export function stepHitIndex(hitCount: number, current: number, delta: 1 | -1): number {
  if (hitCount <= 0) return 0;
  return (((current + delta) % hitCount) + hitCount) % hitCount;
}

/**
 * Which hit a fresh result set should land on. Results arrive as the user types, so
 * holding position would mean the highlight walks backwards through the transcript
 * while the query narrows; starting at the first hit keeps it moving one way.
 */
export function resolveInitialHitIndex(hitCount: number): number {
  return hitCount > 0 ? 0 : -1;
}
