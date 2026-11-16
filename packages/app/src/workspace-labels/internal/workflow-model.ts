import {
  normalizeWorkspaceLabelName,
  workspaceLabelKey,
  type WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";
import { buildWorkspaceLabelPickerRows, type WorkspaceLabelPickerRow } from "./picker-model";
import { i18n } from "@/i18n/i18next";

type Listener = () => void;

class ObservableModel {
  private readonly listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  protected publish(): void {
    for (const listener of this.listeners) listener();
  }
}

export interface WorkspaceLabelPickerModelSnapshot {
  rows: readonly WorkspaceLabelPickerRow[];
  error: string | null;
  online: boolean;
  pendingNames: string[];
}

/**
 * Assigning labels to one workspace: a row per catalog entry, and a toggle per row.
 *
 * Every press toggles and the menu stays open, so the model has no say in the surface's
 * lifetime — it holds no `close`, and picking a label is not an answer to a question. What it
 * does own is the one-in-flight-per-label rule, which is what keeps a double tap from firing two
 * opposite mutations at the same label.
 */
export class WorkspaceLabelPickerModel extends ObservableModel {
  private error: string | null = null;
  private online = false;
  private labels: readonly WorkspaceLabelDefinition[] = [];
  private assigned: readonly string[] = [];
  private readonly pending = new Map<string, Promise<boolean>>();
  private currentSnapshot: WorkspaceLabelPickerModelSnapshot;

  constructor(
    private readonly dependencies: {
      mutate: (input: { label: WorkspaceLabelDefinition; assigned: boolean }) => Promise<unknown>;
    },
  ) {
    super();
    this.currentSnapshot = this.buildSnapshot();
  }

  snapshot = (): WorkspaceLabelPickerModelSnapshot => this.currentSnapshot;

  sync(input: {
    labels: readonly WorkspaceLabelDefinition[];
    assigned: readonly string[];
    online: boolean;
  }): void {
    this.labels = input.labels;
    this.assigned = input.assigned;
    this.online = input.online;
    this.commit();
  }

  toggle(label: WorkspaceLabelDefinition, assigned: boolean): Promise<boolean> {
    const key = workspaceLabelKey(label.name);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    this.error = null;
    const operation = this.dependencies
      .mutate({ label, assigned })
      .then(() => true)
      .catch((cause: unknown) => {
        this.error = workspaceLabelErrorMessage(cause);
        return false;
      })
      .finally(() => {
        this.pending.delete(key);
        this.commit();
      });
    this.pending.set(key, operation);
    this.commit();
    return operation;
  }

  private commit(): void {
    this.currentSnapshot = this.buildSnapshot();
    this.publish();
  }

  private buildSnapshot(): WorkspaceLabelPickerModelSnapshot {
    return {
      rows: buildWorkspaceLabelPickerRows({ labels: this.labels, assigned: this.assigned }),
      error: this.error,
      online: this.online,
      pendingNames: [...this.pending.keys()],
    };
  }
}

export interface WorkspaceLabelManagerHost {
  serverId: string;
  label: string;
  status: "offline" | "online" | "unsupported";
  labels: readonly WorkspaceLabelDefinition[];
  error?: string | null;
}

/** The label being edited, as typed so far. Absent means the list is what's on screen. */
export interface WorkspaceLabelManagerDraft {
  /** The catalog name the edit targets. Fixed for the life of the draft. */
  name: string;
  draftName: string;
  color: WorkspaceLabelDefinition["color"];
}

export interface WorkspaceLabelManagerSnapshot {
  hosts: readonly WorkspaceLabelManagerHost[];
  serverId: string;
  draft: WorkspaceLabelManagerDraft | null;
  query: string;
  error: string | null;
  pending: boolean;
  host: WorkspaceLabelManagerHost | null;
  labels: WorkspaceLabelDefinition[];
  /** The catalog entry behind the open draft, or null when nothing is being edited. */
  editing: WorkspaceLabelDefinition | null;
  /** Whether the draft differs from the label it targets — what Save is worth pressing for. */
  dirty: boolean;
}

/** The fields of a label an edit changes. Absent means unchanged. */
export interface WorkspaceLabelUpdate {
  newName?: string;
  color?: WorkspaceLabelDefinition["color"];
}

/**
 * What a draft of a label amounts to as one update, or null when there is nothing the host could
 * carry out — an empty or whitespace-only name, or a draft equal to the label it targets. Every
 * surface that edits a label asks this one question, so Save means the same thing everywhere.
 */
export function workspaceLabelUpdateFromDraft(
  editing: WorkspaceLabelDefinition,
  draft: WorkspaceLabelDefinition,
): WorkspaceLabelUpdate | null {
  const name = normalizeWorkspaceLabelName(draft.name);
  if (!name) return null;
  const update: WorkspaceLabelUpdate = {};
  if (name !== editing.name) update.newName = name;
  if (draft.color !== editing.color) update.color = draft.color;
  return update.newName === undefined && update.color === undefined ? null : update;
}

export interface WorkspaceLabelDeleteTarget {
  serverId: string;
  name: string;
}

export interface WorkspaceLabelDeleteDependencies {
  inspectDelete: (input: WorkspaceLabelDeleteTarget) => Promise<{
    affectedWorkspaceCount: number;
  }>;
  delete: (input: WorkspaceLabelDeleteTarget) => Promise<unknown>;
}

/**
 * Deleting a label: ask the host how many workspaces carry it, let the user decide with that
 * number in front of them, and only then delete. Resolves whether the label was deleted.
 */
export async function deleteWorkspaceLabelAfterConfirm(input: {
  target: WorkspaceLabelDeleteTarget;
  dependencies: WorkspaceLabelDeleteDependencies;
  confirm: (affectedWorkspaceCount: number) => Promise<boolean>;
}): Promise<boolean> {
  const { target, dependencies, confirm } = input;
  const inspected = await dependencies.inspectDelete(target);
  if (!(await confirm(inspected.affectedWorkspaceCount))) return false;
  await dependencies.delete(target);
  return true;
}

export class WorkspaceLabelManagerModel extends ObservableModel {
  private hosts: readonly WorkspaceLabelManagerHost[] = [];
  private serverId = "";
  private draft: WorkspaceLabelManagerDraft | null = null;
  private query = "";
  private error: string | null = null;
  private operation: Promise<void> | null = null;
  private currentSnapshot: WorkspaceLabelManagerSnapshot;

  constructor(
    private readonly dependencies: WorkspaceLabelDeleteDependencies & {
      update: (
        input: WorkspaceLabelDeleteTarget & WorkspaceLabelUpdate,
      ) => Promise<{ label?: WorkspaceLabelDefinition }>;
    },
  ) {
    super();
    this.currentSnapshot = this.buildSnapshot();
  }

  snapshot = (): WorkspaceLabelManagerSnapshot => this.currentSnapshot;

  syncHosts(hosts: readonly WorkspaceLabelManagerHost[]): void {
    this.hosts = hosts;
    if (!this.operation && !hosts.some((host) => host.serverId === this.serverId)) {
      this.serverId = hosts[0]?.serverId ?? "";
      this.draft = null;
    }
    this.commit();
  }

  selectHost(serverId: string): void {
    if (this.operation || serverId === this.serverId) return;
    this.serverId = serverId;
    this.draft = null;
    this.error = null;
    this.commit();
  }

  /** Open the edit view on a label, seeded with what that label currently is. */
  edit(label: WorkspaceLabelDefinition): void {
    if (this.operation) return;
    this.draft = { name: label.name, draftName: label.name, color: label.color };
    this.error = null;
    this.commit();
  }

  /** Leave the edit view without applying anything. */
  cancelEdit(): void {
    if (this.operation) return;
    this.draft = null;
    this.error = null;
    this.commit();
  }

  /** Back to a freshly opened manager: no draft, no search, no stale error. */
  reset(): void {
    if (this.operation) return;
    this.draft = null;
    this.query = "";
    this.error = null;
    this.commit();
  }

  setDraftName(name: string): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, draftName: name };
    this.commit();
  }

  setDraftColor(color: WorkspaceLabelDefinition["color"]): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, color };
    this.commit();
  }

  setQuery(query: string): void {
    this.query = query;
    this.commit();
  }

  /**
   * Apply the draft as one update, and close the edit view only once it lands.
   *
   * A failure keeps the draft exactly as typed: the host either took both fields or neither, so
   * there is nothing to reconcile and nothing to explain beyond the error.
   */
  save(): Promise<void> {
    const draft = this.draft;
    const editing = this.currentSnapshot.editing;
    if (!draft || !editing) return Promise.resolve();
    const update = workspaceLabelUpdateFromDraft(editing, {
      name: draft.draftName,
      color: draft.color,
    });
    if (!update) return Promise.resolve();
    return this.run(async () => {
      await this.dependencies.update({ serverId: this.serverId, name: editing.name, ...update });
      this.draft = null;
    });
  }

  delete(confirm: (affectedWorkspaceCount: number) => Promise<boolean>): Promise<void> {
    const editing = this.currentSnapshot.editing;
    if (!editing) return Promise.resolve();
    const target = { serverId: this.serverId, name: editing.name };
    return this.run(async () => {
      const deleted = await deleteWorkspaceLabelAfterConfirm({
        target,
        dependencies: this.dependencies,
        confirm,
      });
      if (deleted) this.draft = null;
    });
  }

  private run(action: () => Promise<void>): Promise<void> {
    if (this.operation) return this.operation;
    this.error = null;
    this.operation = action()
      .catch((cause: unknown) => {
        this.error = workspaceLabelErrorMessage(cause);
      })
      .finally(() => {
        this.operation = null;
        this.commit();
      });
    this.commit();
    return this.operation;
  }

  private commit(): void {
    this.currentSnapshot = this.buildSnapshot();
    this.publish();
  }

  private buildSnapshot(): WorkspaceLabelManagerSnapshot {
    const host = this.hosts.find((candidate) => candidate.serverId === this.serverId) ?? null;
    const labels = (host?.labels ?? []).filter((label) =>
      label.name.toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase()),
    );
    const draft = this.draft;
    const editing =
      host?.labels.find(
        (label) =>
          draft !== null && workspaceLabelKey(label.name) === workspaceLabelKey(draft.name),
      ) ?? null;
    const update =
      draft && editing
        ? workspaceLabelUpdateFromDraft(editing, { name: draft.draftName, color: draft.color })
        : null;
    return {
      hosts: this.hosts,
      serverId: this.serverId,
      draft,
      query: this.query,
      error: this.error,
      pending: this.operation !== null,
      host,
      labels: [...labels],
      editing,
      dirty: update !== null,
    };
  }
}

/** A workspace the bulk dialog can put a label on or take it off. */
export interface WorkspaceLabelBulkWorkspace {
  workspaceId: string;
  name: string;
  projectName: string;
  /** Whether the workspace carries the label right now, as the host last said. */
  assigned: boolean;
}

export interface WorkspaceLabelBulkRow extends WorkspaceLabelBulkWorkspace {
  /** What the workspace will carry once the dialog is applied. */
  selected: boolean;
}

export interface WorkspaceLabelBulkAssignSnapshot {
  rows: readonly WorkspaceLabelBulkRow[];
  /** Rows the query hides are still in the draft; this is what is on screen. */
  visibleRows: readonly WorkspaceLabelBulkRow[];
  /** How many workspaces Apply would change. */
  changes: number;
  pending: boolean;
  error: string | null;
}

/**
 * One label across many workspaces: tick the ones that should carry it, then apply once.
 *
 * The draft holds only what differs from the host, so an assignment that lands from elsewhere
 * while the dialog is open shows up instead of being overwritten by a stale tick. Apply sends one
 * assignment per changed workspace; the ones that fail stay in the draft, so pressing Apply again
 * retries exactly those.
 */
export class WorkspaceLabelBulkAssignModel extends ObservableModel {
  private workspaces: readonly WorkspaceLabelBulkWorkspace[] = [];
  private readonly draft = new Map<string, boolean>();
  private query = "";
  private error: string | null = null;
  private operation: Promise<boolean> | null = null;
  private currentSnapshot: WorkspaceLabelBulkAssignSnapshot;

  constructor(
    private readonly dependencies: {
      mutate: (input: { workspaceId: string; assigned: boolean }) => Promise<unknown>;
    },
  ) {
    super();
    this.currentSnapshot = this.buildSnapshot();
  }

  snapshot = (): WorkspaceLabelBulkAssignSnapshot => this.currentSnapshot;

  sync(workspaces: readonly WorkspaceLabelBulkWorkspace[]): void {
    this.workspaces = workspaces;
    const byId = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
    for (const [workspaceId, selected] of this.draft) {
      if (byId.get(workspaceId)?.assigned === selected || !byId.has(workspaceId)) {
        this.draft.delete(workspaceId);
      }
    }
    this.commit();
  }

  setQuery(query: string): void {
    this.query = query;
    this.commit();
  }

  toggle(workspaceId: string): void {
    const row = this.currentSnapshot.rows.find((item) => item.workspaceId === workspaceId);
    if (!row || this.operation) return;
    this.set(row, !row.selected);
    this.commit();
  }

  /** Ticks or clears every row the query shows, and leaves the hidden ones as they were. */
  setVisible(selected: boolean): void {
    if (this.operation) return;
    for (const row of this.currentSnapshot.visibleRows) this.set(row, selected);
    this.commit();
  }

  /** Resolves true when every change landed, which is when the dialog has nothing left to say. */
  apply(): Promise<boolean> {
    if (this.operation) return this.operation;
    const changes = [...this.draft];
    if (changes.length === 0) return Promise.resolve(true);
    this.error = null;
    this.operation = Promise.allSettled(
      changes.map(([workspaceId, assigned]) =>
        this.dependencies.mutate({ workspaceId, assigned }).then(() => workspaceId),
      ),
    )
      .then((results) => {
        let failure: unknown = null;
        for (const result of results) {
          if (result.status === "fulfilled") this.draft.delete(result.value);
          else failure ??= result.reason;
        }
        if (failure !== null) this.error = workspaceLabelErrorMessage(failure);
        return failure === null;
      })
      .finally(() => {
        this.operation = null;
        this.commit();
      });
    this.commit();
    return this.operation;
  }

  private set(row: WorkspaceLabelBulkWorkspace, selected: boolean): void {
    if (row.assigned === selected) this.draft.delete(row.workspaceId);
    else this.draft.set(row.workspaceId, selected);
  }

  private commit(): void {
    this.currentSnapshot = this.buildSnapshot();
    this.publish();
  }

  private buildSnapshot(): WorkspaceLabelBulkAssignSnapshot {
    const rows = this.workspaces.map((workspace) => ({
      ...workspace,
      selected: this.draft.get(workspace.workspaceId) ?? workspace.assigned,
    }));
    const query = this.query.trim().toLocaleLowerCase();
    const visibleRows = query
      ? rows.filter(
          (row) =>
            row.name.toLocaleLowerCase().includes(query) ||
            row.projectName.toLocaleLowerCase().includes(query),
        )
      : rows;
    return {
      rows,
      visibleRows,
      changes: this.draft.size,
      pending: this.operation !== null,
      error: this.error,
    };
  }
}

/**
 * One phrasing for a failed label mutation, wherever the failure surfaces.
 *
 * The client appends the correlation it failed on — `requestType=… code=…` — to every RPC error,
 * which is what a log wants and not what a user reads under a name field. The fields are on the
 * error too, so the suffix is removed by identity rather than by guessing at the format.
 */
export function workspaceLabelErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return i18n.t("workspaceLabels.errors.update");
  const { requestType, code } = cause as { requestType?: string; code?: string };
  const message = cause.message
    .replace(` requestType=${requestType}`, "")
    .replace(` code=${code}`, "")
    .trim();
  return message || i18n.t("workspaceLabels.errors.update");
}
