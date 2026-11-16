import { z } from "zod";

/**
 * Folders inside the sidebar's Pinned section. App-local, like the pinned order: the host owns
 * whether a workspace is pinned, the device owns how its pins are filed.
 */
export interface PinnedFolder {
  id: string;
  name: string;
  /** Null for a folder directly under Pinned. */
  parentId: string | null;
}

export interface PinnedFoldersState {
  folders: PinnedFolder[];
  /** workspaceKey -> folder id. A pin with no entry lives in the Pinned root. */
  folderIdByWorkspaceKey: Record<string, string>;
  collapsedFolderIds: string[];
}

export const PersistedPinnedFoldersSchema = z.strictObject({
  folders: z
    .array(z.strictObject({ id: z.string(), name: z.string(), parentId: z.string().nullable() }))
    .optional(),
  folderIdByWorkspaceKey: z.record(z.string(), z.string()).optional(),
  collapsedFolderIds: z.array(z.string()).optional(),
});

export type PersistedPinnedFolders = z.infer<typeof PersistedPinnedFoldersSchema>;

export const EMPTY_PINNED_FOLDERS_STATE: PinnedFoldersState = {
  folders: [],
  folderIdByWorkspaceKey: {},
  collapsedFolderIds: [],
};

export function createFolder(state: PinnedFoldersState, folder: PinnedFolder): PinnedFoldersState {
  const name = folder.name.trim();
  if (!name || state.folders.some((existing) => existing.id === folder.id)) return state;
  const parentId = folder.parentId && hasFolder(state, folder.parentId) ? folder.parentId : null;
  return {
    ...state,
    folders: [...state.folders, { id: folder.id, name, parentId }],
    // A folder you just made inside another is one you are about to fill, so open its parent.
    collapsedFolderIds: parentId
      ? state.collapsedFolderIds.filter((id) => id !== parentId)
      : state.collapsedFolderIds,
  };
}

export function renameFolder(
  state: PinnedFoldersState,
  folderId: string,
  name: string,
): PinnedFoldersState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    folders: state.folders.map((folder) =>
      folder.id === folderId ? { id: folder.id, name: trimmed, parentId: folder.parentId } : folder,
    ),
  };
}

/** Deleting a folder never unpins anything: its folders and pins move up to its parent. */
export function deleteFolder(state: PinnedFoldersState, folderId: string): PinnedFoldersState {
  const folder = state.folders.find((candidate) => candidate.id === folderId);
  if (!folder) return state;
  const folderIdByWorkspaceKey: Record<string, string> = {};
  for (const [workspaceKey, assigned] of Object.entries(state.folderIdByWorkspaceKey)) {
    if (assigned !== folderId) {
      folderIdByWorkspaceKey[workspaceKey] = assigned;
    } else if (folder.parentId) {
      folderIdByWorkspaceKey[workspaceKey] = folder.parentId;
    }
  }
  return {
    folders: state.folders
      .filter((candidate) => candidate.id !== folderId)
      .map((candidate) =>
        withParent(
          candidate,
          candidate.parentId === folderId ? folder.parentId : candidate.parentId,
        ),
      ),
    folderIdByWorkspaceKey,
    collapsedFolderIds: state.collapsedFolderIds.filter((id) => id !== folderId),
  };
}

export function isFolderWithin(
  folders: readonly PinnedFolder[],
  folderId: string,
  ancestorId: string,
): boolean {
  const parentById = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  const seen = new Set<string>();
  let current: string | null = folderId;
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

export function moveFolder(
  state: PinnedFoldersState,
  folderId: string,
  parentId: string | null,
): PinnedFoldersState {
  const folder = state.folders.find((candidate) => candidate.id === folderId);
  if (!folder || folder.parentId === parentId) return state;
  if (
    parentId &&
    (!hasFolder(state, parentId) || isFolderWithin(state.folders, parentId, folderId))
  )
    return state;
  return {
    ...state,
    folders: state.folders.map((candidate) =>
      withParent(candidate, candidate.id === folderId ? parentId : candidate.parentId),
    ),
  };
}

export function assignWorkspaceFolder(
  state: PinnedFoldersState,
  workspaceKey: string,
  folderId: string | null,
): PinnedFoldersState {
  const target = folderId && hasFolder(state, folderId) ? folderId : null;
  if ((state.folderIdByWorkspaceKey[workspaceKey] ?? null) === target) return state;
  const folderIdByWorkspaceKey = { ...state.folderIdByWorkspaceKey };
  if (target) folderIdByWorkspaceKey[workspaceKey] = target;
  else delete folderIdByWorkspaceKey[workspaceKey];
  return { ...state, folderIdByWorkspaceKey };
}

/** Drops the filing of workspaces that are no longer pinned. */
export function forgetWorkspaceFolders(
  state: PinnedFoldersState,
  workspaceKeys: readonly string[],
): PinnedFoldersState {
  if (!workspaceKeys.some((key) => key in state.folderIdByWorkspaceKey)) return state;
  const folderIdByWorkspaceKey = { ...state.folderIdByWorkspaceKey };
  for (const key of workspaceKeys) delete folderIdByWorkspaceKey[key];
  return { ...state, folderIdByWorkspaceKey };
}

export function toggleFolderCollapsed(
  state: PinnedFoldersState,
  folderId: string,
): PinnedFoldersState {
  const collapsed = state.collapsedFolderIds.includes(folderId);
  return {
    ...state,
    collapsedFolderIds: collapsed
      ? state.collapsedFolderIds.filter((id) => id !== folderId)
      : [...state.collapsedFolderIds, folderId],
  };
}

export function mergePersistedPinnedFolders<S extends PinnedFoldersState>(
  persisted: unknown,
  current: S,
): S {
  const result = PersistedPinnedFoldersSchema.safeParse(persisted);
  if (!result.success) return current;
  const folders = result.data.folders ?? [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  // A parent that no longer exists, or a parent chain that loops, is repaired to the root rather
  // than hiding the folder.
  const repaired = folders.map((folder) =>
    withParent(folder, folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null),
  );
  const acyclic = repaired.map((folder) =>
    folder.parentId && isFolderWithin(repaired, folder.parentId, folder.id)
      ? withParent(folder, null)
      : folder,
  );
  const folderIdByWorkspaceKey: Record<string, string> = {};
  for (const [workspaceKey, folderId] of Object.entries(result.data.folderIdByWorkspaceKey ?? {})) {
    if (folderIds.has(folderId)) folderIdByWorkspaceKey[workspaceKey] = folderId;
  }
  return {
    ...current,
    folders: acyclic,
    folderIdByWorkspaceKey,
    collapsedFolderIds: (result.data.collapsedFolderIds ?? []).filter((id) => folderIds.has(id)),
  };
}

function withParent(folder: PinnedFolder, parentId: string | null): PinnedFolder {
  return folder.parentId === parentId ? folder : { id: folder.id, name: folder.name, parentId };
}

function hasFolder(state: PinnedFoldersState, folderId: string): boolean {
  return state.folders.some((folder) => folder.id === folderId);
}
