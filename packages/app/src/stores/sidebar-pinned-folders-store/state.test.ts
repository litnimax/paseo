import { describe, expect, it } from "vitest";
import {
  EMPTY_PINNED_FOLDERS_STATE,
  assignWorkspaceFolder,
  createFolder,
  deleteFolder,
  forgetWorkspaceFolders,
  mergePersistedPinnedFolders,
  moveFolder,
  renameFolder,
  type PinnedFoldersState,
} from "./state";

function withFolders(): PinnedFoldersState {
  let state = createFolder(EMPTY_PINNED_FOLDERS_STATE, {
    id: "a",
    name: "Clients",
    parentId: null,
  });
  state = createFolder(state, { id: "b", name: " Acme ", parentId: "a" });
  return assignWorkspaceFolder(state, "srv:one", "b");
}

describe("pinned folders state", () => {
  it("creates nested folders with trimmed names and files pins into them", () => {
    const state = withFolders();

    expect(state.folders).toEqual([
      { id: "a", name: "Clients", parentId: null },
      { id: "b", name: "Acme", parentId: "a" },
    ]);
    expect(state.folderIdByWorkspaceKey).toEqual({ "srv:one": "b" });
    expect(createFolder(state, { id: "c", name: "   ", parentId: null })).toBe(state);
  });

  it("moves a deleted folder's pins and subfolders up one level", () => {
    const state = deleteFolder(withFolders(), "a");

    expect(state.folders).toEqual([{ id: "b", name: "Acme", parentId: null }]);
    expect(state.folderIdByWorkspaceKey).toEqual({ "srv:one": "b" });
    expect(deleteFolder(state, "b").folderIdByWorkspaceKey).toEqual({});
  });

  it("refuses to move a folder into itself or its own subfolder", () => {
    const state = withFolders();

    expect(moveFolder(state, "a", "b")).toBe(state);
    expect(moveFolder(state, "a", "a")).toBe(state);
    expect(moveFolder(state, "b", null).folders[1]).toEqual({
      id: "b",
      name: "Acme",
      parentId: null,
    });
  });

  it("files a pin back in the root, and ignores folders that do not exist", () => {
    const state = withFolders();

    expect(assignWorkspaceFolder(state, "srv:one", null).folderIdByWorkspaceKey).toEqual({});
    expect(assignWorkspaceFolder(state, "srv:two", "missing")).toBe(state);
    expect(renameFolder(state, "a", "Customers").folders[0]?.name).toBe("Customers");
  });

  it("repairs stored folders whose parent is gone or loops", () => {
    const restored = mergePersistedPinnedFolders(
      {
        folders: [
          { id: "orphan", name: "Orphan", parentId: "gone" },
          { id: "x", name: "X", parentId: "y" },
          { id: "y", name: "Y", parentId: "x" },
        ],
        folderIdByWorkspaceKey: { "srv:one": "orphan", "srv:two": "gone" },
        collapsedFolderIds: ["x", "gone"],
      },
      EMPTY_PINNED_FOLDERS_STATE,
    );

    expect(restored.folders.map((folder) => folder.parentId)).toEqual([null, null, null]);
    expect(restored.folderIdByWorkspaceKey).toEqual({ "srv:one": "orphan" });
    expect(restored.collapsedFolderIds).toEqual(["x"]);
  });

  it("forgets the folder of workspaces that are no longer pinned", () => {
    const state = assignWorkspaceFolder(withFolders(), "srv:two", "a");

    expect(forgetWorkspaceFolders(state, ["srv:one", "srv:gone"]).folderIdByWorkspaceKey).toEqual({
      "srv:two": "a",
    });
    expect(forgetWorkspaceFolders(state, ["srv:gone"])).toBe(state);
  });
});
