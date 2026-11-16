import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  togglePinnedCollapsed,
  toggleProjectCollapsed,
  toggleWorkspaceGroupCollapsed,
  toggleWorkspaceTreeCollapsed,
  expandWorkspaceTrees,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return {
    collapsedProjectKeys: new Set(),
    collapsedWorkspaceGroupKeys: new Set(),
    collapsedPinned: false,
    collapsedWorkspaceTreeKeys: new Set(),
  };
}

describe("sidebar collapsed projects transitions", () => {
  it("tracks collapsed project keys as a Set", () => {
    let state = emptyState();

    state = setProjectCollapsed(state, "project-a", true);
    state = toggleProjectCollapsed(state, "project-b");
    state = toggleProjectCollapsed(state, "project-a");
    state = toggleWorkspaceGroupCollapsed(state, "running");

    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedWorkspaceGroupKeys)).toEqual(["running"]);
  });

  it("serializes collapsed project keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a", "project-b"]),
      collapsedWorkspaceGroupKeys: new Set(["running"]),
      collapsedPinned: true,
      collapsedWorkspaceTreeKeys: new Set(["host:parent"]),
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedProjectKeys: ["project-a", "project-b"],
      collapsedWorkspaceGroupKeys: ["running"],
      collapsedPinned: true,
      collapsedWorkspaceTreeKeys: ["host:parent"],
    });
  });

  it("toggles and restores the pinned section collapse flag", () => {
    const toggled = togglePinnedCollapsed(emptyState());
    expect(toggled.collapsedPinned).toBe(true);

    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedPinned).toBe(true);
  });

  it("toggles and restores collapsed handoff parents", () => {
    const toggled = toggleWorkspaceTreeCollapsed(emptyState(), "host:parent");
    expect(Array.from(toggled.collapsedWorkspaceTreeKeys)).toEqual(["host:parent"]);
    expect(
      Array.from(toggleWorkspaceTreeCollapsed(toggled, "host:parent").collapsedWorkspaceTreeKeys),
    ).toEqual([]);

    const restored = mergePersistedCollapsedProjects(
      { collapsedWorkspaceTreeKeys: ["host:parent"] },
      emptyState(),
    );
    expect(Array.from(restored.collapsedWorkspaceTreeKeys)).toEqual(["host:parent"]);
  });

  it("rejects the complete value when a persisted project key is invalid", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a", "project-b", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectKeys)).toEqual([]);
    expect(Array.from(restored.collapsedWorkspaceGroupKeys)).toEqual([]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedProjectKeys: [] }, currentState)).toBe(
      currentState,
    );
  });

  it("opens collapsed handoff parents, keeping the state object when none was collapsed", () => {
    const collapsed = toggleWorkspaceTreeCollapsed(
      toggleWorkspaceTreeCollapsed(emptyState(), "host:parent"),
      "host:other",
    );

    expect(
      Array.from(
        expandWorkspaceTrees(collapsed, ["host:parent", "host:open"]).collapsedWorkspaceTreeKeys,
      ),
    ).toEqual(["host:other"]);
    expect(expandWorkspaceTrees(collapsed, ["host:open"])).toBe(collapsed);
  });
});
