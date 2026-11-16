import { aggregateSidebarStateBuckets, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

/**
 * Handoff nesting: a workspace created by an agent in another workspace sits under that parent.
 *
 * The tree is built per list (one project, one status group), never across lists. A parent that is
 * filtered out, pinned away or lives in another project leaves its child at the top level, so a row
 * never disappears because its parent is not on screen.
 */
export interface WorkspaceTreeNode<T> {
  workspace: T;
  depth: number;
  children: WorkspaceTreeNode<T>[];
}

interface TreeItem {
  workspaceKey: string;
}

/** workspaceKey -> the parent's workspaceKey, for workspaces that have a parent. */
export type WorkspaceParentKeys = ReadonlyMap<string, string>;

export function buildWorkspaceParentKeys(
  entries: Iterable<{ workspaceKey: string; serverId: string; parentWorkspaceId?: string }>,
): Map<string, string> {
  const parents = new Map<string, string>();
  for (const entry of entries) {
    if (entry.parentWorkspaceId) {
      parents.set(entry.workspaceKey, `${entry.serverId}:${entry.parentWorkspaceId}`);
    }
  }
  return parents;
}

export function areWorkspaceParentKeysEqual(
  left: WorkspaceParentKeys,
  right: WorkspaceParentKeys,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, parent] of left) {
    if (right.get(key) !== parent) return false;
  }
  return true;
}

/** Keeps the list's own order: roots in list order, each parent's children in list order. */
export function buildWorkspaceForest<T extends TreeItem>(
  items: readonly T[],
  parentKeys: WorkspaceParentKeys,
): WorkspaceTreeNode<T>[] {
  const present = new Set(items.map((item) => item.workspaceKey));
  const parentOf = (key: string): string | null => {
    const parent = parentKeys.get(key);
    return parent && present.has(parent) ? parent : null;
  };
  // A cycle in the stored ancestry would otherwise drop every row on it. Each member of a cycle
  // is treated as a root instead.
  const inCycle = (key: string): boolean => {
    const seen = new Set<string>([key]);
    let current = parentOf(key);
    while (current) {
      if (current === key) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      current = parentOf(current);
    }
    return false;
  };

  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const parent = inCycle(item.workspaceKey) ? null : parentOf(item.workspaceKey);
    if (!parent) {
      roots.push(item);
      continue;
    }
    const siblings = childrenByParent.get(parent);
    if (siblings) siblings.push(item);
    else childrenByParent.set(parent, [item]);
  }

  const toNode = (item: T, depth: number): WorkspaceTreeNode<T> => ({
    workspace: item,
    depth,
    children: (childrenByParent.get(item.workspaceKey) ?? []).map((child) =>
      toNode(child, depth + 1),
    ),
  });
  return roots.map((root) => toNode(root, 0));
}

/**
 * A top-level workspace carrying its subtree. Lists, limits and drags work on these, so a parent
 * always moves, shows and hides together with its handoffs.
 */
export interface WorkspaceTreeRoot<T> {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  node: WorkspaceTreeNode<T>;
}

export function toWorkspaceTreeRoots<
  T extends { serverId: string; workspaceId: string; workspaceKey: string },
>(forest: readonly WorkspaceTreeNode<T>[]): WorkspaceTreeRoot<T>[] {
  return forest.map((node) => ({
    serverId: node.workspace.serverId,
    workspaceId: node.workspace.workspaceId,
    workspaceKey: node.workspace.workspaceKey,
    node,
  }));
}

/**
 * Whether the open workspace is this root or anywhere under it. Limits work on roots, so a root
 * hidden past "Show more" still has to surface when one of its handoffs is the open workspace.
 */
export function workspaceTreeRootHasSelection<T extends { serverId: string; workspaceId: string }>(
  root: WorkspaceTreeRoot<T>,
  selection: { serverId: string; workspaceId: string },
): boolean {
  const visit = (node: WorkspaceTreeNode<T>): boolean =>
    (node.workspace.serverId === selection.serverId &&
      node.workspace.workspaceId === selection.workspaceId) ||
    node.children.some(visit);
  return visit(root.node);
}

/** The root of the tree `workspaceKey` is shown in, or null when it is not in the forest. */
export function findWorkspaceRootKey<T extends TreeItem>(
  forest: readonly WorkspaceTreeNode<T>[],
  workspaceKey: string,
): string | null {
  const contains = (node: WorkspaceTreeNode<T>): boolean =>
    node.workspace.workspaceKey === workspaceKey || node.children.some(contains);
  return forest.find(contains)?.workspace.workspaceKey ?? null;
}

/**
 * The collapsed parents hiding `workspaceKey`. `nestsUnder` says whether a child is shown under
 * its parent — they share a list — because a parent in another list hides nothing of this one.
 */
export function collapsedAncestorKeys(input: {
  workspaceKey: string;
  parentKeys: WorkspaceParentKeys;
  collapsedKeys: ReadonlySet<string>;
  nestsUnder: (childKey: string, parentKey: string) => boolean;
}): string[] {
  const result: string[] = [];
  const seen = new Set<string>([input.workspaceKey]);
  let current = input.workspaceKey;
  for (;;) {
    const parent = input.parentKeys.get(current);
    if (!parent || seen.has(parent) || !input.nestsUnder(current, parent)) return result;
    if (input.collapsedKeys.has(parent)) result.push(parent);
    seen.add(parent);
    current = parent;
  }
}

/**
 * Every workspace in display order. Pass `collapsedKeys` to stop at collapsed parents, which is
 * what the keyboard shortcuts walk.
 */
export function flattenWorkspaceForest<T extends TreeItem>(
  forest: readonly WorkspaceTreeNode<T>[],
  collapsedKeys?: ReadonlySet<string>,
): T[] {
  const result: T[] = [];
  const visit = (node: WorkspaceTreeNode<T>) => {
    result.push(node.workspace);
    if (collapsedKeys?.has(node.workspace.workspaceKey)) return;
    node.children.forEach(visit);
  };
  forest.forEach(visit);
  return result;
}

export function orderWorkspacesAsForest<T extends TreeItem>(
  items: readonly T[],
  parentKeys: WorkspaceParentKeys,
  collapsedKeys?: ReadonlySet<string>,
): T[] {
  if (parentKeys.size === 0) return items.slice();
  return flattenWorkspaceForest(buildWorkspaceForest(items, parentKeys), collapsedKeys);
}

/** The most urgent status in a subtree, so a collapsed parent still surfaces a busy child. */
export function subtreeStatusBucket<T>(
  node: WorkspaceTreeNode<T>,
  getStatusBucket: (workspace: T) => SidebarStateBucket,
): SidebarStateBucket {
  const buckets: SidebarStateBucket[] = [];
  const visit = (current: WorkspaceTreeNode<T>) => {
    buckets.push(getStatusBucket(current.workspace));
    current.children.forEach(visit);
  };
  visit(node);
  return aggregateSidebarStateBuckets(buckets);
}
