import { useCallback, useMemo, useState, type MutableRefObject, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FolderPlus } from "lucide-react-native";
import type { GestureType } from "react-native-gesture-handler";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { SidebarTreeIndent } from "@/components/sidebar/sidebar-tree-indent";
import { SidebarWorkspaceBranch } from "@/components/sidebar/workspace-branch";
import {
  flattenWorkspaceForest,
  toWorkspaceTreeRoots,
  workspaceTreeRootHasSelection,
  type WorkspaceParentKeys,
  type WorkspaceTreeRoot,
} from "@/components/sidebar/workspace-tree";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { DensityIcon } from "@/components/ui/density-icon";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import {
  useSidebarPinnedFoldersStore,
  type PinnedFolder,
} from "@/stores/sidebar-pinned-folders-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  PinnedContainerWorkspaces,
  PinnedRootDropZone,
  PinnedTreeDnd,
  PinnedTreeItem,
  type PinnedTreeItemState,
} from "./dnd";
import {
  buildPinnedTree,
  flattenPinnedWorkspaceKeys,
  resolvePinnedDrop,
  type PinnedDragItem,
  type PinnedDropTarget,
  type PinnedTreeNode,
} from "./model";
import { PinnedFolderRow, type PinnedFolderActions } from "./pinned-folder-row";

interface PinnedWorkspace {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
}

export interface PinnedSectionProps<T extends PinnedWorkspace> {
  /** Pinned workspaces in the stored pinned order. */
  workspaces: T[];
  renderWorkspaceRow: (workspace: T, state: PinnedTreeItemState) => ReactElement;
  /** Writes a new pinned order for the given keys; keys not listed keep their place after them. */
  onReorder: (workspaceKeys: string[]) => void;
  selection: ActiveWorkspaceSelection | null;
  /** Handoff ancestry, so a pinned handoff nests under its pinned parent. */
  parentKeys: WorkspaceParentKeys;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostActive?: boolean;
}

type FolderNameDialog =
  | { kind: "create"; parentId: string | null }
  | { kind: "rename"; folder: PinnedFolder };

/**
 * The Pinned section as a folder tree. Pinning drops a workspace into the root; folders are made
 * from the section header or a folder's menu, and pins move between them by drag (web) or by the
 * row menu's "Move to folder" (every platform).
 */
export function PinnedSection<T extends PinnedWorkspace>({
  workspaces,
  renderWorkspaceRow,
  onReorder,
  selection,
  parentKeys,
  parentGestureRef,
  dragGestureHostActive,
}: PinnedSectionProps<T>) {
  const { t } = useTranslation();
  const collapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const toggleCollapsed = useSidebarCollapsedSectionsStore((state) => state.togglePinnedCollapsed);
  const folders = useSidebarPinnedFoldersStore((state) => state.folders);
  const folderIdByWorkspaceKey = useSidebarPinnedFoldersStore(
    (state) => state.folderIdByWorkspaceKey,
  );
  const collapsedFolderIds = useSidebarPinnedFoldersStore((state) => state.collapsedFolderIds);
  const [dialog, setDialog] = useState<FolderNameDialog | null>(null);

  const tree = useMemo(
    () =>
      buildPinnedTree({
        workspaces,
        folders,
        folderIdByWorkspaceKey,
        collapsedFolderIds,
        parentKeys,
      }),
    [collapsedFolderIds, folderIdByWorkspaceKey, folders, parentKeys, workspaces],
  );
  const rootFolders = useMemo(() => tree.filter((node) => node.kind === "folder"), [tree]);
  const rootWorkspaces = useMemo(() => workspaceRootsOf(tree), [tree]);
  // The pin limit only trims the root. A folder is a choice to file pins away, so it shows all
  // of them when open.
  const {
    leadingItem,
    visibleItems,
    expanded: rootExpanded,
    canToggle,
    toggleExpanded,
  } = useLimitedSidebarGroup({
    items: rootWorkspaces,
    selection,
    containsSelection: workspaceTreeRootHasSelection,
  });

  const handleDrop = useCallback(
    (item: PinnedDragItem, target: PinnedDropTarget) => {
      const store = useSidebarPinnedFoldersStore.getState();
      const action = resolvePinnedDrop({
        item,
        target,
        folders: store.folders,
        folderIdByWorkspaceKey: store.folderIdByWorkspaceKey,
        pinnedOrder: flattenPinnedWorkspaceKeys(tree),
      });
      switch (action.kind) {
        case "none":
          return;
        case "move-folder":
          store.moveFolder(action.folderId, action.parentId);
          return;
        case "move-workspace":
          store.assignWorkspaceFolder(action.workspaceKey, action.folderId);
          if (action.pinnedOrder) onReorder(action.pinnedOrder);
      }
    },
    [onReorder, tree],
  );

  const handleCreateRootFolder = useCallback(
    () => setDialog({ kind: "create", parentId: null }),
    [],
  );
  const folderActions = useMemo<PinnedFolderActions>(
    () => ({
      onCreateSubfolder: (folder) => setDialog({ kind: "create", parentId: folder.id }),
      onRename: (folder) => setDialog({ kind: "rename", folder }),
      onDelete: (folder) => {
        void (async () => {
          const confirmed = await confirmDialog({
            title: t("sidebar.pinned.deleteFolderConfirmation.title"),
            message: t("sidebar.pinned.deleteFolderConfirmation.message", { name: folder.name }),
            confirmLabel: t("sidebar.pinned.deleteFolderConfirmation.confirm"),
            cancelLabel: t("sidebar.pinned.deleteFolderConfirmation.cancel"),
            destructive: true,
          });
          if (confirmed) useSidebarPinnedFoldersStore.getState().deleteFolder(folder.id);
        })();
      },
    }),
    [t],
  );
  const closeDialog = useCallback(() => setDialog(null), []);
  const submitDialog = useCallback(
    (name: string) => {
      if (!dialog) return;
      const store = useSidebarPinnedFoldersStore.getState();
      if (dialog.kind === "create") store.createFolder({ name, parentId: dialog.parentId });
      else store.renameFolder(dialog.folder.id, name);
    },
    [dialog],
  );
  const reorderRoot = useReorderRoots<T>(onReorder);
  const renderRoot = useRenderPinnedRoot(renderWorkspaceRow, 0);

  if (workspaces.length === 0 && folders.length === 0) return null;

  const levelProps = {
    renderWorkspaceRow,
    onReorder,
    folderActions,
    parentGestureRef,
    dragGestureHostActive,
  };

  return (
    <View style={styles.section} testID="sidebar-pinned-section">
      <PinnedTreeDnd onDrop={handleDrop}>
        <PinnedRootDropZone>
          {({ isOver }) => (
            <View style={isOver ? styles.rootDropTarget : styles.rootDropIdle}>
              <SidebarSectionHeader
                title={t("sidebar.pinned.title")}
                collapsed={collapsed}
                onToggle={toggleCollapsed}
                testID="sidebar-pinned-section-header"
              >
                <NewFolderButton onPress={handleCreateRootFolder} />
              </SidebarSectionHeader>
            </View>
          )}
        </PinnedRootDropZone>
        {collapsed ? null : (
          <>
            <PinnedFolderNodes nodes={rootFolders} {...levelProps} />
            {leadingItem ? renderRoot(leadingItem, IDLE_ITEM_STATE) : null}
            <PinnedContainerWorkspaces
              workspaces={visibleItems}
              renderRow={renderRoot}
              onReorder={reorderRoot}
              parentGestureRef={parentGestureRef}
              dragGestureHostActive={dragGestureHostActive}
            />
            {canToggle ? (
              <SidebarGroupToggleRow
                expanded={rootExpanded}
                onPress={toggleExpanded}
                testID="sidebar-pinned-show-more"
              />
            ) : null}
          </>
        )}
      </PinnedTreeDnd>
      <AdaptiveRenameModal
        visible={dialog !== null}
        title={
          dialog?.kind === "rename"
            ? t("sidebar.pinned.folderName.renameTitle")
            : t("sidebar.pinned.folderName.createTitle")
        }
        initialValue={dialog?.kind === "rename" ? dialog.folder.name : ""}
        placeholder={t("sidebar.pinned.folderName.placeholder")}
        submitLabel={
          dialog?.kind === "rename"
            ? t("sidebar.pinned.folderName.save")
            : t("sidebar.pinned.folderName.create")
        }
        maxLength={80}
        onClose={closeDialog}
        onSubmit={submitDialog}
        testID="sidebar-pinned-folder-name-modal"
      />
    </View>
  );
}

const IDLE_ITEM_STATE: PinnedTreeItemState = { isDragging: false, dropIndicator: null };

function workspaceRootsOf<T extends PinnedWorkspace>(
  nodes: readonly PinnedTreeNode<T>[],
): WorkspaceTreeRoot<T>[] {
  return toWorkspaceTreeRoots(
    nodes.flatMap((node) => (node.kind === "workspace" ? [node.node] : [])),
  );
}

/** A reordered level writes back every pin in it, handoffs included, in their new order. */
function useReorderRoots<T extends PinnedWorkspace>(
  onReorder: (workspaceKeys: string[]) => void,
): (roots: WorkspaceTreeRoot<T>[]) => void {
  return useCallback(
    (roots: WorkspaceTreeRoot<T>[]) =>
      onReorder(
        flattenWorkspaceForest(roots.map((root) => root.node)).map(
          (workspace) => workspace.workspaceKey,
        ),
      ),
    [onReorder],
  );
}

/** A pin with its pinned handoffs under it, starting at the folder depth it is filed at. */
function useRenderPinnedRoot<T extends PinnedWorkspace>(
  renderWorkspaceRow: (workspace: T, state: PinnedTreeItemState) => ReactElement,
  depth: number,
): (root: WorkspaceTreeRoot<T>, state: PinnedTreeItemState) => ReactElement {
  return useCallback(
    (root: WorkspaceTreeRoot<T>, state: PinnedTreeItemState) => (
      <SidebarWorkspaceBranch
        key={root.workspaceKey}
        node={root.node}
        baseDepth={depth}
        rowState={state}
        childRowState={IDLE_ITEM_STATE}
        renderRow={renderWorkspaceRow}
      />
    ),
    [depth, renderWorkspaceRow],
  );
}

interface PinnedLevelProps<T extends PinnedWorkspace> {
  renderWorkspaceRow: (workspace: T, state: PinnedTreeItemState) => ReactElement;
  onReorder: (workspaceKeys: string[]) => void;
  folderActions: PinnedFolderActions;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostActive?: boolean;
}

function PinnedFolderNodes<T extends PinnedWorkspace>({
  nodes,
  ...levelProps
}: PinnedLevelProps<T> & { nodes: PinnedTreeNode<T>[] }) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <PinnedFolderBranch key={node.folder.id} node={node} {...levelProps} />
        ) : null,
      )}
    </>
  );
}

function PinnedFolderBranch<T extends PinnedWorkspace>({
  node,
  ...levelProps
}: PinnedLevelProps<T> & { node: Extract<PinnedTreeNode<T>, { kind: "folder" }> }) {
  const { renderWorkspaceRow, onReorder, folderActions, parentGestureRef, dragGestureHostActive } =
    levelProps;
  const toggleFolderCollapsed = useSidebarPinnedFoldersStore(
    (state) => state.toggleFolderCollapsed,
  );
  const item = useMemo<PinnedDragItem>(
    () => ({ kind: "folder", folderId: node.folder.id }),
    [node.folder.id],
  );
  const childFolders = useMemo(
    () => node.children.filter((child) => child.kind === "folder"),
    [node.children],
  );
  const childWorkspaces = useMemo(() => workspaceRootsOf(node.children), [node.children]);
  const folderId = node.folder.id;
  const toggle = useCallback(
    () => toggleFolderCollapsed(folderId),
    [folderId, toggleFolderCollapsed],
  );
  const disclosure = useMemo(
    () => ({
      expanded: !node.collapsed,
      onToggle: toggle,
      accessibilityLabel: node.folder.name,
      testID: `sidebar-pinned-folder-disclosure-${folderId}`,
    }),
    [folderId, node.collapsed, node.folder.name, toggle],
  );
  const renderChildRoot = useRenderPinnedRoot(renderWorkspaceRow, node.depth + 1);
  const reorderChildren = useReorderRoots<T>(onReorder);

  return (
    <>
      <PinnedTreeItem item={item}>
        {(state) => (
          <SidebarTreeIndent depth={node.depth} disclosure={disclosure}>
            <PinnedFolderRow
              folder={node.folder}
              collapsed={node.collapsed}
              workspaceCount={node.workspaceCount}
              onToggle={toggleFolderCollapsed}
              actions={folderActions}
              dragHandleProps={state.dragHandleProps}
              isDragging={state.isDragging}
              isDropTarget={state.dropIndicator === "into"}
            />
          </SidebarTreeIndent>
        )}
      </PinnedTreeItem>
      {node.collapsed ? null : (
        <>
          <PinnedFolderNodes nodes={childFolders} {...levelProps} />
          <PinnedContainerWorkspaces
            workspaces={childWorkspaces}
            renderRow={renderChildRoot}
            onReorder={reorderChildren}
            parentGestureRef={parentGestureRef}
            dragGestureHostActive={dragGestureHostActive}
          />
        </>
      )}
    </>
  );
}

/**
 * Folders live on the hosts, so the button works while one that keeps them is connected. With
 * none, it says what to do instead of making a folder that would vanish.
 */
function NewFolderButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const canMakeFolders = useSidebarPinnedFoldersStore((state) =>
    Object.values(state.hosts).some((host) => host.status === "online"),
  );
  return (
    <ToolbarButton
      label={t(canMakeFolders ? "sidebar.pinned.newFolder" : "sidebar.pinned.foldersNeedHost")}
      disabled={!canMakeFolders}
      compact={isCompact}
      onPress={onPress}
      testID="sidebar-pinned-new-folder"
    >
      <DensityIcon icon={FolderPlus} size="sm" color="foregroundMuted" />
    </ToolbarButton>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[1],
  },
  rootDropIdle: {
    borderRadius: theme.borderRadius.lg,
  },
  rootDropTarget: {
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface3,
  },
}));
