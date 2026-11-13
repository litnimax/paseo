import { promises as fs } from "node:fs";
import {
  EMPTY_PINNED_FOLDERS_DOCUMENT,
  PinnedFolderChangeError,
  PinnedFoldersDocumentSchema,
  applyPinnedFolderChange,
  forgetPinnedWorkspace,
  repairPinnedFoldersDocument,
  type PinnedFolderChange,
  type PinnedFoldersDocument,
} from "@getpaseo/protocol/pinned-folders";
import { writeJsonFileAtomic } from "../atomic-file.js";

type PinnedFoldersListener = (document: PinnedFoldersDocument) => void;
type DocumentChange = (
  document: PinnedFoldersDocument,
) => PinnedFoldersDocument | Promise<PinnedFoldersDocument>;

export interface PinnedFolderServiceOptions {
  /**
   * Whether the workspace exists and is pinned. Asked inside the commit queue, so a filing and the
   * unpin that clears it cannot pass each other. Without it every workspace id is accepted.
   */
  isWorkspacePinned?: (workspaceId: string) => Promise<boolean>;
  writeDocument?: (filePath: string, document: PinnedFoldersDocument) => Promise<void>;
}

/**
 * The host's copy of the Pinned folder tree and where its pins are filed. One small JSON
 * document, written whole and atomically, so there is no cross-file transaction to recover: a
 * crash leaves either the old document or the new one.
 */
export class PinnedFolderService {
  private document: PinnedFoldersDocument = EMPTY_PINNED_FOLDERS_DOCUMENT;
  private loaded = false;
  // Changes commit one at a time, so each one applies to the document the last one wrote.
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<PinnedFoldersListener>();

  private readonly isWorkspacePinned: PinnedFolderServiceOptions["isWorkspacePinned"];
  private readonly writeDocument: NonNullable<PinnedFolderServiceOptions["writeDocument"]>;

  constructor(
    private readonly filePath: string,
    options: PinnedFolderServiceOptions = {},
  ) {
    this.isWorkspacePinned = options.isWorkspacePinned;
    this.writeDocument = options.writeDocument ?? writeJsonFileAtomic;
  }

  async initialize(): Promise<void> {
    if (this.loaded) return;
    this.document = await readDocument(this.filePath);
    this.loaded = true;
  }

  snapshot(): PinnedFoldersDocument {
    this.assertLoaded();
    return this.document;
  }

  subscribe(listener: PinnedFoldersListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Commits one change and resolves with the document as written. Rejects without writing. */
  apply(change: PinnedFolderChange): Promise<PinnedFoldersDocument> {
    return this.commit(async (document) => {
      if (
        change.kind === "assign" &&
        change.folderId !== null &&
        this.isWorkspacePinned &&
        !(await this.isWorkspacePinned(change.workspaceId))
      ) {
        throw new PinnedFolderChangeError(
          "workspace_not_pinned",
          `Workspace ${change.workspaceId} is not pinned`,
        );
      }
      return applyPinnedFolderChange(document, change);
    });
  }

  /**
   * An unpinned or removed workspace leaves its folder, so pinning it again starts in the root.
   * Driven by the workspace registry's mutations, whichever client, CLI or agent made them.
   */
  forgetWorkspace(workspaceId: string): Promise<PinnedFoldersDocument> {
    return this.commit((document) => forgetPinnedWorkspace(document, workspaceId));
  }

  /** Drops the filing of every workspace `isPinned` rejects. Run once at startup. */
  retainWorkspaces(isPinned: (workspaceId: string) => boolean): Promise<PinnedFoldersDocument> {
    return this.commit((document) =>
      Object.keys(document.assignments)
        .filter((workspaceId) => !isPinned(workspaceId))
        .reduce(forgetPinnedWorkspace, document),
    );
  }

  private commit(change: DocumentChange): Promise<PinnedFoldersDocument> {
    const run = this.queue.then(() => this.commitNow(change));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async commitNow(change: DocumentChange): Promise<PinnedFoldersDocument> {
    this.assertLoaded();
    const changed = await change(this.document);
    if (changed === this.document) return this.document;
    const next = { ...changed, revision: this.document.revision + 1 };
    await this.writeDocument(this.filePath, next);
    this.document = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // Publication follows the durable write: one subscriber failing cannot fail the change
        // or keep the document from the subscribers after it.
      }
    }
    return next;
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new Error("Pinned folders are not loaded yet");
  }
}

async function readDocument(filePath: string): Promise<PinnedFoldersDocument> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_PINNED_FOLDERS_DOCUMENT;
    throw error;
  }
  // A file that does not parse is left for a human to look at, never replaced with an empty tree.
  return repairPinnedFoldersDocument(PinnedFoldersDocumentSchema.parse(JSON.parse(raw)));
}
