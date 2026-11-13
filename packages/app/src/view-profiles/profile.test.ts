import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarPinnedFoldersStore } from "@/stores/sidebar-pinned-folders-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { applyViewProfile, captureViewProfile, parseViewProfile, toWireView } from "./profile";
import { resolveViewProfileHost, shouldApplySavedView } from "./sync";

const display = {
  workspaceTitleSource: "branch" as const,
  sidebarWorkspaceTrailing: "diff" as const,
  sidebarRowItems: { ...DEFAULT_SIDEBAR_ROW_ITEMS, branch: true },
  sidebarChecksDisplay: "icon" as const,
};

function setMaxsView() {
  useSidebarViewStore.setState({
    groupMode: "status",
    workspaceSort: "manual",
    showBackground: true,
    hostFilters: ["srv"],
    projectFilters: ["project-a"],
    labelFilter: { labels: ["urgent"] },
  });
  useSidebarCollapsedSectionsStore.setState({
    collapsedProjectKeys: new Set(["project-b"]),
    collapsedWorkspaceGroupKeys: new Set(["done"]),
    collapsedPinned: true,
    collapsedWorkspaceTreeKeys: new Set(["srv:parent"]),
  });
  useSidebarPinnedFoldersStore.setState({ collapsedFolderIds: ["pf_clients"] });
  useSidebarOrderStore.setState({
    projectOrder: ["project-b", "project-a"],
    pinnedWorkspaceOrder: ["srv:two", "srv:one"],
    workspaceOrderByProject: { "project-a": ["srv:three"] },
  });
}

function resetView() {
  useSidebarViewStore.setState({
    groupMode: "project",
    workspaceSort: "created",
    showBackground: false,
    hostFilters: [],
    projectFilters: [],
    labelFilter: { labels: [] },
  });
  useSidebarCollapsedSectionsStore.setState({
    collapsedProjectKeys: new Set(),
    collapsedWorkspaceGroupKeys: new Set(),
    collapsedPinned: false,
    collapsedWorkspaceTreeKeys: new Set(),
  });
  useSidebarPinnedFoldersStore.setState({ collapsedFolderIds: [] });
  useSidebarOrderStore.setState({
    projectOrder: [],
    pinnedWorkspaceOrder: [],
    workspaceOrderByProject: {},
  });
}

describe("a team member's saved view", () => {
  beforeEach(resetView);

  it("puts back exactly the view that was saved, through the host's JSON", async () => {
    setMaxsView();
    const saved = toWireView(captureViewProfile(display));
    resetView();

    await applyViewProfile(parseViewProfile(JSON.parse(JSON.stringify(saved))));

    expect(captureViewProfile(display)).toEqual(saved);
    expect(useSidebarCollapsedSectionsStore.getState().collapsedProjectKeys).toEqual(
      new Set(["project-b"]),
    );
  });

  it("applies what it understands and leaves the rest of the current view alone", async () => {
    setMaxsView();

    await applyViewProfile(
      parseViewProfile({
        version: 9,
        sidebar: { groupMode: "status-by-mood", workspaceSort: "created" },
        future: { anything: true },
      }),
    );

    const view = useSidebarViewStore.getState();
    expect(view.groupMode).toBe("status");
    expect(view.workspaceSort).toBe("created");
    expect(useSidebarOrderStore.getState().projectOrder).toEqual(["project-b", "project-a"]);
    expect(parseViewProfile("not a view")).toEqual({});
  });
});

describe("whose view a client follows", () => {
  it("prefers the default host's member, then the first host that has one", () => {
    const hosts = [
      { serverId: "a", operatorId: null },
      { serverId: "b", operatorId: "jurij" },
      { serverId: "c", operatorId: " max " },
    ];

    expect(resolveViewProfileHost({ hosts, defaultHostServerId: "c" })).toEqual({
      serverId: "c",
      operatorId: "max",
    });
    expect(resolveViewProfileHost({ hosts, defaultHostServerId: "a" })).toEqual({
      serverId: "b",
      operatorId: "jurij",
    });
    expect(
      resolveViewProfileHost({ hosts: [{ serverId: "a" }], defaultHostServerId: null }),
    ).toBeNull();
  });

  it("loads on a new member or a newer save, not over this device's own copy", () => {
    const savedAt = "2026-11-13T10:00:00.000Z";
    const applied = { serverId: "srv", operatorId: "max", revision: 3, savedAt };
    const host = { serverId: "srv", operatorId: "max", revision: 3, savedAt };

    expect(shouldApplySavedView({ ...host, applied: null })).toBe(true);
    expect(shouldApplySavedView({ ...host, applied })).toBe(false);
    expect(shouldApplySavedView({ ...host, applied, revision: 4 })).toBe(true);
    expect(shouldApplySavedView({ ...host, applied, operatorId: "jurij" })).toBe(true);
    // The host lost its file and counted back up to the same revision with another view.
    expect(shouldApplySavedView({ ...host, applied, savedAt: "2026-11-14T09:00:00.000Z" })).toBe(
      true,
    );
  });
});
