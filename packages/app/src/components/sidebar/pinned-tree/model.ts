import type { PinnedFolder } from "@/stores/sidebar-pinned-folders-store";
import { isFolderWithin } from "@/stores/sidebar-pinned-folders-store";
import {
  buildWorkspaceForest,
  flattenWorkspaceForest,
  type WorkspaceParentKeys,
  type WorkspaceTreeNode,
} from "@/components/sidebar/workspace-tree";

/**
 * The Pinned section as a folder tree. Like a file manager, each level lists its folders first,
 * by name, then its pins in the pinned order. A pin filed in a folder that no longer exists falls
 * back to the root, so stale storage can never hide a pin.
 *
 * Handoffs nest the way they do everywhere else: a pin whose parent is also pinned sits under that
 * parent, in the parent's folder, whatever folder it was filed in on its own.
 */
export type PinnedTreeNode<T> =
  | {
      kind: "folder";
      folder: PinnedFolder;
      depth: number;
      collapsed: boolean;
      /** Pins anywhere under this folder, for the collapsed row's count. */
      workspaceCount: number;
      children: PinnedTreeNode<T>[];
    }
  | {
      kind: "workspace";
      workspace: T;
      /** The pin with its pinned handoffs under it. */
      node: WorkspaceTreeNode<T>;
      depth: number;
      folderId: string | null;
    };

export interface PinnedTreeInput<T> {
  /** Pinned workspaces in the stored pinned order. */
  workspaces: readonly T[];
  folders: readonly PinnedFolder[];
  folderIdByWorkspaceKey: Readonly<Record<string, string>>;
  collapsedFolderIds: readonly string[];
  parentKeys: WorkspaceParentKeys;
}

const folderNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareFolders(left: PinnedFolder, right: PinnedFolder): number {
  return folderNameCollator.compare(left.name, right.name) || left.id.localeCompare(right.id);
}

export function resolveWorkspaceFolderId(
  workspaceKey: string,
  folderIdByWorkspaceKey: Readonly<Record<string, string>>,
  folderIds: ReadonlySet<string>,
): string | null {
  const folderId = folderIdByWorkspaceKey[workspaceKey];
  return folderId && folderIds.has(folderId) ? folderId : null;
}

export function buildPinnedTree<T extends { workspaceKey: string }>(
  input: PinnedTreeInput<T>,
): PinnedTreeNode<T>[] {
  const folderIds = new Set(input.folders.map((folder) => folder.id));
  const collapsed = new Set(input.collapsedFolderIds);
  const foldersByParent = new Map<string | null, PinnedFolder[]>();
  for (const folder of input.folders) {
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null;
    const siblings = foldersByParent.get(parentId);
    if (siblings) siblings.push(folder);
    else foldersByParent.set(parentId, [folder]);
  }
  // Each forest root is filed by its own folder; its handoffs come along with it.
  const workspacesByFolder = new Map<string | null, WorkspaceTreeNode<T>[]>();
  for (const root of buildWorkspaceForest(input.workspaces, input.parentKeys)) {
    const folderId = resolveWorkspaceFolderId(
      root.workspace.workspaceKey,
      input.folderIdByWorkspaceKey,
      folderIds,
    );
    const siblings = workspacesByFolder.get(folderId);
    if (siblings) siblings.push(root);
    else workspacesByFolder.set(folderId, [root]);
  }

  const visited = new Set<string>();
  const buildLevel = (parentId: string | null, depth: number): PinnedTreeNode<T>[] => {
    const folderNodes: PinnedTreeNode<T>[] = [];
    for (const folder of (foldersByParent.get(parentId) ?? []).slice().sort(compareFolders)) {
      // Storage is repaired on load; this only guards a cycle written in the same session.
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      const children = buildLevel(folder.id, depth + 1);
      folderNodes.push({
        kind: "folder",
        folder,
        depth,
        collapsed: collapsed.has(folder.id),
        workspaceCount: countWorkspaces(children),
        children,
      });
    }
    const workspaceNodes: PinnedTreeNode<T>[] = (workspacesByFolder.get(parentId) ?? []).map(
      (node) => ({ kind: "workspace", workspace: node.workspace, node, depth, folderId: parentId }),
    );
    return [...folderNodes, ...workspaceNodes];
  };
  return buildLevel(null, 0);
}

/** Folders in tree order, each labelled with its path so nesting reads in a flat list. */
export function listPinnedFolderPaths(
  folders: readonly PinnedFolder[],
): { folder: PinnedFolder; path: string }[] {
  const result: { folder: PinnedFolder; path: string }[] = [];
  const visit = (nodes: readonly PinnedTreeNode<never>[], prefix: string) => {
    for (const node of nodes) {
      if (node.kind !== "folder") continue;
      const path = prefix ? `${prefix} / ${node.folder.name}` : node.folder.name;
      result.push({ folder: node.folder, path });
      visit(node.children, path);
    }
  };
  visit(
    buildPinnedTree<never>({
      workspaces: [],
      folders,
      folderIdByWorkspaceKey: {},
      collapsedFolderIds: [],
      parentKeys: new Map(),
    }),
    "",
  );
  return result;
}

function countWorkspaces<T>(nodes: readonly PinnedTreeNode<T>[]): number {
  let count = 0;
  for (const node of nodes) {
    count += node.kind === "workspace" ? countBranch(node.node) : node.workspaceCount;
  }
  return count;
}

function countBranch<T>(node: WorkspaceTreeNode<T>): number {
  return node.children.reduce((count, child) => count + countBranch(child), 1);
}

/**
 * Pins in the order the section shows them, skipping the contents of collapsed folders and the
 * handoffs of collapsed parents.
 */
export function flattenVisiblePinnedWorkspaces<T extends { workspaceKey: string }>(
  nodes: readonly PinnedTreeNode<T>[],
  collapsedWorkspaceTreeKeys: ReadonlySet<string>,
): T[] {
  const result: T[] = [];
  const visit = (node: PinnedTreeNode<T>) => {
    if (node.kind === "workspace") {
      result.push(...flattenWorkspaceForest([node.node], collapsedWorkspaceTreeKeys));
      return;
    }
    if (!node.collapsed) node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

/** Every pin in tree order, collapsed or not. Reordering writes this back as the pinned order. */
export function flattenPinnedWorkspaceKeys<T extends { workspaceKey: string }>(
  nodes: readonly PinnedTreeNode<T>[],
): string[] {
  const result: string[] = [];
  const visit = (node: PinnedTreeNode<T>) => {
    if (node.kind === "workspace") {
      for (const workspace of flattenWorkspaceForest([node.node])) {
        result.push(workspace.workspaceKey);
      }
    } else node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}

export type PinnedDragItem =
  | { kind: "workspace"; workspaceKey: string }
  | { kind: "folder"; folderId: string };

export type PinnedDropTarget =
  | { kind: "root" }
  | { kind: "folder"; folderId: string }
  | { kind: "workspace"; workspaceKey: string; position: "before" | "after" };

export type PinnedDropAction =
  | { kind: "none" }
  | {
      kind: "move-workspace";
      workspaceKey: string;
      folderId: string | null;
      /** The new pinned order, when the drop also placed the pin next to another one. */
      pinnedOrder: string[] | null;
    }
  | { kind: "move-folder"; folderId: string; parentId: string | null };

/**
 * What a drop means. Dropping on a folder files into it, on the Pinned header files into the root,
 * and on a pin places next to that pin, in that pin's folder. Folders sort by name, so a folder has
 * no place next to a pin and that drop does nothing.
 */
export function resolvePinnedDrop(input: {
  item: PinnedDragItem;
  target: PinnedDropTarget;
  folders: readonly PinnedFolder[];
  folderIdByWorkspaceKey: Readonly<Record<string, string>>;
  /** Every pin in tree order (see `flattenPinnedWorkspaceKeys`). */
  pinnedOrder: readonly string[];
}): PinnedDropAction {
  const { item, target } = input;
  const folderIds = new Set(input.folders.map((folder) => folder.id));
  const targetFolderId = (() => {
    switch (target.kind) {
      case "root":
        return null;
      case "folder":
        return target.folderId;
      case "workspace":
        return resolveWorkspaceFolderId(
          target.workspaceKey,
          input.folderIdByWorkspaceKey,
          folderIds,
        );
    }
  })();

  if (item.kind === "folder") {
    if (target.kind === "workspace") return { kind: "none" };
    const folder = input.folders.find((candidate) => candidate.id === item.folderId);
    if (!folder) return { kind: "none" };
    if (targetFolderId && isFolderWithin(input.folders, targetFolderId, item.folderId)) {
      return { kind: "none" };
    }
    if (folder.parentId === targetFolderId) return { kind: "none" };
    return { kind: "move-folder", folderId: item.folderId, parentId: targetFolderId };
  }

  const currentFolderId = resolveWorkspaceFolderId(
    item.workspaceKey,
    input.folderIdByWorkspaceKey,
    folderIds,
  );
  let pinnedOrder: string[] | null = null;
  if (target.kind === "workspace") {
    if (target.workspaceKey === item.workspaceKey) return { kind: "none" };
    const order = input.pinnedOrder.filter((key) => key !== item.workspaceKey);
    const targetIndex = order.indexOf(target.workspaceKey);
    if (targetIndex >= 0) {
      order.splice(
        target.position === "before" ? targetIndex : targetIndex + 1,
        0,
        item.workspaceKey,
      );
      const unchanged =
        order.length === input.pinnedOrder.length &&
        order.every((key, index) => key === input.pinnedOrder[index]);
      pinnedOrder = unchanged ? null : order;
    }
  }
  if (currentFolderId === targetFolderId && pinnedOrder === null) return { kind: "none" };
  return {
    kind: "move-workspace",
    workspaceKey: item.workspaceKey,
    folderId: targetFolderId,
    pinnedOrder,
  };
}

/** Ids dnd-kit carries for each draggable and droppable in the tree. */
export function encodePinnedDragId(item: PinnedDragItem): string {
  return item.kind === "workspace" ? `ws:${item.workspaceKey}` : `folder:${item.folderId}`;
}

export const PINNED_ROOT_DROP_ID = "pinned-root";

export function decodePinnedDragId(id: string): PinnedDragItem | null {
  if (id.startsWith("ws:")) return { kind: "workspace", workspaceKey: id.slice(3) };
  if (id.startsWith("folder:")) return { kind: "folder", folderId: id.slice(7) };
  return null;
}
