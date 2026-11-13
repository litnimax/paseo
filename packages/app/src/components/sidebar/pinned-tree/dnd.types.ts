import type { MutableRefObject, ReactElement, ReactNode } from "react";
import type { GestureType } from "react-native-gesture-handler";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import type { PinnedDragItem, PinnedDropTarget } from "./model";

export interface PinnedTreeItemState {
  dragHandleProps?: DraggableListDragHandleProps;
  /** Native list drag starter; web drags through `dragHandleProps`. */
  drag?: () => void;
  isDragging: boolean;
  /** Where the dragged item would land relative to this one. */
  dropIndicator: "before" | "after" | "into" | null;
}

export interface PinnedTreeDndProps {
  children: ReactNode;
  onDrop: (item: PinnedDragItem, target: PinnedDropTarget) => void;
}

export interface PinnedTreeItemProps {
  item: PinnedDragItem;
  disabled?: boolean;
  children: (state: PinnedTreeItemState) => ReactNode;
}

export interface PinnedRootDropZoneProps {
  children: (state: { isOver: boolean }) => ReactNode;
}

export interface PinnedContainerWorkspacesProps<T> {
  /** The pins of one folder (or the root), in pinned order. */
  workspaces: T[];
  renderRow: (workspace: T, state: PinnedTreeItemState) => ReactElement;
  /** Native reorders within one level; web moves through `PinnedTreeDnd.onDrop`. */
  onReorder: (workspaces: T[]) => void;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostActive?: boolean;
}
