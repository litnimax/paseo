import { z } from "zod";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import { persistAppSettings, type AppSettings } from "@/hooks/use-settings";
import { SIDEBAR_CHECKS_DISPLAYS } from "@/components/sidebar/display-preferences/checks-display";
import { parseSidebarRowItems } from "@/components/sidebar/display-preferences/row-items";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarPinnedFoldersStore } from "@/stores/sidebar-pinned-folders-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

/**
 * A team member's view: everything that decides how their sidebar looks, and nothing about what
 * is in it. Saved on the host per member, loaded on any client that chooses them.
 *
 * The host stores this opaquely, so the shape is this file's to version. Reading is lenient on
 * purpose: a profile saved by a newer or older app applies what this app understands and leaves
 * the rest of the current view alone.
 */
export const VIEW_PROFILE_VERSION = 1;

export type ViewDisplaySettings = Pick<
  AppSettings,
  "workspaceTitleSource" | "sidebarWorkspaceTrailing" | "sidebarRowItems" | "sidebarChecksDisplay"
>;

export interface ViewProfile {
  version: typeof VIEW_PROFILE_VERSION;
  sidebar: {
    groupMode: "project" | "status";
    workspaceSort: "manual" | "created" | "lastPrompt";
    showBackground: boolean;
    hostFilters: string[];
    projectFilters: string[];
    labelFilter: string[];
  };
  display: ViewDisplaySettings;
  collapsed: {
    projects: string[];
    workspaceGroups: string[];
    pinned: boolean;
    workspaceTrees: string[];
    pinnedFolders: string[];
  };
  order: {
    projects: string[];
    pinned: string[];
    workspacesByProject: Record<string, string[]>;
  };
}

const lenient = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);
const Keys = lenient(z.array(z.string()));

const ViewProfileSchema = z.object({
  sidebar: lenient(
    z.object({
      groupMode: lenient(z.enum(["project", "status"])),
      workspaceSort: lenient(z.enum(["manual", "created", "lastPrompt"])),
      showBackground: lenient(z.boolean()),
      hostFilters: Keys,
      projectFilters: Keys,
      labelFilter: Keys,
    }),
  ),
  display: lenient(
    z.object({
      workspaceTitleSource: lenient(z.enum(["title", "branch"])),
      sidebarWorkspaceTrailing: lenient(z.enum(["diff", "timestamp", "none"])),
      sidebarRowItems: lenient(z.record(z.string(), z.boolean())),
      sidebarChecksDisplay: lenient(z.enum(SIDEBAR_CHECKS_DISPLAYS)),
    }),
  ),
  collapsed: lenient(
    z.object({
      projects: Keys,
      workspaceGroups: Keys,
      pinned: lenient(z.boolean()),
      workspaceTrees: Keys,
      pinnedFolders: Keys,
    }),
  ),
  order: lenient(
    z.object({
      projects: Keys,
      pinned: Keys,
      workspacesByProject: lenient(z.record(z.string(), z.array(z.string()))),
    }),
  ),
});

/** What a saved view says, section by section; a section or field it does not say is left as is. */
export type ParsedViewProfile = z.infer<typeof ViewProfileSchema>;

export function parseViewProfile(view: unknown): ParsedViewProfile {
  const result = ViewProfileSchema.safeParse(view);
  return result.success ? result.data : {};
}

/** The current view of this client, ready to save. */
export function captureViewProfile(display: ViewDisplaySettings): ViewProfile {
  const sidebar = useSidebarViewStore.getState();
  const collapsed = useSidebarCollapsedSectionsStore.getState();
  const order = useSidebarOrderStore.getState();
  const folders = useSidebarPinnedFoldersStore.getState();
  return {
    version: VIEW_PROFILE_VERSION,
    sidebar: {
      groupMode: sidebar.groupMode,
      workspaceSort: sidebar.workspaceSort,
      showBackground: sidebar.showBackground,
      hostFilters: [...sidebar.hostFilters],
      projectFilters: [...sidebar.projectFilters],
      labelFilter: [...sidebar.labelFilter.labels],
    },
    display: {
      workspaceTitleSource: display.workspaceTitleSource,
      sidebarWorkspaceTrailing: display.sidebarWorkspaceTrailing,
      sidebarRowItems: display.sidebarRowItems,
      sidebarChecksDisplay: display.sidebarChecksDisplay,
    },
    collapsed: {
      projects: [...collapsed.collapsedProjectKeys],
      workspaceGroups: [...collapsed.collapsedWorkspaceGroupKeys],
      pinned: collapsed.collapsedPinned,
      workspaceTrees: [...collapsed.collapsedWorkspaceTreeKeys],
      pinnedFolders: [...folders.collapsedFolderIds],
    },
    order: {
      projects: [...order.projectOrder],
      pinned: [...order.pinnedWorkspaceOrder],
      workspacesByProject: { ...order.workspaceOrderByProject },
    },
  };
}

/** The profile as the host stores it: plain JSON. */
export function toWireView(profile: ViewProfile): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(profile)) as Record<string, JsonValue>;
}

/** Puts a saved view on screen. Each store keeps whatever the profile does not mention. */
export async function applyViewProfile(profile: ParsedViewProfile): Promise<void> {
  const { sidebar, display, collapsed, order } = profile;
  if (sidebar) {
    useSidebarViewStore.setState((state) => ({
      groupMode: sidebar.groupMode ?? state.groupMode,
      workspaceSort: sidebar.workspaceSort ?? state.workspaceSort,
      showBackground: sidebar.showBackground ?? state.showBackground,
      hostFilters: sidebar.hostFilters ?? state.hostFilters,
      projectFilters: sidebar.projectFilters ?? state.projectFilters,
      labelFilter: sidebar.labelFilter ? { labels: sidebar.labelFilter } : state.labelFilter,
    }));
  }
  if (collapsed) {
    useSidebarCollapsedSectionsStore.setState((state) => ({
      collapsedProjectKeys: collapsed.projects
        ? new Set(collapsed.projects)
        : state.collapsedProjectKeys,
      collapsedWorkspaceGroupKeys: collapsed.workspaceGroups
        ? new Set(collapsed.workspaceGroups)
        : state.collapsedWorkspaceGroupKeys,
      collapsedPinned: collapsed.pinned ?? state.collapsedPinned,
      collapsedWorkspaceTreeKeys: collapsed.workspaceTrees
        ? new Set(collapsed.workspaceTrees)
        : state.collapsedWorkspaceTreeKeys,
    }));
    if (collapsed.pinnedFolders) {
      useSidebarPinnedFoldersStore.setState({ collapsedFolderIds: collapsed.pinnedFolders });
    }
  }
  if (order) {
    useSidebarOrderStore.setState((state) => ({
      projectOrder: order.projects ?? state.projectOrder,
      pinnedWorkspaceOrder: order.pinned ?? state.pinnedWorkspaceOrder,
      workspaceOrderByProject: order.workspacesByProject ?? state.workspaceOrderByProject,
    }));
  }
  if (display) {
    const updates: Partial<AppSettings> = {};
    if (display.workspaceTitleSource) updates.workspaceTitleSource = display.workspaceTitleSource;
    if (display.sidebarWorkspaceTrailing) {
      updates.sidebarWorkspaceTrailing = display.sidebarWorkspaceTrailing;
    }
    if (display.sidebarRowItems)
      updates.sidebarRowItems = parseSidebarRowItems(display.sidebarRowItems);
    if (display.sidebarChecksDisplay) updates.sidebarChecksDisplay = display.sidebarChecksDisplay;
    if (Object.keys(updates).length > 0) await persistAppSettings(updates);
  }
}
