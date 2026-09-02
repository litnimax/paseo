import type { TimelineSearch } from "./use-timeline-search";

export interface TranscriptFindBarProps {
  search: TimelineSearch;
}

// Finding a match is only half of it: the other half is scrolling to a row that may
// not be loaded, which only the web transcript can do. Native renders nothing.
export function TranscriptFindBar(_props: TranscriptFindBarProps): null {
  return null;
}
