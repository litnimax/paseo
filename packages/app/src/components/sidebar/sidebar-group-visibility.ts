import type { SidebarStateBucket } from "@/hooks/sidebar-workspaces-view-model";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";

export interface SidebarGroupItem {
  serverId: string;
  workspaceId: string;
}

export interface SidebarGroupVisibilityInput<T> {
  items: readonly T[];
  expanded: boolean;
  policy: SidebarGroupVisibilityPolicy<T>;
  /** The workspace the group's rows highlight as selected. Null when no row can be selected. */
  selection: ActiveWorkspaceSelection | null;
  /**
   * Whether an item shows the open workspace. Defaults to the item being that workspace; a list of
   * tree roots passes one that also looks at the rows nested under the root.
   */
  containsSelection?: (item: T, selection: ActiveWorkspaceSelection) => boolean;
}

export interface SidebarGroupVisibility<T> {
  /**
   * The open workspace when the collapsed limit would hide it. Rendered before `visibleItems`,
   * out of group order, outside any drag list. Never also present in `visibleItems`.
   */
  leadingItem: T | null;
  visibleItems: T[];
  canToggle: boolean;
}

export type SidebarGroupVisibilityPolicy<T> =
  | { kind: "pinned" }
  | { kind: "workspaces"; getStatusBucket: (item: T) => SidebarStateBucket };

// A placement can outrun its entry: a retained sidebar that is inactive (compact layout with the
// sidebar closed) or still waiting for sessions keeps an empty entry map. A missing entry renders
// no row, so it counts as Done and claims no slot past the limit.
export function createWorkspaceVisibilityPolicy<T extends { workspaceKey: string }>(
  entriesByKey: ReadonlyMap<string, { statusBucket: SidebarStateBucket }>,
): SidebarGroupVisibilityPolicy<T> {
  return {
    kind: "workspaces",
    getStatusBucket: (item) => entriesByKey.get(item.workspaceKey)?.statusBucket ?? "done",
  };
}

function isOpenWorkspace(item: SidebarGroupItem, selection: ActiveWorkspaceSelection): boolean {
  return item.serverId === selection.serverId && item.workspaceId === selection.workspaceId;
}

export function selectSidebarGroupVisibility<T extends SidebarGroupItem>(
  input: SidebarGroupVisibilityInput<T>,
): SidebarGroupVisibility<T> {
  const { items, expanded, policy, selection } = input;
  const containsSelection = input.containsSelection ?? isOpenWorkspace;
  const limit = policy.kind === "pinned" ? 20 : 7;
  const baseline: T[] = [];
  let leadingItem: T | null = null;
  let canToggle = false;

  items.forEach((item, index) => {
    const inBaseline =
      index < limit || (policy.kind === "workspaces" && policy.getStatusBucket(item) !== "done");
    if (inBaseline) {
      baseline.push(item);
    } else if (leadingItem === null && selection !== null && containsSelection(item, selection)) {
      leadingItem = item;
    } else {
      canToggle = true;
    }
  });

  if (expanded || !canToggle) {
    return { leadingItem: null, visibleItems: items.slice(), canToggle };
  }

  return {
    leadingItem,
    visibleItems: baseline,
    canToggle,
  };
}
