import { useCallback, type ReactElement, type ReactNode } from "react";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import type {
  PinnedContainerWorkspacesProps,
  PinnedRootDropZoneProps,
  PinnedTreeDndProps,
  PinnedTreeItemProps,
} from "./dnd.types";

export type { PinnedTreeItemState } from "./dnd.types";

// Native has no cross-list drop: long press still reorders pins within a level, and "Move to
// folder" in the row menu files them. Web replaces this file with a dnd-kit tree.

const IDLE_STATE = { isDragging: false, dropIndicator: null } as const;

export function PinnedTreeDnd({ children }: PinnedTreeDndProps): ReactNode {
  return children;
}

export function PinnedTreeItem({ children }: PinnedTreeItemProps): ReactNode {
  return children(IDLE_STATE);
}

export function PinnedRootDropZone({ children }: PinnedRootDropZoneProps): ReactNode {
  return children({ isOver: false });
}

function workspaceKeyExtractor(workspace: { workspaceKey: string }): string {
  return workspace.workspaceKey;
}

export function PinnedContainerWorkspaces<T extends { workspaceKey: string }>({
  workspaces,
  renderRow,
  onReorder,
  parentGestureRef,
  dragGestureHostActive,
}: PinnedContainerWorkspacesProps<T>): ReactElement {
  const renderItem = useCallback(
    ({ item, drag, isActive }: DraggableRenderItemInfo<T>) =>
      renderRow(item, { drag, isDragging: isActive, dropIndicator: null }),
    [renderRow],
  );
  return (
    <DraggableList
      data={workspaces}
      keyExtractor={workspaceKeyExtractor}
      renderItem={renderItem}
      onDragEnd={onReorder}
      scrollEnabled={false}
      useDragHandle
      nestable
      simultaneousGestureRef={parentGestureRef}
      gestureHostPresented={dragGestureHostActive}
    />
  );
}
