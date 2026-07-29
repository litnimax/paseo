import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "pino";
import { writeJsonFileAtomic } from "./atomic-file.js";
import { type BoundCreateAgentCommand, formatProviderModel } from "./agent/create-agent/create.js";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import { sendPromptToAgent } from "./agent/agent-prompt.js";
import { getStructuredAgentResponse } from "./agent/agent-response-loop.js";
import type { AgentProvider, AgentTimelineItem } from "./agent/agent-sdk-types.js";
import {
  StandInExchangeSchema,
  StandInLogEntrySchema,
  StandInRecordSchema,
  type StandInListItem,
  type StandInLogEntry,
  type StandInRecord,
  type StandInStatus,
} from "@getpaseo/protocol/standin/rpc-schemas";

const STAND_IN_ID_LENGTH = 8;
const DEFAULT_STAND_IN_PROVIDER: AgentProvider = "claude";
const DEFAULT_MAX_REPLIES = 20;
const DEFAULT_LABEL = "Stand-in";

/**
 * The stand-in only ever answers; it never edits the repo. Every decision it can
 * make is one of these two, so a schema-validated turn is all the service needs.
 */
const StandInDecisionSchema = z.object({
  decision: z.enum(["reply", "done"]),
  message: z.string(),
});

type StandInDecision = z.infer<typeof StandInDecisionSchema>;

const StoredStandInsSchema = z.array(StandInRecordSchema);

export interface StandInStartOptions {
  agentId: string;
  brief: string;
  name?: string;
  provider?: AgentProvider;
  model?: string;
  modeId?: string;
  label?: string;
  labelReplies?: boolean;
  archive?: boolean;
  maxReplies?: number;
  maxTimeMs?: number;
}

export interface StandInLogsResult {
  standIn: StandInRecord;
  entries: StandInLogEntry[];
  nextCursor: number;
}

/**
 * Per-stand-in state that only makes sense while the daemon is up. None of it is
 * persisted: a restart stops the stand-in rather than resuming a half-finished
 * conversation the agent no longer remembers being in.
 */
interface RunningStandInState {
  unsubscribe: () => void;
  deadlineTimer: NodeJS.Timeout | null;
  /** The agent must have been seen running before an idle counts as a finished turn. */
  hasSeenRunning: boolean;
  /** Guards against answering the same agent message twice. */
  lastHandledMessage: string | null;
  /** The brief is only sent once; the stand-in agent keeps its own session. */
  briefSent: boolean;
  /** Serializes decision turns so overlapping agent events cannot interleave. */
  chain: Promise<void>;
  stopping: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function cloneStandIn(record: StandInRecord): StandInRecord {
  return StandInRecordSchema.parse(record);
}

function createStandInId(): string {
  return randomUUID().replace(/-/g, "").slice(0, STAND_IN_ID_LENGTH);
}

function normalizeOptionalText(value: string | undefined, field: string): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} cannot be empty`);
  }
  return trimmed;
}

function ensurePositiveInteger(value: number | undefined, field: string): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function buildStandInAgentTitle(record: StandInRecord): string {
  return `${record.name ?? record.id} [stand-in]`;
}

function resolveLabel(input: StandInStartOptions): string | null {
  if (input.labelReplies === false) {
    return null;
  }
  return normalizeOptionalText(input.label, "label") ?? input.name?.trim() ?? DEFAULT_LABEL;
}

function buildBriefPrompt(record: StandInRecord, agentMessage: string): string {
  return [
    "You are standing in for the human in a conversation with a coding agent.",
    "The agent believes it is talking to a person. Answer as that person.",
    "",
    "<brief>",
    record.brief,
    "</brief>",
    "",
    "Rules:",
    "- Answer as the person described in the brief. Make the calls they would make.",
    "- Be concrete. Pick an option, state a preference, approve or reject.",
    '- Never punt with "do whatever you think is best" unless the brief says to.',
    "- You do not write code, read files, or run commands. You only talk.",
    '- When the brief is satisfied and you have nothing left to ask for, answer with decision "done".',
    '- Otherwise answer with decision "reply" and put what you want to say to the agent in "message".',
    "",
    "The agent just said:",
    "",
    "<agent-message>",
    agentMessage,
    "</agent-message>",
  ].join("\n");
}

function buildFollowUpPrompt(agentMessage: string): string {
  return [
    "Continue standing in for the human, following your brief.",
    "",
    "The agent just said:",
    "",
    "<agent-message>",
    agentMessage,
    "</agent-message>",
  ].join("\n");
}

function resolveFinalText(timeline: AgentTimelineItem[], finalText: string): string {
  if (finalText.trim()) {
    return finalText;
  }
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.type === "assistant_message" && item.text.trim()) {
      return item.text;
    }
  }
  return "";
}

function isUnknownAgentError(error: unknown, agentId: string): boolean {
  return error instanceof Error && error.message === `Unknown agent '${agentId}'`;
}

export class StandInService {
  private readonly storePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private readonly standIns = new Map<string, StandInRecord>();
  private readonly running = new Map<string, RunningStandInState>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      paseoHome: string;
      logger: Logger;
      agentManager: AgentManager;
      agentStorage: AgentStorage;
      createAgent: BoundCreateAgentCommand;
    },
  ) {
    this.storePath = path.join(options.paseoHome, "standins", "standins.json");
    this.logger = options.logger.child({ module: "standin-service" });
  }

  async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.standIns.clear();
    try {
      const raw = await fs.readFile(this.storePath, "utf8");
      const parsed = StoredStandInsSchema.parse(JSON.parse(raw));
      for (const record of parsed) {
        if (record.status !== "running") {
          this.standIns.set(record.id, record);
          continue;
        }
        // A stand-in is a live conversation. There is nothing to resume after a
        // restart, so recover it as stopped instead of silently going quiet.
        const recovered = cloneStandIn(record);
        recovered.status = "stopped";
        recovered.updatedAt = nowIso();
        recovered.completedAt = recovered.updatedAt;
        recovered.stopRequestedAt = recovered.updatedAt;
        this.appendLog(recovered, {
          exchange: null,
          source: "stand-in",
          level: "error",
          text: "Stand-in was interrupted by a daemon restart.",
        });
        this.standIns.set(recovered.id, recovered);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error({ err: error, storePath: this.storePath }, "Failed to load stand-ins");
      }
    }
    this.loaded = true;
    await this.persist();
  }

  async startStandIn(input: StandInStartOptions): Promise<StandInRecord> {
    await this.initialize();
    const brief = input.brief.trim();
    if (!brief) {
      throw new Error("brief cannot be empty");
    }

    const agentRecord = await this.options.agentStorage.get(input.agentId);
    if (!agentRecord) {
      throw new Error(`Agent ${input.agentId} not found`);
    }
    if (agentRecord.archivedAt) {
      throw new Error(`Agent ${input.agentId} is archived`);
    }
    const existing = this.findRunningForAgent(input.agentId);
    if (existing) {
      throw new Error(`Agent ${input.agentId} already has a running stand-in (${existing.id})`);
    }

    const createdAt = nowIso();
    const record = StandInRecordSchema.parse({
      id: createStandInId(),
      name: normalizeOptionalText(input.name, "name"),
      agentId: agentRecord.id,
      brief,
      cwd: agentRecord.cwd,
      provider: input.provider ?? DEFAULT_STAND_IN_PROVIDER,
      model: normalizeOptionalText(input.model, "model"),
      modeId: normalizeOptionalText(input.modeId, "modeId"),
      label: resolveLabel(input),
      archive: input.archive ?? false,
      maxReplies: ensurePositiveInteger(input.maxReplies, "maxReplies") ?? DEFAULT_MAX_REPLIES,
      maxTimeMs: ensurePositiveInteger(input.maxTimeMs, "maxTimeMs"),
      status: "running",
      standInAgentId: null,
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      completedAt: null,
      stopRequestedAt: null,
      exchanges: [],
      logs: [],
      nextLogSeq: 1,
    } satisfies StandInRecord);

    this.standIns.set(record.id, record);
    this.appendLog(record, {
      exchange: null,
      source: "stand-in",
      level: "info",
      text: `Stand-in started for agent ${record.agentId}.`,
    });
    await this.persist();

    try {
      const created = await this.options.createAgent({
        kind: "mcp",
        provider: formatProviderModel(record.provider, record.model),
        cwd: record.cwd,
        workspaceId: agentRecord.workspaceId,
        title: buildStandInAgentTitle(record),
        mode: record.modeId ?? undefined,
        unattended: true,
        promptFailure: "return-error",
        background: true,
        notifyOnFinish: false,
        internal: true,
      });
      record.standInAgentId = created.snapshot.id;
      record.updatedAt = nowIso();
      await this.persist();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish(record, "failed", `Could not create the stand-in agent: ${message}`);
      await this.persist();
      throw error;
    }

    this.watch(record);
    return cloneStandIn(record);
  }

  async listStandIns(): Promise<StandInListItem[]> {
    await this.initialize();
    return Array.from(this.standIns.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((record) => ({
        id: record.id,
        name: record.name,
        agentId: record.agentId,
        status: record.status,
        cwd: record.cwd,
        replyCount: record.replyCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
  }

  async inspectStandIn(idOrPrefix: string): Promise<StandInRecord> {
    await this.initialize();
    return cloneStandIn(this.requireStandIn(idOrPrefix));
  }

  async getStandInLogs(idOrPrefix: string, afterSeq = 0): Promise<StandInLogsResult> {
    await this.initialize();
    const record = this.requireStandIn(idOrPrefix);
    return {
      standIn: cloneStandIn(record),
      entries: record.logs
        .filter((entry) => entry.seq > afterSeq)
        .map((entry) => StandInLogEntrySchema.parse(entry)),
      nextCursor: record.nextLogSeq - 1,
    };
  }

  async stopStandIn(idOrPrefix: string): Promise<StandInRecord> {
    await this.initialize();
    const record = this.requireStandIn(idOrPrefix);
    if (record.status !== "running") {
      return cloneStandIn(record);
    }
    record.stopRequestedAt = record.stopRequestedAt ?? nowIso();
    this.finish(record, "stopped", "Stand-in stopped.");
    await this.teardown(record);
    await this.persist();
    return cloneStandIn(record);
  }

  /** Stop watching every live stand-in. Used on daemon shutdown. */
  dispose(): void {
    for (const [id, state] of this.running) {
      state.stopping = true;
      state.unsubscribe();
      if (state.deadlineTimer) {
        clearTimeout(state.deadlineTimer);
      }
      this.running.delete(id);
    }
  }

  private findRunningForAgent(agentId: string): StandInRecord | null {
    for (const record of this.standIns.values()) {
      if (record.status === "running" && record.agentId === agentId) {
        return record;
      }
    }
    return null;
  }

  private watch(record: StandInRecord): void {
    const state: RunningStandInState = {
      unsubscribe: () => {},
      deadlineTimer: null,
      hasSeenRunning: false,
      lastHandledMessage: null,
      briefSent: false,
      chain: Promise.resolve(),
      stopping: false,
    };
    this.running.set(record.id, state);

    state.unsubscribe = this.options.agentManager.subscribe(
      (event) => {
        if (state.stopping) {
          return;
        }
        if (event.type === "agent_state") {
          this.onAgentState(record.id, event.agent.lifecycle);
          return;
        }
        if (event.type === "agent_stream" && event.event.type === "permission_requested") {
          const toolName = event.event.request.name;
          this.enqueue(record.id, async () => {
            const current = this.standIns.get(record.id);
            if (!current || current.status !== "running") {
              return;
            }
            this.appendLog(current, {
              exchange: null,
              source: "agent",
              level: "info",
              text: `Agent is waiting for a permission decision (${toolName}). A stand-in cannot answer permissions — a human has to.`,
            });
            await this.persist();
          });
        }
      },
      { agentId: record.agentId, replayState: false },
    );

    if (record.maxTimeMs !== null) {
      state.deadlineTimer = setTimeout(() => {
        this.enqueue(record.id, async () => {
          const current = this.standIns.get(record.id);
          if (!current || current.status !== "running") {
            return;
          }
          this.finish(current, "failed", `Reached max time (${current.maxTimeMs}ms).`);
          await this.teardown(current);
          await this.persist();
        });
      }, record.maxTimeMs);
      state.deadlineTimer.unref?.();
    }

    // The common way to start a stand-in is right after reading a question the
    // agent already asked, so pick up the current message instead of waiting for
    // the next turn that may never come.
    const snapshot = this.options.agentManager.getAgent(record.agentId);
    if (snapshot?.lifecycle === "running") {
      state.hasSeenRunning = true;
    } else if (snapshot?.lifecycle === "idle") {
      this.enqueue(record.id, () => this.handleAgentTurn(record.id));
    }
  }

  private onAgentState(standInId: string, lifecycle: string): void {
    const state = this.running.get(standInId);
    if (!state) {
      return;
    }
    if (lifecycle === "running") {
      state.hasSeenRunning = true;
      return;
    }
    if (lifecycle === "idle") {
      if (!state.hasSeenRunning) {
        return;
      }
      state.hasSeenRunning = false;
      this.enqueue(standInId, () => this.handleAgentTurn(standInId));
      return;
    }
    if (lifecycle === "error" || lifecycle === "closed") {
      this.enqueue(standInId, async () => {
        const record = this.standIns.get(standInId);
        if (!record || record.status !== "running") {
          return;
        }
        this.finish(
          record,
          lifecycle === "error" ? "failed" : "stopped",
          lifecycle === "error" ? "Agent entered an error state." : "Agent session closed.",
        );
        await this.teardown(record);
        await this.persist();
      });
    }
  }

  private enqueue(standInId: string, task: () => Promise<void>): void {
    const state = this.running.get(standInId);
    if (!state) {
      return;
    }
    state.chain = state.chain
      .then(() => task())
      .catch((error) => {
        this.logger.error({ err: error, standInId }, "Stand-in turn failed");
      });
  }

  private async handleAgentTurn(standInId: string): Promise<void> {
    const state = this.running.get(standInId);
    const record = this.standIns.get(standInId);
    if (!state || state.stopping || !record || record.status !== "running") {
      return;
    }
    if (this.options.agentManager.hasInFlightRun(record.agentId)) {
      return;
    }

    const agentMessage = (
      await this.options.agentManager.getLastAssistantMessage(record.agentId)
    )?.trim();
    if (!agentMessage || agentMessage === state.lastHandledMessage) {
      return;
    }
    state.lastHandledMessage = agentMessage;

    if (record.maxReplies !== null && record.replyCount >= record.maxReplies) {
      this.finish(record, "failed", `Reached max replies (${record.maxReplies}).`);
      await this.teardown(record);
      await this.persist();
      return;
    }

    const startedAt = nowIso();
    this.appendLog(record, {
      exchange: record.exchanges.length + 1,
      source: "agent",
      level: "info",
      text: agentMessage,
    });
    await this.persist();

    let decision: StandInDecision;
    try {
      decision = await this.askStandIn(record, state, agentMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish(record, "failed", `Stand-in agent failed: ${message}`);
      await this.teardown(record);
      await this.persist();
      return;
    }

    const reply = decision.message.trim();
    const exchange = StandInExchangeSchema.parse({
      index: record.exchanges.length + 1,
      agentMessage,
      decision: decision.decision,
      message: reply,
      startedAt,
      completedAt: nowIso(),
    });
    record.exchanges.push(exchange);
    record.updatedAt = exchange.completedAt;

    if (decision.decision === "done") {
      this.finish(record, "completed", reply || "Stand-in considers the brief satisfied.");
      await this.teardown(record);
      await this.persist();
      return;
    }

    if (!reply) {
      this.finish(record, "failed", "Stand-in returned an empty reply.");
      await this.teardown(record);
      await this.persist();
      return;
    }

    this.appendLog(record, {
      exchange: exchange.index,
      source: "reply",
      level: "info",
      text: reply,
    });
    await this.persist();

    await sendPromptToAgent({
      agentManager: this.options.agentManager,
      agentStorage: this.options.agentStorage,
      agentId: record.agentId,
      prompt: record.label ? `[${record.label}] ${reply}` : reply,
      unarchive: false,
      logger: this.logger,
    });
    record.replyCount += 1;
    record.updatedAt = nowIso();
    await this.persist();
  }

  private async askStandIn(
    record: StandInRecord,
    state: RunningStandInState,
    agentMessage: string,
  ): Promise<StandInDecision> {
    const standInAgentId = record.standInAgentId;
    if (!standInAgentId) {
      throw new Error(`Stand-in ${record.id} has no stand-in agent`);
    }
    const prompt = state.briefSent
      ? buildFollowUpPrompt(agentMessage)
      : buildBriefPrompt(record, agentMessage);
    state.briefSent = true;

    return await getStructuredAgentResponse({
      caller: async (nextPrompt) => {
        const run = await this.options.agentManager.runAgent(standInAgentId, nextPrompt);
        return resolveFinalText(run.timeline, run.finalText);
      },
      prompt,
      schema: StandInDecisionSchema,
      maxRetries: 2,
      schemaName: "StandInDecision",
    });
  }

  private finish(record: StandInRecord, status: StandInStatus, message: string): void {
    record.status = status;
    record.completedAt = nowIso();
    record.updatedAt = record.completedAt;
    this.appendLog(record, {
      exchange: null,
      source: "stand-in",
      level: status === "completed" ? "info" : "error",
      text: message,
    });
  }

  private async teardown(record: StandInRecord): Promise<void> {
    const state = this.running.get(record.id);
    if (state) {
      state.stopping = true;
      state.unsubscribe();
      if (state.deadlineTimer) {
        clearTimeout(state.deadlineTimer);
      }
      this.running.delete(record.id);
    }
    const standInAgentId = record.standInAgentId;
    if (!standInAgentId) {
      return;
    }
    try {
      if (record.archive) {
        await this.options.agentManager.archiveAgent(standInAgentId);
        return;
      }
      await this.options.agentManager.closeAgent(standInAgentId);
      await this.options.agentManager.deleteAgentState(standInAgentId);
    } catch (error) {
      if (!isUnknownAgentError(error, standInAgentId)) {
        this.logger.error(
          { err: error, standInId: record.id, standInAgentId },
          "Failed to clean up the stand-in agent",
        );
      }
    }
  }

  private appendLog(
    record: StandInRecord,
    entry: Omit<StandInLogEntry, "seq" | "timestamp">,
  ): void {
    record.logs.push({
      seq: record.nextLogSeq,
      timestamp: nowIso(),
      ...entry,
    });
    record.nextLogSeq += 1;
  }

  private requireStandIn(idOrPrefix: string): StandInRecord {
    const exact = this.standIns.get(idOrPrefix);
    if (exact) {
      return exact;
    }
    const matches = Array.from(this.standIns.values()).filter((record) =>
      record.id.startsWith(idOrPrefix),
    );
    if (matches.length === 0) {
      throw new Error(`Stand-in ${idOrPrefix} not found`);
    }
    if (matches.length > 1) {
      throw new Error(`Stand-in id ${idOrPrefix} is ambiguous`);
    }
    return matches[0];
  }

  private async persist(): Promise<void> {
    const nextPersist = this.persistQueue.then(async () => {
      const records = Array.from(this.standIns.values());
      await fs.mkdir(path.dirname(this.storePath), { recursive: true });
      await writeJsonFileAtomic(this.storePath, records);
      return;
    });
    this.persistQueue = nextPersist.catch((error) => {
      this.logger.error({ err: error, storePath: this.storePath }, "Failed to persist stand-ins");
    });
    await nextPersist;
  }
}
