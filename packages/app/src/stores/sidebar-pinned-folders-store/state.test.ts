import { describe, expect, it } from "vitest";
import type { PinnedFoldersDocument } from "@getpaseo/protocol/pinned-folders";
import {
  EMPTY_PINNED_FOLDERS_STATE,
  acceptHostDocument,
  completeLegacyHandover,
  displayDocument,
  forgetHost,
  legacyHandoverChanges,
  mergeHostDocuments,
  mergePersistedPinnedFolders,
  missingFolderChain,
  serializePinnedFolders,
  withHosts,
  type PinnedFolderHost,
} from "./state";

const clients = { id: "clients", name: "Clients", parentId: null };
const acme = { id: "acme", name: "Acme", parentId: "clients" };

function host(document: Partial<PinnedFoldersDocument>, pending: PinnedFolderHost["pending"] = []) {
  return {
    status: "online" as const,
    confirmed: { folders: [], assignments: {}, revision: 1, ...document },
    pending,
  };
}

describe("Pinned folders kept by hosts", () => {
  it("shows the union of every host's folders and files each pin under its own host", () => {
    const merged = mergeHostDocuments({
      "srv-b": host({
        folders: [clients, { ...acme, name: "Stale" }],
        assignments: { w2: "acme" },
      }),
      "srv-a": host({ folders: [clients, acme], assignments: { w1: "clients" } }),
    });

    expect(merged.folders).toEqual([clients, acme]);
    expect(merged.folderIdByWorkspaceKey).toEqual({ "srv-a:w1": "clients", "srv-b:w2": "acme" });
  });

  it("shows a sent change at once, and drops one the tree no longer allows", () => {
    const shown = displayDocument(
      host({ folders: [clients] }, [
        { id: 1, change: { kind: "upsert", folder: acme } },
        { id: 2, change: { kind: "assign", workspaceId: "w1", folderId: "acme" } },
        { id: 3, change: { kind: "assign", workspaceId: "w2", folderId: "gone" } },
      ]),
    );

    expect(shown.folders).toEqual([clients, acme]);
    expect(shown.assignments).toEqual({ w1: "acme" });
  });

  it("keeps the newest committed document when answers arrive out of order", () => {
    const current = host({ folders: [clients, acme], revision: 5 });

    expect(acceptHostDocument(current, { folders: [clients], assignments: {}, revision: 4 })).toBe(
      current,
    );
    expect(
      acceptHostDocument(current, { folders: [clients], assignments: {}, revision: 6 }).confirmed
        .revision,
    ).toBe(6);
  });

  it("keeps the merged arrays when a host update changes nothing on screen", () => {
    const first = withHosts(EMPTY_PINNED_FOLDERS_STATE, { srv: host({ folders: [clients] }) });
    const second = withHosts(first, { srv: host({ folders: [clients], revision: 2 }) });

    expect(second.folders).toBe(first.folders);
    expect(second.folderIdByWorkspaceKey).toBe(first.folderIdByWorkspaceKey);
  });

  it("lists the parents a host needs before it can hold a folder, outermost first", () => {
    const sub = { id: "sub", name: "Sub", parentId: "acme" };
    const document = { folders: [clients], assignments: {}, revision: 1 };

    expect(missingFolderChain([clients, acme, sub], document, "sub")).toEqual([acme, sub]);
    expect(missingFolderChain([clients, acme, sub], document, null)).toEqual([]);
  });

  it("hands this device's old local folders to a host without refiling what it already filed", () => {
    const changes = legacyHandoverChanges({
      legacy: {
        folders: [acme, clients],
        folderIdByWorkspaceKey: { "srv:w1": "acme", "srv:w2": "clients", "other:w3": "acme" },
      },
      serverId: "srv",
      document: { folders: [], assignments: { w2: "elsewhere" }, revision: 3 },
      currentFolders: [],
    });

    expect(changes).toEqual([
      { kind: "upsert", folder: clients },
      { kind: "upsert", folder: acme },
      { kind: "assign", workspaceId: "w1", folderId: "acme" },
    ]);
  });

  it("spends the old local folders as hosts take them, so a later host gets today's tree", () => {
    const legacy = {
      folders: [clients, acme],
      folderIdByWorkspaceKey: { "srv-a:w1": "acme", "srv-b:w2": "clients", "srv-b:w3": "acme" },
    };
    const afterFirst = completeLegacyHandover({ ...EMPTY_PINNED_FOLDERS_STATE, legacy }, "srv-a");

    expect(afterFirst.migratedServerIds).toEqual(["srv-a"]);
    expect(afterFirst.legacy).toEqual({
      folders: [],
      folderIdByWorkspaceKey: { "srv-b:w2": "clients", "srv-b:w3": "acme" },
    });
    // Since the handover "Clients" was renamed and "Acme" deleted on the hosts.
    const customers = { ...clients, name: "Customers" };
    expect(
      legacyHandoverChanges({
        legacy: afterFirst.legacy!,
        serverId: "srv-b",
        document: { folders: [], assignments: {}, revision: 0 },
        currentFolders: [customers],
      }),
    ).toEqual([
      { kind: "upsert", folder: customers },
      { kind: "assign", workspaceId: "w2", folderId: "clients" },
    ]);
    expect(completeLegacyHandover(afterFirst, "srv-b").legacy).toBeNull();
  });

  it("keeps the old local folders on the device until they are handed over, repaired", () => {
    const restored = mergePersistedPinnedFolders(
      {
        folders: [clients, { id: "lost", name: "Lost", parentId: "gone" }],
        folderIdByWorkspaceKey: { "srv:w1": "clients" },
        collapsedFolderIds: ["clients"],
      },
      EMPTY_PINNED_FOLDERS_STATE,
    );

    expect(restored.legacy).toEqual({
      folders: [clients, { id: "lost", name: "Lost", parentId: null }],
      folderIdByWorkspaceKey: { "srv:w1": "clients" },
    });
    expect(restored.folders).toEqual([]);
    expect(serializePinnedFolders(restored)).toEqual({
      folders: [clients, { id: "lost", name: "Lost", parentId: null }],
      folderIdByWorkspaceKey: { "srv:w1": "clients" },
      collapsedFolderIds: ["clients"],
      migratedServerIds: [],
    });
  });

  it("shows each host's last document from storage until the host answers, and drops a removed host", () => {
    const document = { folders: [clients], assignments: { w1: "clients" }, revision: 4 };
    const stored = serializePinnedFolders(
      withHosts(EMPTY_PINNED_FOLDERS_STATE, { "srv-a": host(document) }),
    );

    const restored = mergePersistedPinnedFolders(stored, EMPTY_PINNED_FOLDERS_STATE);

    expect(restored.hosts["srv-a"]).toEqual({
      status: "offline",
      confirmed: document,
      pending: [],
    });
    expect(restored.folders).toEqual([clients]);
    expect(restored.folderIdByWorkspaceKey).toEqual({ "srv-a:w1": "clients" });
    expect(forgetHost(restored, "srv-a").folders).toEqual([]);
  });
});
