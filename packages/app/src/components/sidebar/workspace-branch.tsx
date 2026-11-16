import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { SidebarTreeIndent } from "@/components/sidebar/sidebar-tree-indent";
import type { WorkspaceTreeNode } from "@/components/sidebar/workspace-tree";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";

/**
 * A workspace with its handoffs under it, recursively. Only the top row gets `rowState` (the drag
 * handle): the subtree moves, files and reorders as one item of its list.
 *
 * Each parent reads its own collapsed flag, so a chevron re-renders that branch and nothing else.
 */
export function SidebarWorkspaceBranch<T extends { workspaceKey: string }, S>({
  node,
  baseDepth = 0,
  rowState,
  childRowState,
  renderRow,
}: {
  node: WorkspaceTreeNode<T>;
  /** The depth the branch starts at, for a branch inside a Pinned folder. */
  baseDepth?: number;
  rowState: S;
  childRowState: S;
  renderRow: (workspace: T, rowState: S) => ReactElement;
}) {
  const { t } = useTranslation();
  const workspaceKey = node.workspace.workspaceKey;
  const hasChildren = node.children.length > 0;
  const expanded = useSidebarCollapsedSectionsStore(
    (store) => !store.collapsedWorkspaceTreeKeys.has(workspaceKey),
  );
  const toggleWorkspaceTreeCollapsed = useSidebarCollapsedSectionsStore(
    (store) => store.toggleWorkspaceTreeCollapsed,
  );
  const toggle = useCallback(
    () => toggleWorkspaceTreeCollapsed(workspaceKey),
    [toggleWorkspaceTreeCollapsed, workspaceKey],
  );
  const disclosure = useMemo(
    () =>
      hasChildren
        ? {
            expanded,
            onToggle: toggle,
            accessibilityLabel: t(
              expanded ? "sidebar.handoffs.collapse" : "sidebar.handoffs.expand",
            ),
            testID: `sidebar-workspace-tree-toggle-${workspaceKey}`,
          }
        : null,
    [expanded, hasChildren, t, toggle, workspaceKey],
  );

  return (
    <>
      <SidebarTreeIndent depth={baseDepth + node.depth} disclosure={disclosure}>
        {renderRow(node.workspace, rowState)}
      </SidebarTreeIndent>
      {hasChildren && expanded
        ? node.children.map((child) => (
            <SidebarWorkspaceBranch
              key={child.workspace.workspaceKey}
              node={child}
              baseDepth={baseDepth}
              rowState={childRowState}
              childRowState={childRowState}
              renderRow={renderRow}
            />
          ))
        : null}
    </>
  );
}
