import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { isWeb } from "@/constants/platform";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import { useTimelineJump } from "../timeline-jump";
import {
  isSearchableQuery,
  normalizeSearchQuery,
  resolveInitialHitIndex,
  shouldAcceptSearchResponse,
  stepHitIndex,
  TIMELINE_SEARCH_DEBOUNCE_MS,
  type TimelineSearchHit,
} from "./model";

const NO_HITS: TimelineSearchHit[] = [];
const NO_STREAM_ITEMS: StreamItem[] = [];

export interface UseTimelineSearchInput {
  agentId: string;
  serverId: string;
  timelineEpoch: string | null;
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  enabled: boolean;
  viewportRef: RefObject<StreamViewportHandle | null>;
  onJumpError: () => void;
  visibleItemIds?: ReadonlySet<string>;
  revealLoadedItem?: (itemId: string) => boolean;
}

export interface TimelineSearch {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  query: string;
  setQuery: (query: string) => void;
  hits: TimelineSearchHit[];
  /** Index into `hits`, or -1 when there is nothing to be on. */
  activeIndex: number;
  goToHit: (index: number) => void;
  goToNextHit: () => void;
  goToPreviousHit: () => void;
  isSearching: boolean;
  /** The daemon stopped counting at its limit; the hit list is a prefix. */
  truncated: boolean;
  failed: boolean;
}

interface SearchResult {
  query: string;
  epoch: string;
  hits: TimelineSearchHit[];
  truncated: boolean;
  failed: boolean;
}

const EMPTY_RESULT: SearchResult = {
  query: "",
  epoch: "",
  hits: NO_HITS,
  truncated: false,
  failed: false,
};

export function useTimelineSearch({
  agentId,
  serverId,
  timelineEpoch,
  tail,
  head,
  enabled,
  viewportRef,
  onJumpError,
  visibleItemIds,
  revealLoadedItem,
}: UseTimelineSearchInput): TimelineSearch {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [result, setResult] = useState<SearchResult>(EMPTY_RESULT);
  const [isSearching, setIsSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const nextRequestIdRef = useRef(0);
  const loadedItems = useMemo(() => [...tail, ...(head ?? NO_STREAM_ITEMS)], [head, tail]);

  const jump = useTimelineJump({
    agentId,
    serverId,
    timelineEpoch,
    loadedItems,
    viewportRef,
    visibleItemIds,
    revealLoadedItem,
    onJumpError,
    label: "transcript search",
  });

  const isActive = enabled && isOpen;
  const hits = isActive ? result.hits : NO_HITS;

  // A new session, or a rewritten timeline, invalidates every seq the hits point at.
  useEffect(() => {
    nextRequestIdRef.current += 1;
    setResult(EMPTY_RESULT);
    setActiveIndex(-1);
    setIsSearching(false);
  }, [agentId, timelineEpoch]);

  useEffect(() => {
    if (!isActive) return;
    const trimmed = normalizeSearchQuery(query);
    if (!isSearchableQuery(trimmed)) {
      nextRequestIdRef.current += 1;
      setResult(EMPTY_RESULT);
      setActiveIndex(-1);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const requestId = ++nextRequestIdRef.current;
    const timer = setTimeout(() => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        setIsSearching(false);
        setResult({ ...EMPTY_RESULT, query: trimmed, failed: true });
        return;
      }
      void client
        .searchAgentTimeline(agentId, trimmed)
        .then((payload) => {
          if (requestId !== nextRequestIdRef.current) return undefined;
          if (!shouldAcceptSearchResponse(trimmed, payload.query)) return undefined;
          setResult({
            query: payload.query,
            epoch: payload.epoch,
            hits: payload.hits,
            truncated: payload.truncated,
            failed: false,
          });
          setActiveIndex(resolveInitialHitIndex(payload.hits.length));
          setIsSearching(false);
          return undefined;
        })
        .catch((error: unknown) => {
          if (requestId !== nextRequestIdRef.current) return;
          console.warn("Failed to search the transcript", error);
          setResult({ ...EMPTY_RESULT, query: trimmed, failed: true });
          setActiveIndex(-1);
          setIsSearching(false);
        });
    }, TIMELINE_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [agentId, isActive, query, serverId]);

  const goToHit = useCallback(
    (index: number) => {
      const hit = hits[index];
      if (!hit) return;
      setActiveIndex(index);
      jump.jumpTo({ epoch: result.epoch || timelineEpoch, seq: hit.seq });
    },
    [hits, jump, result.epoch, timelineEpoch],
  );

  const goToNextHit = useCallback(() => {
    if (hits.length === 0) return;
    goToHit(stepHitIndex(hits.length, activeIndex, 1));
  }, [activeIndex, goToHit, hits.length]);

  const goToPreviousHit = useCallback(() => {
    if (hits.length === 0) return;
    goToHit(stepHitIndex(hits.length, activeIndex < 0 ? 0 : activeIndex, -1));
  }, [activeIndex, goToHit, hits.length]);

  // Native has no way to scroll to an unloaded row yet, so the bar never opens there.
  const open = useCallback(() => {
    if (!enabled || !isWeb) return;
    setIsOpen(true);
  }, [enabled]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQueryState("");
    nextRequestIdRef.current += 1;
    setResult(EMPTY_RESULT);
    setActiveIndex(-1);
    setIsSearching(false);
    jump.cancel();
  }, [jump]);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
  }, []);

  // A host that stops advertising the feature must not leave a dead bar on screen.
  useEffect(() => {
    if (!enabled) setIsOpen(false);
  }, [enabled]);

  return {
    isOpen: isActive,
    open,
    close,
    query,
    setQuery,
    hits,
    activeIndex,
    goToHit,
    goToNextHit,
    goToPreviousHit,
    isSearching: isActive && isSearching,
    truncated: isActive && result.truncated,
    failed: isActive && result.failed,
  };
}
