import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import { TEAM_MEMBER_ID_PATTERN } from "@getpaseo/protocol/messages";
import { writeFileAtomic } from "../atomic-file.js";

/** A whole sidebar of preferences fits in a few kilobytes; anything near this is not one. */
export const OPERATOR_VIEW_MAX_BYTES = 256 * 1024;

const StoredOperatorViewSchema = z.object({
  // Read back from JSON this daemon wrote, so every value is already JSON.
  view: z.record(z.string(), z.unknown() as z.ZodType<JsonValue>),
  revision: z.number().int().positive(),
  savedAt: z.string(),
});

export type OperatorViewProfile = z.infer<typeof StoredOperatorViewSchema>;

export class OperatorViewTooLargeError extends Error {
  readonly code = "operator_view_too_large";

  constructor(readonly bytes: number) {
    super(`A saved view is limited to ${OPERATOR_VIEW_MAX_BYTES} bytes; this one is ${bytes}`);
    this.name = "OperatorViewTooLargeError";
  }
}

/** The view on the host is not the one the saving client last saw. */
export class OperatorViewConflictError extends Error {
  readonly code = "operator_view_conflict";

  constructor(
    readonly baseRevision: number,
    readonly currentRevision: number,
  ) {
    super("The saved view was changed from another device");
    this.name = "OperatorViewConflictError";
  }
}

export interface OperatorViewStoreOptions {
  directory: string;
  now?: () => Date;
  /** Told about a stored view that cannot be read, which is then treated as absent. */
  onUnreadable?: (details: { operatorId: string; filePath: string; error: unknown }) => void;
}

export interface SaveOperatorViewInput {
  operatorId: string;
  view: Record<string, JsonValue>;
  /**
   * The revision the client last applied or saved, 0 for none. When given, the save is refused
   * unless the host still holds that revision. Omitted, the save overwrites whatever is there.
   */
  baseRevision?: number;
}

/**
 * Each team member's saved sidebar view, one file per member under `directory`. The app owns the
 * view's shape; the host keeps it opaque and only counts revisions so a client can tell whether
 * the copy it applied is still the latest.
 *
 * One store serves the whole daemon: every connection of a member writes through the same queue,
 * so two of their clients saving at once still get distinct revisions.
 */
export class OperatorViewStore {
  private readonly directory: string;
  private readonly now: () => Date;
  private readonly onUnreadable: OperatorViewStoreOptions["onUnreadable"];
  // Saves to one file commit in order, so a revision is never handed out twice.
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(options: OperatorViewStoreOptions) {
    this.directory = options.directory;
    this.now = options.now ?? (() => new Date());
    this.onUnreadable = options.onUnreadable;
  }

  /**
   * The member's saved view, or null when there is none. A file that does not parse counts as
   * none: a view is a set of preferences, and the next save replaces it.
   */
  async get(operatorId: string): Promise<OperatorViewProfile | null> {
    const filePath = this.filePath(operatorId);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      return StoredOperatorViewSchema.parse(JSON.parse(raw));
    } catch (error) {
      this.onUnreadable?.({ operatorId, filePath, error });
      return null;
    }
  }

  async save(input: SaveOperatorViewInput): Promise<OperatorViewProfile> {
    const filePath = this.filePath(input.operatorId);
    const previous = this.queues.get(filePath) ?? Promise.resolve();
    const run = previous.then(() => this.commit(input));
    const settled = run.catch(() => undefined);
    this.queues.set(filePath, settled);
    void settled.then(() => {
      if (this.queues.get(filePath) === settled) this.queues.delete(filePath);
      return undefined;
    });
    return run;
  }

  /** Removes the views of everyone who is no longer a team member, so a reused id starts clean. */
  async retainMembers(operatorIds: readonly string[]): Promise<void> {
    const keep = new Set(
      operatorIds.filter(isSafeOperatorId).map((operatorId) => fileNameFor(operatorId)),
    );
    let names: string[];
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json") && !name.startsWith(".") && !keep.has(name))
        .map((name) => fs.rm(join(this.directory, name), { force: true })),
    );
  }

  private async commit(input: SaveOperatorViewInput): Promise<OperatorViewProfile> {
    const current = await this.get(input.operatorId);
    const currentRevision = current?.revision ?? 0;
    if (input.baseRevision !== undefined && input.baseRevision !== currentRevision) {
      throw new OperatorViewConflictError(input.baseRevision, currentRevision);
    }
    const profile: OperatorViewProfile = {
      view: input.view,
      revision: currentRevision + 1,
      savedAt: this.now().toISOString(),
    };
    // Written compact and measured as written, so the limit is the size of the file on disk.
    const serialized = JSON.stringify(profile);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > OPERATOR_VIEW_MAX_BYTES) throw new OperatorViewTooLargeError(bytes);
    await writeFileAtomic(this.filePath(input.operatorId), serialized);
    return profile;
  }

  private filePath(operatorId: string): string {
    if (!isSafeOperatorId(operatorId)) {
      throw new Error(`Invalid team member id: ${operatorId}`);
    }
    return join(this.directory, fileNameFor(operatorId));
  }
}

// The config validates member ids with the same pattern; it is checked again here because the id
// becomes part of a file name.
function isSafeOperatorId(operatorId: string): boolean {
  return TEAM_MEMBER_ID_PATTERN.test(operatorId);
}

/**
 * Member ids differ by case (`Max`, `max`), and macOS and Windows file systems do not tell those
 * apart. The hex of the exact id keeps their files apart, and a name that is never a bare `con` or
 * `nul` stays writable on Windows.
 */
function fileNameFor(operatorId: string): string {
  return `${operatorId}-${Buffer.from(operatorId, "utf8").toString("hex")}.json`;
}
