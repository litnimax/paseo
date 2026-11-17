import type { Logger } from "pino";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";

import {
  AgentRunCancellationError,
  type AgentRunCancellationResult,
  type ManagedAgent,
} from "./agent-manager.js";
import type { StoredAgentRecord } from "./agent-storage.js";
import type { AgentProviderNotice } from "./agent-sdk-types.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";

export type LifecycleAgentSnapshot = Pick<ManagedAgent, "id" | "cwd" | "lifecycle" | "internal">;

export interface LifecycleAgentManager {
  getAgent(agentId: string): LifecycleAgentSnapshot | null;
  hasInFlightRun(agentId: string): boolean;
  cancelAgentRun(agentId: string): Promise<AgentRunCancellationResult>;
  clearAgentAttention(agentId: string): Promise<void>;
  archiveAgent(agentId: string): Promise<{ archivedAt: string }>;
  archiveSnapshot(agentId: string, archivedAt: string): Promise<StoredAgentRecord>;
  closeAgent(agentId: string): Promise<void>;
  setLabels(agentId: string, labels: Record<string, string>): Promise<void>;
  detachAgent(agentId: string): Promise<{
    record: StoredAgentRecord;
    live: boolean;
    previousParentAgentId: string | null;
  }>;
  notifyAgentState(agentId: string): void;
  setAgentMode(agentId: string, modeId: string): Promise<AgentProviderNotice | null>;
  updateAgentMetadata(
    agentId: string,
    updates: {
      title?: string;
      labels?: Record<string, string>;
    },
  ): Promise<void>;
}

export interface LifecycleAgentStorage {
  get(agentId: string): Promise<StoredAgentRecord | null>;
  upsert(record: StoredAgentRecord): Promise<void>;
}

export interface AgentLifecycleCommandDependencies {
  agentManager: LifecycleAgentManager;
  agentStorage: LifecycleAgentStorage;
  logger: Logger;
}

export interface CancelAgentRunResult {
  agent: LifecycleAgentSnapshot;
  cancelled: boolean;
}

interface RequestedAgentRunCancellation extends CancelAgentRunResult {
  cancellation: AgentRunCancellationResult;
}

async function requestAgentRunCancellation(
  dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager" | "logger">,
  agentId: string,
): Promise<RequestedAgentRunCancellation> {
  const { agentManager, logger } = dependencies;
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    logger.trace({ agentId }, "cancelAgentRunCommand: agent not found");
    throw new Error(`Agent ${agentId} not found`);
  }

  const hasInFlightRun = agentManager.hasInFlightRun(agentId);
  if (!hasInFlightRun) {
    logger.trace(
      { agentId, lifecycle: agent.lifecycle, hasInFlightRun },
      "cancelAgentRunCommand: skipping because agent is not running",
    );
    return { agent, cancelled: false, cancellation: { status: "not_running" } };
  }

  logger.debug(
    { agentId, lifecycle: agent.lifecycle, hasInFlightRun },
    "cancelAgentRunCommand: interrupting",
  );
  const startedAt = Date.now();
  const cancellation = await agentManager.cancelAgentRun(agentId);
  logger.debug(
    { agentId, cancellation: cancellation.status, durationMs: Date.now() - startedAt },
    "cancelAgentRunCommand: cancelAgentRun completed",
  );

  return {
    agent,
    cancelled: cancellation.status === "settled",
    cancellation,
  };
}

export async function cancelAgentRunCommand(
  dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager" | "logger">,
  agentId: string,
): Promise<CancelAgentRunResult> {
  const result = await requestAgentRunCancellation(dependencies, agentId);
  if (result.cancellation.status === "refused") {
    dependencies.logger.warn(
      { agentId },
      "cancelAgentRunCommand: reported running but no active run was cancelled",
    );
    throw new AgentRunCancellationError(agentId, "stop");
  }

  return { agent: result.agent, cancelled: result.cancelled };
}

export interface ArchiveAgentResult {
  agentId: string;
  archivedAt: string;
  /** Null for an internal agent, which is closed and leaves no record behind. */
  record: StoredAgentRecord | null;
}

export async function archiveAgentCommand(
  dependencies: AgentLifecycleCommandDependencies,
  agentId: string,
): Promise<ArchiveAgentResult> {
  const liveAgent = dependencies.agentManager.getAgent(agentId);
  let record: StoredAgentRecord | null;
  if (liveAgent) {
    await requestAgentRunCancellation(dependencies, agentId);
    await dependencies.agentManager.clearAgentAttention(agentId).catch(() => undefined);
    const archived = await dependencies.agentManager.archiveAgent(agentId);
    if (liveAgent.internal) {
      return { agentId, archivedAt: archived.archivedAt, record: null };
    }
    record = await dependencies.agentStorage.get(agentId);
  } else {
    record = await archiveStoredAgent(dependencies, agentId);
  }

  if (!record) {
    throw new Error(`Agent not found in storage after archive: ${agentId}`);
  }
  if (!record.archivedAt) {
    throw new Error(`Agent missing archivedAt after archive: ${agentId}`);
  }

  return {
    agentId,
    archivedAt: record.archivedAt,
    record,
  };
}

export async function closeAgentCommand(
  dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager">,
  agentId: string,
): Promise<void> {
  await dependencies.agentManager.closeAgent(agentId);
}

export interface UpdateAgentResult {
  accepted: boolean;
  error: string | null;
}

export async function updateAgentCommand(
  dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager">,
  input: {
    agentId: string;
    name?: string;
    labels?: Record<string, string>;
  },
): Promise<UpdateAgentResult> {
  const title = input.name?.trim();
  const labels = input.labels && Object.keys(input.labels).length > 0 ? input.labels : undefined;

  if (!title && !labels) {
    return {
      accepted: false,
      error: "Nothing to update (provide name and/or labels)",
    };
  }

  await dependencies.agentManager.updateAgentMetadata(input.agentId, {
    ...(title ? { title } : {}),
    ...(labels ? { labels } : {}),
  });

  return {
    accepted: true,
    error: null,
  };
}

export interface DetachAgentResult {
  agentId: string;
  record: StoredAgentRecord;
  live: boolean;
  previousParentAgentId: string | null;
  /** The former parent's stored record, when it could be read. */
  previousParent: StoredAgentRecord | null;
  /** The handoff workspace that stopped nesting under the parent's workspace, if any. */
  unnestedWorkspaceId: string | null;
}

export interface DetachAgentStorage {
  get(agentId: string): Promise<StoredAgentRecord | null>;
  listByWorkspaces(workspaceIds: Iterable<string>): Promise<StoredAgentRecord[]>;
}

export interface DetachWorkspaceRegistry {
  get(workspaceId: string): Promise<PersistedWorkspaceRecord | null>;
  update(
    workspaceId: string,
    updater: (record: PersistedWorkspaceRecord) => PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord | null>;
}

export interface DetachAgentDependencies {
  agentManager: Pick<LifecycleAgentManager, "detachAgent">;
  agentStorage: DetachAgentStorage;
  workspaceRegistry: DetachWorkspaceRegistry;
  logger: Logger;
}

export async function detachAgentCommand(
  dependencies: DetachAgentDependencies,
  agentId: string,
): Promise<DetachAgentResult> {
  const result = await dependencies.agentManager.detachAgent(agentId);
  const detached = { agentId, ...result, previousParent: null, unnestedWorkspaceId: null };
  if (!result.previousParentAgentId) return detached;

  // The agent is already detached on disk. Moving its workspace is a follow-up, so a failure here
  // is logged and must not turn the detach into an error for the client.
  try {
    const previousParent = await dependencies.agentStorage.get(result.previousParentAgentId);
    const unnestedWorkspaceId = previousParent
      ? await unnestHandoffWorkspace(dependencies, {
          workspaceId: result.record.workspaceId,
          parentWorkspaceId: previousParent.workspaceId,
        })
      : null;
    return { ...detached, previousParent, unnestedWorkspaceId };
  } catch (error) {
    dependencies.logger.warn(
      { err: error, agentId, workspaceId: result.record.workspaceId },
      "Failed to move a detached handoff workspace out of its parent workspace",
    );
    return detached;
  }
}

/**
 * A handoff workspace nests under the workspace that created it. Once no agent in it is a
 * subagent of an agent in that parent workspace, the link is gone and the workspace moves to the
 * top level of the sidebar. Checking every remaining agent, not only the detached one, keeps the
 * nesting while a sibling handoff agent is still attached.
 *
 * The detached agent's labels are written before this check runs, so when two agents of the same
 * workspace detach at once, the later check sees both detached. The parent link is checked again
 * inside the registry update in case the workspace changed meanwhile.
 */
async function unnestHandoffWorkspace(
  dependencies: Pick<DetachAgentDependencies, "agentStorage" | "workspaceRegistry">,
  input: { workspaceId: string | undefined; parentWorkspaceId: string | undefined },
): Promise<string | null> {
  const { agentStorage, workspaceRegistry } = dependencies;
  const { workspaceId, parentWorkspaceId } = input;
  if (!workspaceId || !parentWorkspaceId || parentWorkspaceId === workspaceId) return null;
  const workspace = await workspaceRegistry.get(workspaceId);
  if (workspace?.parentWorkspaceId !== parentWorkspaceId) return null;
  if (await hasAgentAttachedToWorkspace(agentStorage, { workspaceId, parentWorkspaceId })) {
    return null;
  }
  const updated = await workspaceRegistry.update(workspaceId, (record) => {
    if (record.parentWorkspaceId !== parentWorkspaceId) return record;
    const next = { ...record, updatedAt: new Date().toISOString() };
    delete next.parentWorkspaceId;
    return next;
  });
  return updated && !updated.parentWorkspaceId ? workspaceId : null;
}

/** Whether an active agent in `workspaceId` is still a subagent of an agent in `parentWorkspaceId`. */
async function hasAgentAttachedToWorkspace(
  agentStorage: DetachAgentStorage,
  input: { workspaceId: string; parentWorkspaceId: string },
): Promise<boolean> {
  for (const agent of await agentStorage.listByWorkspaces([input.workspaceId])) {
    const parentAgentId = getParentAgentIdFromLabels(agent.labels);
    if (agent.archivedAt || !parentAgentId) continue;
    const parent = await agentStorage.get(parentAgentId);
    if (parent && !parent.archivedAt && parent.workspaceId === input.parentWorkspaceId) {
      return true;
    }
  }
  return false;
}

export async function setAgentModeCommand(
  dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager">,
  input: {
    agentId: string;
    modeId: string;
  },
): Promise<{ modeId: string; notice: AgentProviderNotice | null }> {
  const notice = await dependencies.agentManager.setAgentMode(input.agentId, input.modeId);
  return { modeId: input.modeId, notice };
}

async function archiveStoredAgent(
  dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager" | "agentStorage">,
  agentId: string,
): Promise<StoredAgentRecord> {
  const existing = await dependencies.agentStorage.get(agentId);
  if (!existing) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  if (existing.archivedAt) {
    return existing;
  }

  const archivedAt = new Date().toISOString();
  return dependencies.agentManager.archiveSnapshot(agentId, archivedAt);
}
