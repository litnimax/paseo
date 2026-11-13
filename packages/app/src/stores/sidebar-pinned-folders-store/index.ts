import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  isPinnedFolderWithin,
  normalizePinnedFolderName,
  type PinnedFoldersDocument,
} from "@getpaseo/protocol/pinned-folders";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  EMPTY_PINNED_FOLDERS_STATE,
  PersistedPinnedFoldersSchema,
  acceptHostDocument,
  completeLegacyHandover,
  displayDocument,
  emptyHost,
  forgetHost,
  legacyHandoverChanges,
  mergePersistedPinnedFolders,
  missingFolderChain,
  serializePinnedFolders,
  toggleFolderCollapsed,
  withHosts,
  type PersistedPinnedFolders,
  type PinnedFolder,
  type PinnedFolderChange,
  type PinnedFolderHost,
  type PinnedFoldersState,
} from "./state";

export type { PinnedFolder, PinnedFoldersState } from "./state";
export { isFolderWithin } from "./state";

interface SidebarPinnedFoldersStore extends PinnedFoldersState {
  /** Returns the new folder's id. The folder is made on every connected host that keeps folders. */
  createFolder: (input: { name: string; parentId: string | null }) => string;
  renameFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => void;
  moveFolder: (folderId: string, parentId: string | null) => void;
  /** Null files the pin back in the Pinned root. A host that keeps no folders ignores it. */
  assignWorkspaceFolder: (workspaceKey: string, folderId: string | null) => void;
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
    (set, get) => ({
      ...EMPTY_PINNED_FOLDERS_STATE,
      createFolder: ({ name, parentId }) => {
        const id = generateFolderId();
        const folder: PinnedFolder = { id, name: normalizePinnedFolderName(name), parentId };
        if (!folder.name) return id;
        for (const serverId of onlineServerIds()) {
          ensureFolderChain(serverId, parentId);
          send(serverId, { kind: "upsert", folder });
        }
        return id;
      },
      renameFolder: (folderId, name) => {
        const folder = get().folders.find((candidate) => candidate.id === folderId);
        const trimmed = normalizePinnedFolderName(name);
        if (folder && trimmed) upsertEverywhere({ ...folder, name: trimmed });
      },
      moveFolder: (folderId, parentId) => {
        const { folders } = get();
        const folder = folders.find((candidate) => candidate.id === folderId);
        if (!folder || folder.parentId === parentId) return;
        if (parentId && isPinnedFolderWithin(folders, parentId, folderId)) return;
        upsertEverywhere({ ...folder, parentId });
      },
      deleteFolder: (folderId) => {
        for (const serverId of hostsWithFolder(folderId)) {
          send(serverId, { kind: "delete", folderId });
        }
      },
      assignWorkspaceFolder: (workspaceKey, folderId) => {
        const serverId = onlineServerIds()
          .filter((candidate) => workspaceKey.startsWith(`${candidate}:`))
          .sort((left, right) => right.length - left.length)[0];
        if (!serverId) return;
        ensureFolderChain(serverId, folderId);
        send(serverId, {
          kind: "assign",
          workspaceId: workspaceKey.slice(serverId.length + 1),
          folderId,
        });
      },
      toggleFolderCollapsed: (folderId) => set((state) => toggleFolderCollapsed(state, folderId)),
    }),
    {
      name: "sidebar-pinned-folders",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedPinnedFoldersSchema),
      partialize: (state) => serializePinnedFolders(state),
      merge: (persisted, current) => mergePersistedPinnedFolders(persisted, current),
    },
  ),
);

interface HostLink {
  client: DaemonClient;
  release: () => void;
  // Changes reach a host one at a time, so a folder's parent always commits before the folder.
  queue: Promise<void>;
}

const links = new Map<string, HostLink>();
let nextPendingId = 1;

function setHost(serverId: string, host: PinnedFolderHost): void {
  useSidebarPinnedFoldersStore.setState((state) =>
    withHosts(state, { ...state.hosts, [serverId]: host }),
  );
}

function updateHost(serverId: string, update: (host: PinnedFolderHost) => PinnedFolderHost): void {
  useSidebarPinnedFoldersStore.setState((state) => {
    const host = state.hosts[serverId];
    if (!host) return state;
    const next = update(host);
    return next === host ? state : withHosts(state, { ...state.hosts, [serverId]: next });
  });
}

/** How a sent change ended: the host committed it, the host refused it, or it never got an answer. */
type ChangeOutcome = "committed" | "refused" | "unanswered";

/** Shows `change` at once, sends it, then takes the host's answer or drops the change. */
function send(serverId: string, change: PinnedFolderChange): Promise<ChangeOutcome> {
  const link = links.get(serverId);
  if (!link || useSidebarPinnedFoldersStore.getState().hosts[serverId]?.status !== "online") {
    return Promise.resolve("unanswered");
  }
  const id = nextPendingId++;
  updateHost(serverId, (host) => ({ ...host, pending: [...host.pending, { id, change }] }));
  const settle = (document?: PinnedFoldersDocument) =>
    updateHost(serverId, (host) => {
      const settled = { ...host, pending: host.pending.filter((entry) => entry.id !== id) };
      return document ? acceptHostDocument(settled, document) : settled;
    });
  const deliver = async (): Promise<ChangeOutcome> => {
    try {
      const { document } = await link.client.changePinnedFolder({ change });
      settle(document);
      return "committed";
    } catch (error) {
      console.warn("[pinned-folders] change rejected", { serverId, change, error });
      settle();
      // The host's own refusal carries its error code; anything else is a lost connection.
      return typeof (error as { code?: unknown } | null)?.code === "string"
        ? "refused"
        : "unanswered";
    }
  };
  const outcome = link.queue.then(deliver);
  link.queue = outcome.then(() => undefined);
  return outcome;
}

function onlineServerIds(): string[] {
  return Object.entries(useSidebarPinnedFoldersStore.getState().hosts).flatMap(([serverId, host]) =>
    host.status === "online" ? [serverId] : [],
  );
}

function hostsWithFolder(folderId: string): string[] {
  const { hosts } = useSidebarPinnedFoldersStore.getState();
  return onlineServerIds().filter((serverId) => {
    const host = hosts[serverId];
    return host ? displayDocument(host).folders.some((folder) => folder.id === folderId) : false;
  });
}

/** Gives `serverId` the parents of `folderId` it lacks, outermost first, and `folderId` itself. */
function ensureFolderChain(serverId: string, folderId: string | null): void {
  const { hosts, folders } = useSidebarPinnedFoldersStore.getState();
  const host = hosts[serverId];
  if (!host) return;
  for (const folder of missingFolderChain(folders, displayDocument(host), folderId)) {
    send(serverId, { kind: "upsert", folder });
  }
}

function upsertEverywhere(folder: PinnedFolder): void {
  for (const serverId of hostsWithFolder(folder.id)) {
    ensureFolderChain(serverId, folder.parentId);
    send(serverId, { kind: "upsert", folder });
  }
}

/**
 * Keeps one live subscription per connected host. Directory sync calls this whenever a host's
 * connection changes, at the same moment it reattaches workspace labels.
 */
export const pinnedFolderSync = {
  connect(input: { serverId: string; client: DaemonClient; supported: boolean }): void {
    const { serverId, client, supported } = input;
    if (supported && links.get(serverId)?.client === client) return;
    pinnedFolderSync.disconnect(serverId);
    if (!supported) {
      setHost(serverId, emptyHost("unsupported"));
      return;
    }
    const subscription = client.observePinnedFolders();
    links.set(serverId, {
      client,
      release: () => {
        void subscription.release().catch(() => undefined);
      },
      queue: Promise.resolve(),
    });
    subscription.subscribe({
      snapshot: ({ document }) => {
        setHost(serverId, { status: "online", confirmed: document, pending: [] });
        void handOverLegacyFolders(serverId);
      },
      update: (message) => {
        if (message.type !== "workspace.pinned_folder.update") return;
        updateHost(serverId, (host) => acceptHostDocument(host, message.payload.document));
      },
      error: (error) => {
        console.warn("[pinned-folders] subscription failed", { serverId, error });
      },
    });
  },

  /** The host's last document stays on screen, so its pins keep their folders while it is away. */
  disconnect(serverId: string): void {
    links.get(serverId)?.release();
    links.delete(serverId);
    updateHost(serverId, (host) =>
      host.status === "offline" ? host : { ...host, status: "offline", pending: [] },
    );
  },

  /** The host was removed from the app: its folders stop counting toward the tree. */
  forget(serverId: string): void {
    pinnedFolderSync.disconnect(serverId);
    useSidebarPinnedFoldersStore.setState((state) => forgetHost(state, serverId));
  },
};

const handoversInFlight = new Set<string>();

/**
 * Hands this device's old local folders to `serverId`. The host counts as migrated only once it
 * has answered every change, so a connection lost halfway is picked up again on the next
 * snapshot instead of leaving the rest of the folders behind.
 */
// COMPAT(localPinnedFolders): added in v0.16.0, remove after 2027-05-12.
async function handOverLegacyFolders(serverId: string): Promise<void> {
  const state = useSidebarPinnedFoldersStore.getState();
  const host = state.hosts[serverId];
  const link = links.get(serverId);
  if (!state.legacy || !host || !link || state.migratedServerIds.includes(serverId)) return;
  if (handoversInFlight.has(serverId)) return;
  handoversInFlight.add(serverId);
  let outcomes: ChangeOutcome[];
  try {
    outcomes = await Promise.all(
      legacyHandoverChanges({
        legacy: state.legacy,
        serverId,
        document: displayDocument(host),
        currentFolders: state.folders,
      }).map((change) => send(serverId, change)),
    );
  } finally {
    handoversInFlight.delete(serverId);
  }
  if (!outcomes.includes("unanswered")) {
    useSidebarPinnedFoldersStore.setState((current) => completeLegacyHandover(current, serverId));
    return;
  }
  // The host came back on a new connection while this one was failing: its snapshot was skipped
  // above, so start over against the document it holds now.
  const reconnected = links.get(serverId);
  if (reconnected && reconnected !== link) await handOverLegacyFolders(serverId);
}
