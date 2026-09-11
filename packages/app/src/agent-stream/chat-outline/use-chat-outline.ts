import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AgentTimelinePromptIndexPayload } from "@getpaseo/client/internal/daemon-client";
import { isWeb } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import { useTimelineJump } from "../timeline-jump";
import {
  createActivePromptPublisher,
  resolveActivePromptSeq,
  shouldAcceptPromptIndexEpoch,
  type ActivePromptSource,
  type ChatOutlinePrompt,
} from "./model";

const NO_PROMPTS: ChatOutlinePrompt[] = [];
const NO_STREAM_ITEMS: StreamItem[] = [];

export interface UseChatOutlineInput {
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

export interface ChatOutline {
  prompts: ChatOutlinePrompt[];
  activePrompt: ActivePromptSource;
  jumpToPrompt: (seq: number) => void;
  reportReadingPosition: (rowId: string | null) => void;
}

export function useChatOutline({
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
}: UseChatOutlineInput): ChatOutline {
  const [index, setIndex] = useState<AgentTimelinePromptIndexPayload | null>(null);
  const [activePrompt] = useState(createActivePromptPublisher);
  const readingRowIdRef = useRef<string | null>(null);
  const nextIndexRequestIdRef = useRef(0);
  const loadedItems = useMemo(() => [...tail, ...(head ?? NO_STREAM_ITEMS)], [head, tail]);
  const prompts = enabled ? (index?.prompts ?? NO_PROMPTS) : NO_PROMPTS;
  const jump = useTimelineJump({
    agentId,
    serverId,
    timelineEpoch,
    loadedItems,
    viewportRef,
    visibleItemIds,
    revealLoadedItem,
    onJumpError,
    label: "Chat outline",
  });

  // The viewed timeline already owns live delivery and reconnect catch-up. Its complete
  // loaded items (including rows outside the mounted window) invalidate the prompt index.
  const latestPromptSeq = loadedItems.reduce(
    (latest, item) =>
      item.kind === "user_message" && item.timelineCursor?.epoch === timelineEpoch
        ? Math.max(latest, item.timelineCursor.seq)
        : latest,
    -1,
  );

  useEffect(() => setIndex(null), [agentId, enabled, serverId, timelineEpoch]);

  useEffect(() => {
    if (!isWeb || !enabled) {
      setIndex(null);
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) return;
    let active = true;
    const refresh = () => {
      const requestId = ++nextIndexRequestIdRef.current;
      void client
        .listAgentTimelinePrompts(agentId)
        .then((payload) => {
          if (
            active &&
            requestId === nextIndexRequestIdRef.current &&
            shouldAcceptPromptIndexEpoch(timelineEpoch, payload.epoch)
          ) {
            setIndex(payload);
          }
          return undefined;
        })
        .catch(() => undefined);
    };
    refresh();
    return () => {
      active = false;
    };
  }, [agentId, enabled, serverId, timelineEpoch, latestPromptSeq]);

  // The transcript names the row it is showing; the outline turns that into a prompt using the
  // complete index, so unloaded rows never have to exist in the DOM to be marked.
  const publishActivePrompt = useStableEvent(() => {
    const rowId = readingRowIdRef.current;
    const anchorSeq =
      rowId === null
        ? null
        : (loadedItems.find((item) => item.id === rowId)?.timelineCursor?.seq ?? null);
    activePrompt.publish(resolveActivePromptSeq(prompts, anchorSeq));
  });

  const reportReadingPosition = useStableEvent((rowId: string | null) => {
    readingRowIdRef.current = rowId;
    publishActivePrompt();
  });

  useEffect(() => {
    readingRowIdRef.current = null;
    activePrompt.publish(null);
  }, [activePrompt, agentId, timelineEpoch]);

  // The transcript reports its reading position long before the index arrives, and a reader
  // who never scrolls would otherwise sit on an unmarked rail.
  useEffect(() => {
    publishActivePrompt();
  }, [loadedItems, prompts, publishActivePrompt]);

  const jumpToPrompt = useCallback(
    (seq: number) => {
      jump.jumpTo({ epoch: index?.epoch ?? null, seq });
    },
    [index, jump],
  );

  return { prompts, activePrompt, jumpToPrompt, reportReadingPosition };
}
