import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import { getDragActivationConstraints } from "@/components/drag-reorder";
import {
  DND_MODIFIERS,
  DRAG_ACTIVATION_CONFIG,
  useShallowStableRecord,
  useStableListenerRecord,
} from "@/components/drag-reorder/dnd-kit-handle";
import {
  PINNED_ROOT_DROP_ID,
  decodePinnedDragId,
  encodePinnedDragId,
  type PinnedDragItem,
  type PinnedDropTarget,
} from "./model";
import type {
  PinnedContainerWorkspacesProps,
  PinnedRootDropZoneProps,
  PinnedTreeDndProps,
  PinnedTreeItemProps,
  PinnedTreeItemState,
} from "./dnd.types";

export type { PinnedTreeItemState } from "./dnd.types";

// Module constants: an options object made per render gives dnd-kit new sensors, and with them
// new listeners for every row, on every render.
const ACTIVATION = getDragActivationConstraints(true, DRAG_ACTIVATION_CONFIG);
const MOUSE_SENSOR_OPTIONS = { activationConstraint: ACTIVATION.mouse };
const TOUCH_SENSOR_OPTIONS = { activationConstraint: ACTIVATION.touch };

// The dragged row moves with the pointer, so its own droppable always sits under it. Left in, it
// wins the collision as often as the row you are actually over, and the drop lands nowhere.
const collisionDetection: CollisionDetection = (args) => {
  const others = {
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.id !== args.active.id,
    ),
  };
  const pointerHits = pointerWithin(others);
  return pointerHits.length > 0 ? pointerHits : rectIntersection(others);
};

interface DropPreview {
  overId: string;
  position: "before" | "after" | "into";
}

interface PinnedTreeDndContextValue {
  activeId: string | null;
  preview: DropPreview | null;
}

const PinnedTreeDndContext = createContext<PinnedTreeDndContextValue>({
  activeId: null,
  preview: null,
});

function resolvePreview(event: DragMoveEvent | DragEndEvent): DropPreview | null {
  const over = event.over;
  if (!over || over.id === event.active.id) return null;
  const overId = String(over.id);
  if (overId === PINNED_ROOT_DROP_ID) return { overId, position: "into" };
  const overItem = decodePinnedDragId(overId);
  if (!overItem) return null;
  if (overItem.kind === "folder") return { overId, position: "into" };
  // Folders sort by name, so a folder has no place between pins: no insert line, no drop.
  if (decodePinnedDragId(String(event.active.id))?.kind === "folder") return null;
  // The sortable list's rule rather than the row's midpoint: a pin dragged down onto a row lands
  // after it, dragged up lands before it. Every slot stays reachable, and a drop on the next row
  // swaps the two the way it always has.
  const initialTop = event.active.rect.current.initial?.top;
  return {
    overId,
    position: initialTop !== undefined && initialTop < over.rect.top ? "after" : "before",
  };
}

function previewToTarget(preview: DropPreview): PinnedDropTarget | null {
  if (preview.overId === PINNED_ROOT_DROP_ID) return { kind: "root" };
  const item = decodePinnedDragId(preview.overId);
  if (!item) return null;
  if (item.kind === "folder") return { kind: "folder", folderId: item.folderId };
  return {
    kind: "workspace",
    workspaceKey: item.workspaceKey,
    position: preview.position === "before" ? "before" : "after",
  };
}

export function PinnedTreeDnd({ children, onDrop }: PinnedTreeDndProps): ReactElement {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setPreview(null);
  }, []);
  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const next = resolvePreview(event);
    setPreview((current) =>
      current?.overId === next?.overId && current?.position === next?.position ? current : next,
    );
  }, []);
  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setPreview(null);
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      setPreview(null);
      const item = decodePinnedDragId(String(event.active.id));
      const dropPreview = resolvePreview(event);
      const target = dropPreview ? previewToTarget(dropPreview) : null;
      if (item && target) onDrop(item, target);
    },
    [onDrop],
  );

  const value = useMemo(() => ({ activeId, preview }), [activeId, preview]);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={DND_MODIFIERS}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragMove}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <PinnedTreeDndContext value={value}>{children}</PinnedTreeDndContext>
    </DndContext>
  );
}

function useDropIndicator(id: string): PinnedTreeItemState["dropIndicator"] {
  const { activeId, preview } = useContext(PinnedTreeDndContext);
  if (!activeId || preview?.overId !== id) return null;
  return preview.position;
}

export function PinnedTreeItem({ item, disabled = false, children }: PinnedTreeItemProps) {
  const id = encodePinnedDragId(item);
  const draggable = useDraggable({ id, disabled });
  const droppable = useDroppable({ id });
  const dropIndicator = useDropIndicator(id);
  const { setNodeRef: setDraggableRef } = draggable;
  const { setNodeRef: setDroppableRef } = droppable;
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef],
  );
  const attributes = useShallowStableRecord(
    draggable.attributes as unknown as Record<string, unknown>,
  );
  const listeners = useStableListenerRecord(
    draggable.listeners as unknown as Record<string, unknown> | undefined,
  );
  const setActivatorNodeRef = draggable.setActivatorNodeRef;
  const dragHandleProps = useMemo<DraggableListDragHandleProps | undefined>(
    () =>
      disabled
        ? undefined
        : {
            attributes,
            listeners,
            setActivatorNodeRef: setActivatorNodeRef as unknown as (node: unknown) => void,
          },
    [attributes, disabled, listeners, setActivatorNodeRef],
  );
  const style = useMemo<CSSProperties>(
    () => ({
      position: "relative",
      transform: CSS.Translate.toString(draggable.transform),
      opacity: draggable.isDragging ? 0.85 : 1,
      zIndex: draggable.isDragging ? 1000 : undefined,
    }),
    [draggable.isDragging, draggable.transform],
  );

  return (
    <div ref={setNodeRef} style={style} data-testid={`sidebar-pinned-tree-item-${id}`}>
      {children({ dragHandleProps, isDragging: draggable.isDragging, dropIndicator })}
      {dropIndicator === "before" || dropIndicator === "after" ? (
        <View
          pointerEvents="none"
          style={[
            styles.insertLine,
            dropIndicator === "before" ? styles.insertLineBefore : styles.insertLineAfter,
          ]}
        />
      ) : null}
    </div>
  );
}

export function PinnedRootDropZone({ children }: PinnedRootDropZoneProps) {
  const { setNodeRef } = useDroppable({ id: PINNED_ROOT_DROP_ID });
  const dropIndicator = useDropIndicator(PINNED_ROOT_DROP_ID);
  return <div ref={setNodeRef}>{children({ isOver: dropIndicator === "into" })}</div>;
}

export function PinnedContainerWorkspaces<T extends { workspaceKey: string }>({
  workspaces,
  renderRow,
}: PinnedContainerWorkspacesProps<T>): ReactElement {
  return (
    <>
      {workspaces.map((workspace) => (
        <PinnedWorkspaceItem
          key={workspace.workspaceKey}
          workspace={workspace}
          renderRow={renderRow}
        />
      ))}
    </>
  );
}

function PinnedWorkspaceItem<T extends { workspaceKey: string }>({
  workspace,
  renderRow,
}: {
  workspace: T;
  renderRow: PinnedContainerWorkspacesProps<T>["renderRow"];
}) {
  const item = useMemo<PinnedDragItem>(
    () => ({ kind: "workspace", workspaceKey: workspace.workspaceKey }),
    [workspace.workspaceKey],
  );
  return <PinnedTreeItem item={item}>{(state) => renderRow(workspace, state)}</PinnedTreeItem>;
}

const styles = StyleSheet.create((theme) => ({
  insertLine: {
    position: "absolute",
    left: theme.spacing[2],
    right: theme.spacing[2],
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.accent,
  },
  insertLineBefore: {
    top: -1,
  },
  insertLineAfter: {
    bottom: 1,
  },
}));
