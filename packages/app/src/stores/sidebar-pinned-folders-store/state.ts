import { z } from "zod";
import {
  EMPTY_PINNED_FOLDERS_DOCUMENT,
  PinnedFoldersDocumentSchema,
  applyPinnedFolderChange,
  isPinnedFolderWithin,
  repairPinnedFoldersDocument,
  type PinnedFolder,
  type PinnedFolderChange,
  type PinnedFoldersDocument,
} from "@getpaseo/protocol/pinned-folders";

export type { PinnedFolder, PinnedFolderChange, PinnedFoldersDocument };
export { isPinnedFolderWithin as isFolderWithin };

/**
 * The Pinned folders as this client sees them. Each host owns its own document (see
 * `@getpaseo/protocol/pinned-folders`); the sidebar shows their union, keyed by folder id, so a
 * folder made on the desktop appears on the phone and lives on every host with pins in it.
 * Which folders are collapsed is a view choice and stays on the device.
 */
export interface PinnedFolderHost {
  status: "online" | "unsupported" | "offline";
  /** The last document the host committed. */
  confirmed: PinnedFoldersDocument;
  /** Sent, not yet answered. Shown over `confirmed` so a drop or a rename lands at once. */
  pending: PendingPinnedFolderChange[];
}

export interface PendingPinnedFolderChange {
  id: number;
  change: PinnedFolderChange;
}

/**
 * The local folders this device kept before hosts stored them, still to be handed over.
 *
 * It is a snapshot from the day of the update, so it is spent as it is used. The tree goes to the
 * first host that takes it and is then dropped: from there on the hosts own the folders, and a
 * host met later must not get back folders that were renamed or deleted since. Each host's
 * filings are dropped once that host has them.
 */
export interface LegacyPinnedFolders {
  /** Empty once a host has taken the tree. */
  folders: PinnedFolder[];
  folderIdByWorkspaceKey: Record<string, string>;
}

export interface PinnedFoldersState {
  hosts: Record<string, PinnedFolderHost>;
  /** The union of every host's folders. */
  folders: PinnedFolder[];
  /** workspaceKey -> folder id, from every host's filings. */
  folderIdByWorkspaceKey: Record<string, string>;
  collapsedFolderIds: string[];
  legacy: LegacyPinnedFolders | null;
  migratedServerIds: string[];
}

// COMPAT(localPinnedFolders): `folders` and `folderIdByWorkspaceKey` are what this device stored
// before hosts kept Pinned folders. Read to hand them over; remove after 2027-05-12.
export const PersistedPinnedFoldersSchema = z.strictObject({
  folders: z
    .array(z.strictObject({ id: z.string(), name: z.string(), parentId: z.string().nullable() }))
    .optional(),
  folderIdByWorkspaceKey: z.record(z.string(), z.string()).optional(),
  collapsedFolderIds: z.array(z.string()).optional(),
  migratedServerIds: z.array(z.string()).optional(),
  /** Each host's last committed document, so the tree is there before the host answers. */
  hostDocuments: z.record(z.string(), PinnedFoldersDocumentSchema).optional(),
});

export type PersistedPinnedFolders = z.infer<typeof PersistedPinnedFoldersSchema>;

export const EMPTY_PINNED_FOLDERS_STATE: PinnedFoldersState = {
  hosts: {},
  folders: [],
  folderIdByWorkspaceKey: {},
  collapsedFolderIds: [],
  legacy: null,
  migratedServerIds: [],
};

/** The host's committed document with its unanswered changes applied, in the order they were sent. */
export function displayDocument(host: PinnedFolderHost): PinnedFoldersDocument {
  let document = host.confirmed;
  for (const { change } of host.pending) {
    try {
      document = applyPinnedFolderChange(document, change);
    } catch {
      // Another client changed the tree under this one; the host will reject it too.
    }
  }
  return document;
}

/**
 * Folders from every host, the first host by id winning where two disagree, and filings keyed by
 * workspace. Hosts are taken in id order so every client resolves a disagreement the same way.
 */
export function mergeHostDocuments(hosts: Record<string, PinnedFolderHost>): {
  folders: PinnedFolder[];
  folderIdByWorkspaceKey: Record<string, string>;
} {
  const folders: PinnedFolder[] = [];
  const seen = new Set<string>();
  const folderIdByWorkspaceKey: Record<string, string> = {};
  for (const serverId of Object.keys(hosts).sort()) {
    const host = hosts[serverId];
    if (!host) continue;
    const document = displayDocument(host);
    for (const folder of document.folders) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      folders.push(folder);
    }
    for (const [workspaceId, folderId] of Object.entries(document.assignments)) {
      folderIdByWorkspaceKey[`${serverId}:${workspaceId}`] = folderId;
    }
  }
  return { folders, folderIdByWorkspaceKey };
}

/** Recomputes the merged view after `hosts` changed, keeping identities when nothing moved. */
export function withHosts<S extends PinnedFoldersState>(
  state: S,
  hosts: Record<string, PinnedFolderHost>,
): S {
  const merged = mergeHostDocuments(hosts);
  return {
    ...state,
    hosts,
    folders: sameFolders(state.folders, merged.folders) ? state.folders : merged.folders,
    folderIdByWorkspaceKey: sameRecord(state.folderIdByWorkspaceKey, merged.folderIdByWorkspaceKey)
      ? state.folderIdByWorkspaceKey
      : merged.folderIdByWorkspaceKey,
  };
}

/**
 * A newer committed document replaces the old one; an older one, arriving late, is dropped. A
 * subscription snapshot is taken whole instead: after a reconnect it is the host's truth.
 */
export function acceptHostDocument(
  host: PinnedFolderHost,
  document: PinnedFoldersDocument,
): PinnedFolderHost {
  return document.revision > host.confirmed.revision ? { ...host, confirmed: document } : host;
}

export function emptyHost(status: PinnedFolderHost["status"]): PinnedFolderHost {
  return { status, confirmed: EMPTY_PINNED_FOLDERS_DOCUMENT, pending: [] };
}

/**
 * The folders from `folders` leading to `folderId`, outermost first, that `document` lacks. A host
 * has to hold a folder's parents before it can hold the folder.
 */
export function missingFolderChain(
  folders: readonly PinnedFolder[],
  document: PinnedFoldersDocument,
  folderId: string | null,
): PinnedFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const present = new Set(document.folders.map((folder) => folder.id));
  const chain: PinnedFolder[] = [];
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (!present.has(current.id)) chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/**
 * The changes that hand this device's old local folders to a host: the folders it lacks, parents
 * first, then the filings of that host's workspaces it has not filed itself.
 *
 * The first host gets the whole old tree. A later host gets only the folders its own filings need,
 * read from `currentFolders` — the tree as the hosts hold it now — and a filing into a folder that
 * has since been deleted is dropped.
 */
// COMPAT(localPinnedFolders): added in v0.16.0, remove after 2027-05-12.
export function legacyHandoverChanges(input: {
  legacy: LegacyPinnedFolders;
  serverId: string;
  document: PinnedFoldersDocument;
  currentFolders: readonly PinnedFolder[];
}): PinnedFolderChange[] {
  const { legacy, serverId, document } = input;
  const prefix = `${serverId}:`;
  const filings = Object.entries(legacy.folderIdByWorkspaceKey).flatMap(
    ([workspaceKey, folderId]) =>
      workspaceKey.startsWith(prefix)
        ? [{ workspaceId: workspaceKey.slice(prefix.length), folderId }]
        : [],
  );
  const ownsTree = legacy.folders.length > 0;
  const source = ownsTree ? legacy.folders : input.currentFolders;
  const wantedFolderIds = ownsTree
    ? legacy.folders.map((folder) => folder.id)
    : filings.map((filing) => filing.folderId);

  const changes: PinnedFolderChange[] = [];
  const planned = new Set(document.folders.map((folder) => folder.id));
  for (const folderId of wantedFolderIds) {
    for (const missing of missingFolderChain(source, document, folderId)) {
      if (planned.has(missing.id)) continue;
      planned.add(missing.id);
      changes.push({ kind: "upsert", folder: missing });
    }
  }
  for (const { workspaceId, folderId } of filings) {
    if (!planned.has(folderId) || Object.hasOwn(document.assignments, workspaceId)) continue;
    changes.push({ kind: "assign", workspaceId, folderId });
  }
  return changes;
}

/** `serverId` has everything this device had for it: spend that part of the legacy snapshot. */
// COMPAT(localPinnedFolders): added in v0.16.0, remove after 2027-05-12.
export function completeLegacyHandover<S extends PinnedFoldersState>(
  state: S,
  serverId: string,
): S {
  if (state.migratedServerIds.includes(serverId)) return state;
  const prefix = `${serverId}:`;
  const remaining = Object.fromEntries(
    Object.entries(state.legacy?.folderIdByWorkspaceKey ?? {}).filter(
      ([workspaceKey]) => !workspaceKey.startsWith(prefix),
    ),
  );
  return {
    ...state,
    migratedServerIds: [...state.migratedServerIds, serverId],
    legacy:
      Object.keys(remaining).length > 0 ? { folders: [], folderIdByWorkspaceKey: remaining } : null,
  };
}

/** A host removed from the app takes its cached folders with it. */
export function forgetHost<S extends PinnedFoldersState>(state: S, serverId: string): S {
  if (!(serverId in state.hosts)) return state;
  const hosts = { ...state.hosts };
  delete hosts[serverId];
  return withHosts(state, hosts);
}

export function toggleFolderCollapsed<S extends PinnedFoldersState>(state: S, folderId: string): S {
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
  const migratedServerIds = result.data.migratedServerIds ?? [];
  // Once a host has the tree only filings are left to hand over. The repair is the one hosts
  // apply to their own file: a missing or looping parent goes to the root, so a host accepts it.
  const legacy = repairPinnedFoldersDocument({
    folders: migratedServerIds.length > 0 ? [] : (result.data.folders ?? []),
    assignments: {},
    revision: 0,
  });
  const legacyFilings = result.data.folderIdByWorkspaceKey ?? {};
  // Until a host answers, its last document stands in for it, shown as an offline host's is.
  const hosts: Record<string, PinnedFolderHost> = { ...current.hosts };
  for (const [serverId, document] of Object.entries(result.data.hostDocuments ?? {})) {
    hosts[serverId] ??= {
      status: "offline",
      confirmed: repairPinnedFoldersDocument(document),
      pending: [],
    };
  }
  return withHosts(
    {
      ...current,
      collapsedFolderIds: result.data.collapsedFolderIds ?? [],
      migratedServerIds,
      legacy:
        legacy.folders.length > 0 || Object.keys(legacyFilings).length > 0
          ? { folders: legacy.folders, folderIdByWorkspaceKey: legacyFilings }
          : null,
    },
    hosts,
  );
}

export function serializePinnedFolders(state: PinnedFoldersState): PersistedPinnedFolders {
  const hostDocuments = Object.fromEntries(
    Object.entries(state.hosts).flatMap(([serverId, host]) =>
      host.status !== "unsupported" && host.confirmed.folders.length > 0
        ? [[serverId, host.confirmed] as const]
        : [],
    ),
  );
  return {
    collapsedFolderIds: state.collapsedFolderIds,
    migratedServerIds: state.migratedServerIds,
    ...(Object.keys(hostDocuments).length > 0 ? { hostDocuments } : {}),
    ...(state.legacy
      ? {
          folders: state.legacy.folders,
          folderIdByWorkspaceKey: state.legacy.folderIdByWorkspaceKey,
        }
      : {}),
  };
}

function sameFolders(left: readonly PinnedFolder[], right: readonly PinnedFolder[]): boolean {
  return (
    left.length === right.length &&
    left.every((folder, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        folder.id === other.id &&
        folder.name === other.name &&
        folder.parentId === other.parentId
      );
    })
  );
}

function sameRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}
