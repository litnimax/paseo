import { useTranslation } from "react-i18next";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  useSidebarWorkspacesList,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys, type PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import {
  hasActiveSidebarLabelFilter,
  useSidebarViewStore,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarPinnedFoldersStore } from "@/stores/sidebar-pinned-folders-store";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { buildSidebarProjection } from "./sidebar-projection";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { filterWorkspacesByLabels, type SidebarWorkspaceGroup } from "./sidebar-labels";
import { filterWorkspacesByProjects, resolveActiveProjectFilters } from "./sidebar-project-filter";
import {
  areWorkspaceParentKeysEqual,
  buildWorkspaceParentKeys,
  collapsedAncestorKeys,
  type WorkspaceParentKeys,
} from "./workspace-tree";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { usePruneUnpinnedWorkspaceFolders } from "@/hooks/use-sidebar-workspace-pin";
import {
  hasAuthoritativeWorkspaceLabelCatalog,
  useWorkspaceLabelProjection,
} from "@/workspace-labels";

interface SidebarModel extends SidebarWorkspacesListResult {
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  /**
   * Every project the sidebar could show, before any filter narrows it.
   *
   * `projects` is the FILTERED list. A surface that offers a filter picker must read this one, or
   * narrowing the filter deletes the rows that would undo it.
   */
  allProjects: SidebarProjectEntry[];
  /** The project filter as it is actually being applied — see `resolveActiveProjectFilters`. */
  resolvedProjectFilters: readonly string[];
  hasProjectsBeforeFilter: boolean;
  groupMode: SidebarGroupMode;
  workspaceGroups: SidebarWorkspaceGroup[];
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  collapsedProjectKeys: ReadonlySet<string>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  /** Handoff ancestry of the visible workspaces. Identity changes only when a parent does. */
  workspaceParentKeys: WorkspaceParentKeys;
  shortcutModel: SidebarShortcutModel;
}

const SidebarModelContext = createContext<SidebarModel | null>(null);

export function SidebarModelProvider({
  active,
  keyboardNavigationActive = false,
  children,
}: {
  active?: boolean;
  keyboardNavigationActive?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const modelActive = active !== false || keyboardNavigationActive;
  const list = useSidebarWorkspacesList({ enabled: modelActive });
  const showBackground = useSidebarViewStore((state) => state.showBackground);
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const reconcileLabelFilter = useSidebarViewStore((state) => state.reconcileLabelFilter);
  const { hosts: labelHosts } = useWorkspaceLabelProjection();
  const collapsedProjectKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedProjectKeys,
  );
  const collapsedWorkspaceGroupKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedWorkspaceGroupKeys,
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const pinnedWorkspaceOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const collapsedWorkspaceTreeKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedWorkspaceTreeKeys,
  );
  const pinnedFolderList = useSidebarPinnedFoldersStore((state) => state.folders);
  const folderIdByWorkspaceKey = useSidebarPinnedFoldersStore(
    (state) => state.folderIdByWorkspaceKey,
  );
  const collapsedFolderIds = useSidebarPinnedFoldersStore((state) => state.collapsedFolderIds);
  const pinnedFolders = useMemo(
    () => ({ folders: pinnedFolderList, folderIdByWorkspaceKey, collapsedFolderIds }),
    [collapsedFolderIds, folderIdByWorkspaceKey, pinnedFolderList],
  );
  const toggleProjectCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleProjectCollapsed,
  );
  const availableLabelNames = useMemo(
    () => labelHosts.flatMap((host) => host.labels.map((label) => label.name)),
    [labelHosts],
  );
  const hasAuthoritativeLabelCatalog = hasAuthoritativeWorkspaceLabelCatalog(labelHosts);
  useEffect(() => {
    if (!hasAuthoritativeLabelCatalog) return;
    reconcileLabelFilter(availableLabelNames);
  }, [availableLabelNames, hasAuthoritativeLabelCatalog, reconcileLabelFilter]);
  const hasActiveLabelFilter = hasActiveSidebarLabelFilter(labelFilter);
  const resolvedProjectFilters = useMemo(
    () =>
      resolveActiveProjectFilters(
        projectFilters,
        new Set(list.projects.map((project) => project.viewKey)),
      ),
    [projectFilters, list.projects],
  );
  const hasActiveProjectFilter = resolvedProjectFilters.length > 0;
  // The project filter is deliberately absent from this gate. It reads `projectViewKey`, which
  // lives on the project and the placement, so it can narrow the project list without hydrating
  // anything; the label filter reads `labels`, which only exists on an entry. Hydration opens a
  // live session-store subscription over every workspace on every visible host, so widening this
  // for a filter that does not need it costs a retained-but-inactive sidebar real work.
  // Hardware keyboard navigation needs the same filtered targets while the sidebar is hidden.
  const needsWorkspaceEntries = groupMode !== "project" || hasActiveLabelFilter;
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(
    list.workspacePlacements,
    modelActive || needsWorkspaceEntries,
  );
  const filteredWorkspaceEntriesByKey = useMemo(() => {
    const byProject = filterWorkspacesByProjects({
      workspaces: [...workspaceEntriesByKey.values()],
      projectFilters: resolvedProjectFilters,
    });
    const filtered = filterWorkspacesByLabels({
      workspaces: byProject.filter((workspace) => showBackground || !workspace.background),
      ...labelFilter,
    });
    return new Map(filtered.map((workspace) => [workspace.workspaceKey, workspace]));
  }, [showBackground, labelFilter, resolvedProjectFilters, workspaceEntriesByKey]);
  const visibleWorkspaceKeys = useMemo(
    () => new Set(filteredWorkspaceEntriesByKey.keys()),
    [filteredWorkspaceEntriesByKey],
  );
  // The two filters prune differently on purpose. The project filter is a membership test on the
  // project itself, so a project you filtered TO survives even with no workspaces — it still owns
  // a header row you can create your first workspace under. The label filter can only ask about
  // workspaces, so a project it empties has nothing left to show.
  const filteredProjects = useMemo(() => {
    let projects = list.projects;
    if (hasActiveProjectFilter) {
      const included = new Set(resolvedProjectFilters);
      projects = projects.filter((project) => included.has(project.viewKey));
    }
    if (hasActiveLabelFilter || !showBackground) {
      projects = projects.flatMap((project) => {
        const workspaces = project.workspaces.filter((workspace) =>
          visibleWorkspaceKeys.has(workspace.workspaceKey),
        );
        return workspaces.length > 0 || (!hasActiveLabelFilter && project.workspaces.length === 0)
          ? [workspaces.length === project.workspaces.length ? project : { ...project, workspaces }]
          : [];
      });
    }
    return projects;
  }, [
    showBackground,
    hasActiveLabelFilter,
    hasActiveProjectFilter,
    resolvedProjectFilters,
    list.projects,
    visibleWorkspaceKeys,
  ]);
  const pinnedKeys = usePinnedSidebarKeys(filteredProjects);
  const workspaceParentKeys = useStableWorkspaceParentKeys(filteredWorkspaceEntriesByKey);
  useRevealOpenWorkspace({
    entries: filteredWorkspaceEntriesByKey,
    parentKeys: workspaceParentKeys,
    pinnedWorkspaceKeys: pinnedKeys.pinnedWorkspaceKeys,
    groupMode,
  });
  usePruneUnpinnedWorkspaceFolders();
  const projectionInput = useMemo(
    () => ({
      projects: filteredProjects,
      pinnedKeys,
      pinnedWorkspaceOrder,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      projectNamesByViewKey: list.projectNamesByViewKey,
      groupMode,
      pinnedCollapsed,
      collapsedProjectKeys,
      collapsedWorkspaceGroupKeys,
      pinnedFolders,
      workspaceParentKeys,
      collapsedWorkspaceTreeKeys,
      t,
    }),
    [
      pinnedFolders,
      workspaceParentKeys,
      collapsedWorkspaceTreeKeys,
      collapsedProjectKeys,
      collapsedWorkspaceGroupKeys,
      groupMode,
      list.projectNamesByViewKey,
      filteredProjects,
      pinnedCollapsed,
      pinnedKeys,
      pinnedWorkspaceOrder,
      filteredWorkspaceEntriesByKey,
      t,
    ],
  );
  const projection = useMemo(() => buildSidebarProjection(projectionInput), [projectionInput]);
  const value = useMemo(
    () => ({
      ...list,
      projects: filteredProjects,
      allProjects: list.projects,
      resolvedProjectFilters,
      hasProjectsBeforeFilter: list.projects.length > 0,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      groupMode,
      workspaceGroups: projection.workspaceGroups,
      projectIconTargets: projection.projectIconTargets,
      pinnedGroups: projection.pinnedGroups,
      collapsedProjectKeys,
      toggleProjectCollapsed,
      workspaceParentKeys,
      shortcutModel: projection.shortcutModel,
    }),
    [
      workspaceParentKeys,
      resolvedProjectFilters,
      collapsedProjectKeys,
      groupMode,
      list,
      filteredProjects,
      projection,
      toggleProjectCollapsed,
      filteredWorkspaceEntriesByKey,
    ],
  );

  return <SidebarModelContext.Provider value={value}>{children}</SidebarModelContext.Provider>;
}

// Entries churn on every status change; the ancestry under them almost never does. Holding the
// previous map keeps the project blocks' memo from seeing a new tree on every status tick.
function useStableWorkspaceParentKeys(
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
): WorkspaceParentKeys {
  const previousRef = useRef<WorkspaceParentKeys>(new Map());
  return useMemo(() => {
    const next = buildWorkspaceParentKeys(entries.values());
    if (areWorkspaceParentKeysEqual(previousRef.current, next)) return previousRef.current;
    previousRef.current = next;
    return next;
  }, [entries]);
}

/**
 * Arriving at a handoff from outside the sidebar (a notification, the command center, a shortcut)
 * opens the collapsed parents above it, once. The collapsed set stays the only thing that decides
 * what is on screen, so the chevrons and the keyboard shortcuts always agree with the rows.
 */
function useRevealOpenWorkspace(input: {
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>;
  parentKeys: WorkspaceParentKeys;
  pinnedWorkspaceKeys: readonly string[];
  groupMode: SidebarGroupMode;
}): void {
  const { entries, parentKeys, pinnedWorkspaceKeys, groupMode } = input;
  const selection = useLastWorkspaceSelection();
  const selectionKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;
  const revealedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Ancestry is only known once the entry is; until then the arrival is still pending.
    if (!selectionKey || revealedKeyRef.current === selectionKey || !entries.has(selectionKey)) {
      return;
    }
    revealedKeyRef.current = selectionKey;
    const pinned = new Set(pinnedWorkspaceKeys);
    const store = useSidebarCollapsedSectionsStore.getState();
    const hidingKeys = collapsedAncestorKeys({
      workspaceKey: selectionKey,
      parentKeys,
      collapsedKeys: store.collapsedWorkspaceTreeKeys,
      // The lists that nest: Pinned, and each project's own list in project mode.
      nestsUnder: (childKey, parentKey) => {
        if (pinned.has(childKey) !== pinned.has(parentKey)) return false;
        if (pinned.has(childKey)) return true;
        return (
          groupMode === "project" &&
          entries.get(childKey)?.projectViewKey === entries.get(parentKey)?.projectViewKey
        );
      },
    });
    if (hidingKeys.length > 0) store.expandWorkspaceTrees(hidingKeys);
  }, [entries, groupMode, parentKeys, pinnedWorkspaceKeys, selectionKey]);
}

export function useSidebarModel(): SidebarModel {
  const model = useContext(SidebarModelContext);
  if (!model) throw new Error("SidebarModelProvider is required");
  return model;
}
