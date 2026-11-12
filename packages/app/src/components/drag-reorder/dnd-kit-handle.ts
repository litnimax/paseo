import { useRef } from "react";
import type { Modifier } from "@dnd-kit/core";

// Shared by every dnd-kit list in the sidebar, so they activate, constrain and memoize alike.
// dnd-kit hands out new `attributes` and `listeners` objects on most renders; rows compare their
// drag handle props by identity, so the two hooks below keep those identities still.

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

export const DND_MODIFIERS = [restrictToVerticalAxis];
export const DRAG_ACTIVATION_CONFIG = {
  movementDistance: 6,
  touchHoldDelayMs: 180,
  touchHoldTolerance: 8,
};

function areRecordsEqual(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

export function useShallowStableRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const stableRef = useRef(value);
  if (!areRecordsEqual(stableRef.current, value)) {
    stableRef.current = value;
  }
  return stableRef.current;
}

export function useStableListenerRecord(
  listeners: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const latestListenersRef = useRef(listeners);
  latestListenersRef.current = listeners;
  const listenerKeys = Object.keys(listeners ?? {}).sort();
  const listenerKeySignature = listenerKeys.join("\u0000");
  const stableListenersRef = useRef<{
    keySignature: string;
    listeners: Record<string, unknown> | undefined;
  }>(undefined);
  if (stableListenersRef.current?.keySignature !== listenerKeySignature) {
    stableListenersRef.current = {
      keySignature: listenerKeySignature,
      listeners:
        listenerKeys.length === 0
          ? undefined
          : Object.fromEntries(
              listenerKeys.map((key) => [
                key,
                (...args: unknown[]) => {
                  const listener = latestListenersRef.current?.[key];
                  if (typeof listener === "function") {
                    return Reflect.apply(listener, undefined, args);
                  }
                },
              ]),
            ),
    };
  }
  return stableListenersRef.current.listeners;
}
