import { describe, expect, it } from "vitest";
import {
  buildWorkspaceForest,
  buildWorkspaceParentKeys,
  collapsedAncestorKeys,
  findWorkspaceRootKey,
  flattenWorkspaceForest,
  orderWorkspacesAsForest,
  subtreeStatusBucket,
  toWorkspaceTreeRoots,
  workspaceTreeRootHasSelection,
} from "./workspace-tree";

const ws = (id: string) => ({ workspaceKey: `srv:${id}` });
const keys = (items: { workspaceKey: string }[]) => items.map((item) => item.workspaceKey);

describe("workspace handoff tree", () => {
  const parents = buildWorkspaceParentKeys([
    { workspaceKey: "srv:child", serverId: "srv", parentWorkspaceId: "main" },
    { workspaceKey: "srv:grandchild", serverId: "srv", parentWorkspaceId: "child" },
    { workspaceKey: "srv:main", serverId: "srv" },
  ]);

  it("places each handoff right under its parent, keeping list order at every level", () => {
    const items = [ws("grandchild"), ws("other"), ws("child"), ws("main")];

    expect(keys(orderWorkspacesAsForest(items, parents))).toEqual([
      "srv:other",
      "srv:main",
      "srv:child",
      "srv:grandchild",
    ]);
    const forest = buildWorkspaceForest(items, parents);
    expect(forest[1]?.children[0]?.children[0]?.depth).toBe(2);
  });

  it("keeps a handoff at the top level when its parent is not in the list", () => {
    const forest = buildWorkspaceForest([ws("child"), ws("grandchild")], parents);

    expect(forest.map((node) => node.workspace.workspaceKey)).toEqual(["srv:child"]);
    expect(forest[0]?.children.map((node) => node.workspace.workspaceKey)).toEqual([
      "srv:grandchild",
    ]);
  });

  it("stops at collapsed parents when flattening for shortcuts", () => {
    const forest = buildWorkspaceForest([ws("main"), ws("child"), ws("grandchild")], parents);

    expect(keys(flattenWorkspaceForest(forest, new Set(["srv:child"])))).toEqual([
      "srv:main",
      "srv:child",
    ]);
  });

  it("shows every member of an ancestry cycle instead of dropping them", () => {
    const cyclic = new Map([
      ["srv:a", "srv:b"],
      ["srv:b", "srv:a"],
    ]);

    expect(keys(orderWorkspacesAsForest([ws("a"), ws("b")], cyclic))).toEqual(["srv:a", "srv:b"]);
  });

  it("surfaces the most urgent status in a subtree", () => {
    const forest = buildWorkspaceForest([ws("main"), ws("child")], parents);
    const buckets: Record<string, "done" | "needs_input"> = {
      "srv:main": "done",
      "srv:child": "needs_input",
    };

    expect(subtreeStatusBucket(forest[0]!, (item) => buckets[item.workspaceKey] ?? "done")).toBe(
      "needs_input",
    );
  });

  it("finds the open workspace under a root, and the root a workspace is shown in", () => {
    const forest = buildWorkspaceForest(
      [
        { ...ws("main"), serverId: "srv", workspaceId: "main" },
        { ...ws("child"), serverId: "srv", workspaceId: "child" },
        { ...ws("other"), serverId: "srv", workspaceId: "other" },
      ],
      parents,
    );
    const [main, other] = toWorkspaceTreeRoots(forest);

    const openChild = { serverId: "srv", workspaceId: "child" };
    expect(workspaceTreeRootHasSelection(main!, openChild)).toBe(true);
    expect(workspaceTreeRootHasSelection(other!, openChild)).toBe(false);
    expect(findWorkspaceRootKey(forest, "srv:child")).toBe("srv:main");
    expect(findWorkspaceRootKey(forest, "srv:missing")).toBeNull();
  });

  it("lists the collapsed parents hiding a workspace, only while they share its list", () => {
    const input = {
      workspaceKey: "srv:grandchild",
      parentKeys: parents,
      collapsedKeys: new Set(["srv:main", "srv:child", "srv:other"]),
    };

    expect(collapsedAncestorKeys({ ...input, nestsUnder: () => true })).toEqual([
      "srv:child",
      "srv:main",
    ]);
    expect(
      collapsedAncestorKeys({ ...input, nestsUnder: (_child, parent) => parent !== "srv:main" }),
    ).toEqual(["srv:child"]);
  });
});
