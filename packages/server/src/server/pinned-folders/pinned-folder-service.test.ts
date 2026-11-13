import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PinnedFoldersDocument } from "@getpaseo/protocol/pinned-folders";
import { PinnedFolderChangeError } from "@getpaseo/protocol/pinned-folders";
import { PinnedFolderService } from "./pinned-folder-service.js";

describe("pinned folders on the host", () => {
  let paseoHome: string;
  let filePath: string;

  beforeEach(async () => {
    paseoHome = await mkdtemp(join(tmpdir(), "paseo-pinned-folders-"));
    filePath = join(paseoHome, "projects", "pinned-folders.json");
  });

  afterEach(async () => {
    await rm(paseoHome, { recursive: true, force: true });
  });

  async function freshService(): Promise<PinnedFolderService> {
    const service = new PinnedFolderService(filePath);
    await service.initialize();
    return service;
  }

  test("commits changes, advances the revision and survives a restart", async () => {
    const service = await freshService();
    await service.apply({
      kind: "upsert",
      folder: { id: "f1", name: " Clients ", parentId: null },
    });
    await service.apply({ kind: "upsert", folder: { id: "f2", name: "Acme", parentId: "f1" } });
    const committed = await service.apply({ kind: "assign", workspaceId: "wks_a", folderId: "f2" });

    expect(committed).toEqual({
      folders: [
        { id: "f1", name: "Clients", parentId: null },
        { id: "f2", name: "Acme", parentId: "f1" },
      ],
      assignments: { wks_a: "f2" },
      revision: 3,
    });
    expect((await freshService()).snapshot()).toEqual(committed);
  });

  test("tells every subscriber about a change, and nobody about a no-op", async () => {
    const service = await freshService();
    const seen: PinnedFoldersDocument[] = [];
    const unsubscribe = service.subscribe((document) => seen.push(document));
    const upsert = {
      kind: "upsert" as const,
      folder: { id: "f1", name: "Clients", parentId: null },
    };

    await service.apply(upsert);
    await service.apply(upsert);
    unsubscribe();
    await service.apply({ kind: "delete", folderId: "f1" });

    expect(seen.map((document) => document.revision)).toEqual([1]);
  });

  test("rejects a change no client should send and leaves the document alone", async () => {
    const service = await freshService();
    await service.apply({ kind: "upsert", folder: { id: "f1", name: "Clients", parentId: null } });
    await service.apply({ kind: "upsert", folder: { id: "f2", name: "Acme", parentId: "f1" } });

    await expect(
      service.apply({ kind: "upsert", folder: { id: "f1", name: "Clients", parentId: "f2" } }),
    ).rejects.toBeInstanceOf(PinnedFolderChangeError);
    await expect(
      service.apply({ kind: "assign", workspaceId: "wks_a", folderId: "missing" }),
    ).rejects.toMatchObject({ code: "unknown_folder" });
    expect(service.snapshot().revision).toBe(2);
  });

  test("deleting a folder moves its pins and subfolders up, and unpinning forgets the filing", async () => {
    const service = await freshService();
    await service.apply({ kind: "upsert", folder: { id: "f1", name: "Clients", parentId: null } });
    await service.apply({ kind: "upsert", folder: { id: "f2", name: "Acme", parentId: "f1" } });
    await service.apply({ kind: "assign", workspaceId: "wks_a", folderId: "f1" });
    await service.apply({ kind: "assign", workspaceId: "wks_b", folderId: "f2" });

    await service.apply({ kind: "delete", folderId: "f1" });
    await service.forgetWorkspace("wks_b");
    await service.forgetWorkspace("wks_unfiled");

    expect(service.snapshot()).toMatchObject({
      folders: [{ id: "f2", name: "Acme", parentId: null }],
      assignments: {},
      revision: 6,
    });
  });

  test("repairs a stored document whose parents or filings point nowhere", async () => {
    await mkdir(join(paseoHome, "projects"), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        folders: [
          { id: "orphan", name: "Orphan", parentId: "gone" },
          { id: "x", name: "X", parentId: "y" },
          { id: "y", name: "Y", parentId: "x" },
        ],
        assignments: { wks_a: "orphan", wks_b: "gone" },
        revision: 7,
      }),
    );

    const restored = (await freshService()).snapshot();

    expect(restored.folders.map((folder) => folder.parentId)).toEqual([null, null, null]);
    expect(restored.assignments).toEqual({ wks_a: "orphan" });
    expect(restored.revision).toBe(7);
  });

  test("refuses to start over a file it cannot read, rather than overwrite it", async () => {
    await mkdir(join(paseoHome, "projects"), { recursive: true });
    await writeFile(filePath, "{ not json");

    await expect(freshService()).rejects.toThrow();
    expect(await readFile(filePath, "utf8")).toBe("{ not json");
  });

  test("files only pinned workspaces, and drops filings of workspaces that stopped being pinned", async () => {
    const pinned = new Set(["wks_a", "wks_b"]);
    const service = new PinnedFolderService(filePath, {
      isWorkspacePinned: async (workspaceId) => pinned.has(workspaceId),
    });
    await service.initialize();
    await service.apply({ kind: "upsert", folder: { id: "f1", name: "Clients", parentId: null } });
    await service.apply({ kind: "assign", workspaceId: "wks_a", folderId: "f1" });
    await service.apply({ kind: "assign", workspaceId: "wks_b", folderId: "f1" });

    await expect(
      service.apply({ kind: "assign", workspaceId: "wks_unpinned", folderId: "f1" }),
    ).rejects.toMatchObject({ code: "workspace_not_pinned" });
    pinned.delete("wks_b");
    await service.retainWorkspaces((workspaceId) => pinned.has(workspaceId));

    expect(service.snapshot().assignments).toEqual({ wks_a: "f1" });
  });

  test("a subscriber that throws neither fails the change nor starves the next subscriber", async () => {
    const service = await freshService();
    const seen: number[] = [];
    service.subscribe(() => {
      throw new Error("socket is closing");
    });
    service.subscribe((document) => seen.push(document.revision));

    const committed = await service.apply({
      kind: "upsert",
      folder: { id: "f1", name: "Clients", parentId: null },
    });

    expect(committed.revision).toBe(1);
    expect(seen).toEqual([1]);
  });

  test("refuses a workspace id named like an object member instead of committing nothing", async () => {
    const service = await freshService();
    await service.apply({ kind: "upsert", folder: { id: "f1", name: "Clients", parentId: null } });

    await expect(
      service.apply({ kind: "assign", workspaceId: "__proto__", folderId: "f1" }),
    ).rejects.toMatchObject({ code: "workspace_not_pinned" });
    await service.apply({ kind: "assign", workspaceId: "constructor", folderId: null });

    expect(service.snapshot()).toMatchObject({ assignments: {}, revision: 1 });
  });
});
