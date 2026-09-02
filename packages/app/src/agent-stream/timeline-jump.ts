import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "./strategy";

/**
 * Scrolling the transcript to a row named by timeline seq, whether or not that row
 * is loaded. Shared by the chat outline and transcript search: both point at a seq
 * the daemon knows about and the client may not have fetched yet, and a second copy
 * of this would drift from the first.
 *
 * A jump is a small state machine because a fetch, a mount, and a scroll all have to
 * land before it is done: request the window, wait for the row to appear among the
 * loaded items, reveal it if the transcript is holding it back, then scroll.
 */

export interface TimelineJumpTarget {
  /** Null when the caller has no epoch yet: a loaded row still scrolls, a fetch cannot run. */
  epoch: string | null;
  seq: number;
}

export interface UseTimelineJumpInput {
  agentId: string;
  serverId: string;
  timelineEpoch: string | null;
  loadedItems: StreamItem[];
  viewportRef: RefObject<StreamViewportHandle | null>;
  visibleItemIds?: ReadonlySet<string>;
  revealLoadedItem?: (itemId: string) => boolean;
  onJumpError: () => void;
  /** Names the caller in the warning logged when its window fetch fails. */
  label: string;
}

export interface TimelineJump {
  jumpTo: (target: TimelineJumpTarget) => void;
  /** Drops any jump in flight, so a caller can abandon one without starting another. */
  cancel: () => void;
}

interface PendingJump {
  requestId: number;
  seq: number;
  fetchSettled: boolean;
  hasScrolled: boolean;
}

export function useTimelineJump({
  agentId,
  serverId,
  timelineEpoch,
  loadedItems,
  viewportRef,
  visibleItemIds,
  revealLoadedItem,
  onJumpError,
  label,
}: UseTimelineJumpInput): TimelineJump {
  const [pendingJump, setPendingJump] = useState<PendingJump | null>(null);
  const nextJumpRequestIdRef = useRef(0);

  const cancel = useCallback(() => {
    nextJumpRequestIdRef.current += 1;
    setPendingJump(null);
  }, []);

  useEffect(() => {
    nextJumpRequestIdRef.current += 1;
    setPendingJump(null);
  }, [agentId, timelineEpoch]);

  useEffect(() => {
    if (pendingJump === null) return;
    const target = loadedItems.find((item) => item.timelineCursor?.seq === pendingJump.seq);
    if (target) {
      if (pendingJump.hasScrolled) return;
      if (visibleItemIds?.has(target.id) === false) {
        revealLoadedItem?.(target.id);
        return;
      }
      viewportRef.current?.scrollToMessage?.(target.id);
      setPendingJump((current) => {
        if (current?.requestId !== pendingJump.requestId) return current;
        return { ...current, hasScrolled: true };
      });
      return;
    }
    if (pendingJump.fetchSettled) setPendingJump(null);
  }, [loadedItems, pendingJump, revealLoadedItem, viewportRef, visibleItemIds]);

  const jumpTo = useCallback(
    ({ epoch, seq }: TimelineJumpTarget) => {
      nextJumpRequestIdRef.current += 1;
      setPendingJump(null);
      const loaded = loadedItems.find((item) => item.timelineCursor?.seq === seq);
      if (loaded) {
        if (revealLoadedItem?.(loaded.id)) {
          const requestId = nextJumpRequestIdRef.current;
          setPendingJump({ requestId, seq, fetchSettled: true, hasScrolled: false });
          return;
        }
        viewportRef.current?.scrollToMessage?.(loaded.id);
        return;
      }
      if (epoch === null) return;
      const requestId = nextJumpRequestIdRef.current;
      setPendingJump({ requestId, seq, fetchSettled: false, hasScrolled: false });
      void getHostRuntimeStore()
        .fetchAgentTimeline(serverId, agentId, planTimelinePromptJump({ epoch, seq }))
        .catch((error: unknown) => {
          console.warn(`Failed to load a ${label} window`, error);
          onJumpError();
        })
        .finally(() => {
          setPendingJump((current) => {
            if (current?.requestId !== requestId) return current;
            return { ...current, fetchSettled: true };
          });
        });
    },
    [agentId, label, loadedItems, onJumpError, revealLoadedItem, serverId, viewportRef],
  );

  return { jumpTo, cancel };
}
