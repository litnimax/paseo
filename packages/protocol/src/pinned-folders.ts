import { z } from "zod";

/**
 * Folders in the sidebar's Pinned section, as a host stores them.
 *
 * A host keeps one small document: its folder tree and which of its workspaces are filed where.
 * The app holds one per host and merges them by folder id, so a folder made once shows up on
 * every client and lives on every host that has pins in it. Both sides apply changes through
 * `applyPinnedFolderChange`: the daemon to commit them, the app to show them before the host
 * answers.
 */
export const PinnedFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Null for a folder directly under Pinned. */
  parentId: z.string().nullable(),
});

export const PinnedFoldersDocumentSchema = z.object({
  folders: z.array(PinnedFolderSchema),
  /** workspaceId -> folder id. A pin with no entry lives in the Pinned root. */
  assignments: z.record(z.string(), z.string()),
  /** Bumped on every committed change, so a reader can drop a document older than its own. */
  revision: z.number().int().nonnegative(),
});

export const PinnedFolderChangeSchema = z.discriminatedUnion("kind", [
  /** Creates the folder, or renames and moves it. Idempotent, so the app can replay it to every host. */
  z.object({ kind: z.literal("upsert"), folder: PinnedFolderSchema }),
  /** Its subfolders and pins move up to its parent; nothing is unpinned. */
  z.object({ kind: z.literal("delete"), folderId: z.string() }),
  /** Files a pinned workspace; null files it back in the Pinned root. */
  z.object({
    kind: z.literal("assign"),
    workspaceId: z.string(),
    folderId: z.string().nullable(),
  }),
]);

export type PinnedFolder = z.infer<typeof PinnedFolderSchema>;
export type PinnedFoldersDocument = z.infer<typeof PinnedFoldersDocumentSchema>;
export type PinnedFolderChange = z.infer<typeof PinnedFolderChangeSchema>;

export const PINNED_FOLDER_NAME_MAX_LENGTH = 80;

export const EMPTY_PINNED_FOLDERS_DOCUMENT: PinnedFoldersDocument = {
  folders: [],
  assignments: {},
  revision: 0,
};

export type PinnedFolderChangeErrorCode =
  | "invalid_name"
  | "unknown_folder"
  | "folder_cycle"
  /** Only a pinned workspace can be filed, so nothing stays filed after an unpin or a removal. */
  | "workspace_not_pinned";

export class PinnedFolderChangeError extends Error {
  constructor(
    readonly code: PinnedFolderChangeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PinnedFolderChangeError";
  }
}

export function normalizePinnedFolderName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, PINNED_FOLDER_NAME_MAX_LENGTH);
}

/** Whether `folderId` is `ancestorId` or sits anywhere under it. */
export function isPinnedFolderWithin(
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

/**
 * The document after `change`, or the same document when the change alters nothing. Throws
 * `PinnedFolderChangeError` for a change no client should have sent. The revision is left alone:
 * only the host that commits a change advances it.
 */
export function applyPinnedFolderChange(
  document: PinnedFoldersDocument,
  change: PinnedFolderChange,
): PinnedFoldersDocument {
  switch (change.kind) {
    case "upsert":
      return upsertFolder(document, change.folder);
    case "delete":
      return deleteFolder(document, change.folderId);
    case "assign":
      return assignWorkspace(document, change.workspaceId, change.folderId);
  }
}

/** Forgets where an unpinned workspace was filed, so pinning it again starts in the root. */
export function forgetPinnedWorkspace(
  document: PinnedFoldersDocument,
  workspaceId: string,
): PinnedFoldersDocument {
  return assignWorkspace(document, workspaceId, null);
}

/**
 * A parent that no longer exists, or a parent chain that loops, is repaired to the root rather
 * than hiding the folder; a filing into a folder that is gone is dropped. For documents read from
 * storage, which nothing validated on the way in.
 */
export function repairPinnedFoldersDocument(
  document: PinnedFoldersDocument,
): PinnedFoldersDocument {
  const folderIds = new Set(document.folders.map((folder) => folder.id));
  const withKnownParents = document.folders.map((folder) =>
    folder.parentId && !folderIds.has(folder.parentId) ? rootFolder(folder) : folder,
  );
  const folders = withKnownParents.map((folder) =>
    folder.parentId && isPinnedFolderWithin(withKnownParents, folder.parentId, folder.id)
      ? rootFolder(folder)
      : folder,
  );
  return {
    folders,
    assignments: assignmentsFrom(
      Object.entries(document.assignments).filter(([, folderId]) => folderIds.has(folderId)),
    ),
    revision: document.revision,
  };
}

function rootFolder(folder: PinnedFolder): PinnedFolder {
  return { id: folder.id, name: folder.name, parentId: null };
}

// Workspace ids come from clients. Built from entries and read through `Object.hasOwn`, the map
// never mistakes an inherited member such as `constructor` for a filing.
function assignmentsFrom(entries: Iterable<readonly [string, string]>): Record<string, string> {
  return Object.fromEntries(entries);
}

function assignedFolderId(document: PinnedFoldersDocument, workspaceId: string): string | null {
  return Object.hasOwn(document.assignments, workspaceId)
    ? (document.assignments[workspaceId] ?? null)
    : null;
}

function hasFolder(document: PinnedFoldersDocument, folderId: string): boolean {
  return document.folders.some((folder) => folder.id === folderId);
}

function upsertFolder(document: PinnedFoldersDocument, input: PinnedFolder): PinnedFoldersDocument {
  const name = normalizePinnedFolderName(input.name);
  if (!input.id.trim() || !name) {
    throw new PinnedFolderChangeError("invalid_name", "A folder needs an id and a name");
  }
  if (input.parentId !== null) {
    if (!hasFolder(document, input.parentId)) {
      throw new PinnedFolderChangeError(
        "unknown_folder",
        `Unknown parent folder ${input.parentId}`,
      );
    }
    if (isPinnedFolderWithin(document.folders, input.parentId, input.id)) {
      throw new PinnedFolderChangeError("folder_cycle", "A folder cannot move into itself");
    }
  }
  const folder: PinnedFolder = { id: input.id, name, parentId: input.parentId };
  const existing = document.folders.find((candidate) => candidate.id === folder.id);
  if (existing && existing.name === folder.name && existing.parentId === folder.parentId) {
    return document;
  }
  return {
    ...document,
    folders: existing
      ? document.folders.map((candidate) => (candidate.id === folder.id ? folder : candidate))
      : [...document.folders, folder],
  };
}

function deleteFolder(document: PinnedFoldersDocument, folderId: string): PinnedFoldersDocument {
  const deleted = document.folders.find((folder) => folder.id === folderId);
  if (!deleted) return document;
  const folders: PinnedFolder[] = [];
  for (const folder of document.folders) {
    if (folder.id === folderId) continue;
    folders.push(
      folder.parentId === folderId
        ? { id: folder.id, name: folder.name, parentId: deleted.parentId }
        : folder,
    );
  }
  const assignments = assignmentsFrom(
    Object.entries(document.assignments).flatMap(([workspaceId, assigned]) => {
      if (assigned !== folderId) return [[workspaceId, assigned] as const];
      return deleted.parentId ? [[workspaceId, deleted.parentId] as const] : [];
    }),
  );
  return { ...document, folders, assignments };
}

function assignWorkspace(
  document: PinnedFoldersDocument,
  workspaceId: string,
  folderId: string | null,
): PinnedFoldersDocument {
  if (folderId !== null && !hasFolder(document, folderId)) {
    throw new PinnedFolderChangeError("unknown_folder", `Unknown folder ${folderId}`);
  }
  if (assignedFolderId(document, workspaceId) === folderId) return document;
  // No workspace is named `__proto__` or `constructor`, and stored as a key such a name would
  // not survive a reload of the document.
  if (workspaceId in Object.prototype) {
    throw new PinnedFolderChangeError("workspace_not_pinned", `Unknown workspace ${workspaceId}`);
  }
  const others = Object.entries(document.assignments).filter(([key]) => key !== workspaceId);
  return {
    ...document,
    assignments: assignmentsFrom(folderId === null ? others : [...others, [workspaceId, folderId]]),
  };
}
