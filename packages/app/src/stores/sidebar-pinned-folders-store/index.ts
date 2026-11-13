import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  EMPTY_PINNED_FOLDERS_STATE,
  PersistedPinnedFoldersSchema,
  assignWorkspaceFolder,
  createFolder,
  deleteFolder,
  forgetWorkspaceFolders,
  mergePersistedPinnedFolders,
  moveFolder,
  renameFolder,
  toggleFolderCollapsed,
  type PersistedPinnedFolders,
  type PinnedFoldersState,
} from "./state";

export type { PinnedFolder, PinnedFoldersState } from "./state";
export { isFolderWithin } from "./state";

interface SidebarPinnedFoldersStore extends PinnedFoldersState {
  /** Returns the new folder's id. */
  createFolder: (input: { name: string; parentId: string | null }) => string;
  renameFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => void;
  moveFolder: (folderId: string, parentId: string | null) => void;
  /** Null files the pin back in the Pinned root. */
  assignWorkspaceFolder: (workspaceKey: string, folderId: string | null) => void;
  forgetWorkspaceFolders: (workspaceKeys: readonly string[]) => void;
  toggleFolderCollapsed: (folderId: string) => void;
}

function generateFolderId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return `pf_${cryptoObj.randomUUID().replace(/-/g, "")}`;
  }
  return `pf_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export const useSidebarPinnedFoldersStore = create<SidebarPinnedFoldersStore>()(
  persist<SidebarPinnedFoldersStore, [], [], PersistedPinnedFolders>(
    (set) => ({
      ...EMPTY_PINNED_FOLDERS_STATE,
      createFolder: ({ name, parentId }) => {
        const id = generateFolderId();
        set((state) => createFolder(state, { id, name, parentId }));
        return id;
      },
      renameFolder: (folderId, name) => set((state) => renameFolder(state, folderId, name)),
      deleteFolder: (folderId) => set((state) => deleteFolder(state, folderId)),
      moveFolder: (folderId, parentId) => set((state) => moveFolder(state, folderId, parentId)),
      assignWorkspaceFolder: (workspaceKey, folderId) =>
        set((state) => assignWorkspaceFolder(state, workspaceKey, folderId)),
      forgetWorkspaceFolders: (workspaceKeys) =>
        set((state) => forgetWorkspaceFolders(state, workspaceKeys)),
      toggleFolderCollapsed: (folderId) => set((state) => toggleFolderCollapsed(state, folderId)),
    }),
    {
      name: "sidebar-pinned-folders",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedPinnedFoldersSchema),
      partialize: (state) => ({
        folders: state.folders,
        folderIdByWorkspaceKey: state.folderIdByWorkspaceKey,
        collapsedFolderIds: state.collapsedFolderIds,
      }),
      merge: (persisted, current) => mergePersistedPinnedFolders(persisted, current),
    },
  ),
);
