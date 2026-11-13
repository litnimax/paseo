import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import type { PinnedFoldersDocument } from "@getpaseo/protocol/pinned-folders";
import { DaemonClient } from "../test-utils/index.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

// Two clients of one host stand in for the desktop app and the phone: what one files, the other
// sees live, and an unpin from anywhere takes the pin out of its folder.
test("Pinned folders made on one client reach every other client of the host", async () => {
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  const cwd = mkdtempSync(path.join(tmpdir(), "paseo-pinned-folders-cwd-"));
  const url = `ws://127.0.0.1:${daemon.port}/ws`;
  const desktop = new DaemonClient({ url, appVersion: "0.16.0" });
  const phone = new DaemonClient({ url, appVersion: "0.16.0" });
  try {
    await desktop.connect();
    await phone.connect();
    expect(phone.getLastServerInfoMessage()?.features?.workspacePinnedFolders).toBe(true);
    const created = await desktop.createWorkspace({ source: { kind: "directory", path: cwd } });
    if (!created.workspace) throw new Error(created.error ?? "Workspace creation failed");
    const workspaceId = created.workspace.id;

    const seen: PinnedFoldersDocument[] = [];
    const subscription = phone.observePinnedFolders();
    subscription.subscribe({
      snapshot: (snapshot) => seen.push(snapshot.document),
      update: (message) => {
        if (message.type === "workspace.pinned_folder.update") seen.push(message.payload.document);
      },
    });
    const initial = await subscription.ready;
    expect(initial.document).toEqual({ folders: [], assignments: {}, revision: 0 });

    await desktop.changePinnedFolder({
      change: { kind: "upsert", folder: { id: "pf_clients", name: "Clients", parentId: null } },
    });
    await desktop.setWorkspacePinned(workspaceId, true);
    const filed = await desktop.changePinnedFolder({
      change: { kind: "assign", workspaceId, folderId: "pf_clients" },
    });
    expect(filed.document.assignments).toEqual({ [workspaceId]: "pf_clients" });
    await expect
      .poll(() => seen.at(-1))
      .toEqual({
        folders: [{ id: "pf_clients", name: "Clients", parentId: null }],
        assignments: { [workspaceId]: "pf_clients" },
        revision: 2,
      });

    await phone.setWorkspacePinned(workspaceId, false);
    await expect.poll(() => seen.at(-1)?.assignments).toEqual({});

    // A filing that arrives after the unpin, as a quick pin-then-unpin sends it, is refused.
    await expect(
      desktop.changePinnedFolder({
        change: { kind: "assign", workspaceId, folderId: "pf_clients" },
      }),
    ).rejects.toThrow(/not pinned/);

    await desktop.setWorkspacePinned(workspaceId, true);
    await expect(
      desktop.changePinnedFolder({ change: { kind: "assign", workspaceId, folderId: "missing" } }),
    ).rejects.toThrow(/Unknown folder/);
    await subscription.release();
  } finally {
    await desktop.close();
    await phone.close();
    await daemon.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});
