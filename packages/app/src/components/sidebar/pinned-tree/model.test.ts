import { describe, expect, it } from "vitest";
import type { PinnedFolder } from "@/stores/sidebar-pinned-folders-store";
import {
  buildPinnedTree,
  flattenPinnedWorkspaceKeys,
  flattenVisiblePinnedWorkspaces,
  listPinnedFolderPaths,
  resolvePinnedDrop,
} from "./model";

const ws = (id: string) => ({ workspaceKey: `srv:${id}` });
const folders: PinnedFolder[] = [
  { id: "work", name: "Work", parentId: null },
  { id: "acme", name: "acme", parentId: "work" },
  { id: "archive", name: "Archive", parentId: null },
];

describe("pinned folder tree", () => {
  const workspaces = [ws("one"), ws("two"), ws("three"), ws("four")];
  const folderIdByWorkspaceKey = { "srv:two": "work", "srv:three": "acme", "srv:four": "deleted" };

  it("lists folders by name before pins at each level, and sends stale pins to the root", () => {
    const tree = buildPinnedTree({
      workspaces,
      folders,
      folderIdByWorkspaceKey,
      collapsedFolderIds: [],
      parentKeys: new Map(),
    });

    expect(
      tree.map((node) => (node.kind === "folder" ? node.folder.name : node.workspace.workspaceKey)),
    ).toEqual(["Archive", "Work", "srv:one", "srv:four"]);
    const work = tree[1];
    expect(work?.kind === "folder" ? work.workspaceCount : null).toBe(2);
    expect(flattenPinnedWorkspaceKeys(tree)).toEqual([
      "srv:three",
      "srv:two",
      "srv:one",
      "srv:four",
    ]);
  });

  it("skips the pins inside collapsed folders when numbering shortcuts", () => {
    const tree = buildPinnedTree({
      workspaces,
      folders,
      folderIdByWorkspaceKey,
      collapsedFolderIds: ["acme"],
      parentKeys: new Map(),
    });

    expect(
      flattenVisiblePinnedWorkspaces(tree, new Set()).map((item) => item.workspaceKey),
    ).toEqual(["srv:two", "srv:one", "srv:four"]);
  });

  it("nests a pinned handoff under its pinned parent, in the parent's folder", () => {
    const tree = buildPinnedTree({
      workspaces: [ws("child"), ws("parent")],
      folders,
      // The handoff's own filing is overruled while its parent is pinned.
      folderIdByWorkspaceKey: { "srv:parent": "archive", "srv:child": "work" },
      collapsedFolderIds: [],
      parentKeys: new Map([["srv:child", "srv:parent"]]),
    });

    const archive = tree.find((node) => node.kind === "folder" && node.folder.id === "archive");
    expect(archive?.kind === "folder" ? archive.workspaceCount : null).toBe(2);
    const work = tree.find((node) => node.kind === "folder" && node.folder.id === "work");
    expect(work?.kind === "folder" ? work.workspaceCount : null).toBe(0);
    expect(flattenPinnedWorkspaceKeys(tree)).toEqual(["srv:parent", "srv:child"]);
    expect(
      flattenVisiblePinnedWorkspaces(tree, new Set(["srv:parent"])).map(
        (item) => item.workspaceKey,
      ),
    ).toEqual(["srv:parent"]);
  });

  it("resolves drops onto folders, the root and other pins", () => {
    const base = { folders, folderIdByWorkspaceKey, pinnedOrder: ["srv:one", "srv:two"] };

    expect(
      resolvePinnedDrop({
        ...base,
        item: { kind: "workspace", workspaceKey: "srv:one" },
        target: { kind: "folder", folderId: "archive" },
      }),
    ).toEqual({
      kind: "move-workspace",
      workspaceKey: "srv:one",
      folderId: "archive",
      pinnedOrder: null,
    });
    expect(
      resolvePinnedDrop({
        ...base,
        item: { kind: "workspace", workspaceKey: "srv:one" },
        target: { kind: "workspace", workspaceKey: "srv:two", position: "after" },
      }),
    ).toEqual({
      kind: "move-workspace",
      workspaceKey: "srv:one",
      folderId: "work",
      pinnedOrder: ["srv:two", "srv:one"],
    });
    expect(
      resolvePinnedDrop({
        ...base,
        item: { kind: "workspace", workspaceKey: "srv:two" },
        target: { kind: "root" },
      }),
    ).toEqual({
      kind: "move-workspace",
      workspaceKey: "srv:two",
      folderId: null,
      pinnedOrder: null,
    });
    expect(
      resolvePinnedDrop({
        ...base,
        item: { kind: "workspace", workspaceKey: "srv:one" },
        target: { kind: "root" },
      }),
    ).toEqual({ kind: "none" });
  });

  it("never drops a folder into its own subtree", () => {
    const base = { folders, folderIdByWorkspaceKey, pinnedOrder: [] };

    expect(
      resolvePinnedDrop({
        ...base,
        item: { kind: "folder", folderId: "work" },
        target: { kind: "folder", folderId: "acme" },
      }),
    ).toEqual({ kind: "none" });
    expect(
      resolvePinnedDrop({
        ...base,
        item: { kind: "folder", folderId: "acme" },
        target: { kind: "root" },
      }),
    ).toEqual({ kind: "move-folder", folderId: "acme", parentId: null });
  });

  it("gives a folder no place next to a pin", () => {
    expect(
      resolvePinnedDrop({
        folders,
        folderIdByWorkspaceKey,
        pinnedOrder: ["srv:one", "srv:two"],
        item: { kind: "folder", folderId: "archive" },
        target: { kind: "workspace", workspaceKey: "srv:two", position: "before" },
      }),
    ).toEqual({ kind: "none" });
  });

  it("lists folders in tree order with their paths", () => {
    expect(listPinnedFolderPaths(folders).map((row) => row.path)).toEqual([
      "Archive",
      "Work",
      "Work / acme",
    ]);
  });
});
