import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentProvider,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  AgentStreamEvent,
} from "./agent/agent-sdk-types.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { AgentManager } from "./agent/agent-manager.js";
import { createAgentCommand } from "./agent/create-agent/create.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { StandInService } from "./standin-service.js";
import { createTestLogger } from "../test-utils/test-logger.js";

const TEST_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

const PASS_THROUGH_CREATE_POLICY: Pick<ProviderSnapshotManager, "resolveCreateConfig"> = {
  async resolveCreateConfig(input) {
    return { modeId: input.requestedMode, featureValues: input.featureValues };
  },
};

interface ScriptedAgentBehavior {
  onRun(input: { config: AgentSessionConfig; prompt: string; turnId: string }): Promise<string>;
}

class ScriptedAgentClient implements AgentClient {
  readonly provider: AgentProvider;
  readonly capabilities = TEST_CAPABILITIES;

  constructor(
    provider: AgentProvider,
    private readonly behavior: ScriptedAgentBehavior,
  ) {
    this.provider = provider;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return new ScriptedAgentSession(config, this.provider, this.behavior);
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    return new ScriptedAgentSession(
      { provider: this.provider, cwd: overrides?.cwd ?? process.cwd(), ...overrides },
      this.provider,
      this.behavior,
    );
  }

  async fetchCatalog(): Promise<{ models: AgentModelDefinition[]; modes: AgentMode[] }> {
    return { models: [], modes: [] };
  }
}

class ScriptedAgentSession implements AgentSession {
  readonly capabilities = TEST_CAPABILITIES;
  readonly id = randomUUID();
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turnCount = 0;

  constructor(
    private readonly config: AgentSessionConfig,
    readonly provider: AgentProvider,
    private readonly behavior: ScriptedAgentBehavior,
  ) {}

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
    const turnId = `turn-${++this.turnCount}`;
    queueMicrotask(() => {
      void this.runScript(promptText, turnId);
    });
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: this.config.modeId ?? null,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [];
  }

  async getCurrentMode(): Promise<string | null> {
    return this.config.modeId ?? null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}

  async listCommands(): Promise<AgentSlashCommand[]> {
    return [];
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private async runScript(prompt: string, turnId: string): Promise<void> {
    this.emit({ type: "turn_started", provider: this.provider, turnId });
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId,
      item: { type: "user_message", text: prompt },
    });
    try {
      const responseText = await this.behavior.onRun({ config: this.config, prompt, turnId });
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: { type: "assistant_message", text: responseText },
      });
      this.emit({ type: "turn_completed", provider: this.provider, turnId });
    } catch (error) {
      this.emit({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

describe("StandInService", () => {
  const logger = createTestLogger();
  let tmpDir: string;
  let paseoHome: string;
  let workspaceDir: string;
  let storage: AgentStorage;

  beforeEach(() => {
    tmpDir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "standin-service-")));
    paseoHome = path.join(tmpDir, "paseo-home");
    workspaceDir = path.join(tmpDir, "workspace");
    storage = new AgentStorage(path.join(tmpDir, "agents"), logger);
    mkdirSync(workspaceDir, { recursive: true });
    workspaceDir = realpathSync.native(workspaceDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createService(manager: AgentManager): StandInService {
    return new StandInService({
      paseoHome,
      logger,
      agentManager: manager,
      agentStorage: storage,
      createAgent: (input) =>
        createAgentCommand(
          {
            agentManager: manager,
            agentStorage: storage,
            logger,
            providerSnapshotManager:
              PASS_THROUGH_CREATE_POLICY as unknown as ProviderSnapshotManager,
            ensureWorkspaceForCreate: async () => "workspace-for-standin",
          },
          input,
        ),
    });
  }

  test("answers the agent's question in the same conversation, then finishes", async () => {
    const executorPrompts: string[] = [];
    const standInPrompts: string[] = [];
    const manager = new AgentManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun({ config, prompt }) {
            if (config.title?.includes("stand-in")) {
              standInPrompts.push(prompt);
              if (standInPrompts.length === 1) {
                return '{"decision":"reply","message":"Use Postgres. Keep it simple."}';
              }
              return '{"decision":"done","message":"That covers it, thanks."}';
            }
            executorPrompts.push(prompt);
            if (executorPrompts.length === 1) {
              return "Which database should I use?";
            }
            return "Done — Postgres it is.";
          },
        }),
      },
      registry: storage,
      logger,
    });

    const executor = await manager.createAgent(
      { provider: "claude", cwd: workspaceDir },
      undefined,
      {
        workspaceId: "workspace-for-standin",
      },
    );
    const service = createService(manager);
    await service.initialize();

    await manager.runAgent(executor.id, "Set up the storage layer.");

    const standIn = await service.startStandIn({
      agentId: executor.id,
      brief: "You are the product owner. You want the storage layer done today.",
    });

    await waitForStandInToStop(service, standIn.id);

    const finished = await service.inspectStandIn(standIn.id);
    expect(finished.status).toBe("completed");
    expect(finished.replyCount).toBe(1);
    expect(finished.exchanges.map((exchange) => exchange.decision)).toEqual(["reply", "done"]);
    expect(finished.exchanges[0]?.agentMessage).toBe("Which database should I use?");

    // The reply lands in the executor's own conversation, labelled so a human
    // reading the chat can tell it did not come from them.
    expect(executorPrompts[1]).toBe("[Stand-in] Use Postgres. Keep it simple.");
    // The brief is sent once; the stand-in agent keeps its own session after that.
    expect(standInPrompts[0]).toContain("You are the product owner");
    expect(standInPrompts[1]).not.toContain("You are the product owner");
  });

  test("gives up after maxReplies instead of talking forever", async () => {
    const manager = new AgentManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun({ config }) {
            if (config.title?.includes("stand-in")) {
              return '{"decision":"reply","message":"Keep going."}';
            }
            return `Anything else? ${randomUUID()}`;
          },
        }),
      },
      registry: storage,
      logger,
    });

    const executor = await manager.createAgent(
      { provider: "claude", cwd: workspaceDir },
      undefined,
      {
        workspaceId: "workspace-for-standin",
      },
    );
    const service = createService(manager);
    await service.initialize();
    await manager.runAgent(executor.id, "Start working.");

    const standIn = await service.startStandIn({
      agentId: executor.id,
      brief: "You never run out of follow-up questions.",
      maxReplies: 2,
    });

    await waitForStandInToStop(service, standIn.id);

    const finished = await service.inspectStandIn(standIn.id);
    expect(finished.status).toBe("failed");
    expect(finished.replyCount).toBe(2);
    expect(finished.logs.at(-1)?.text).toContain("Reached max replies (2)");
  });

  test("refuses a second stand-in on the same agent", async () => {
    const manager = new AgentManager({
      clients: {
        claude: new ScriptedAgentClient("claude", {
          async onRun() {
            return '{"decision":"reply","message":"…"}';
          },
        }),
      },
      registry: storage,
      logger,
    });

    const executor = await manager.createAgent(
      { provider: "claude", cwd: workspaceDir },
      undefined,
      {
        workspaceId: "workspace-for-standin",
      },
    );
    const service = createService(manager);
    await service.initialize();

    const first = await service.startStandIn({
      agentId: executor.id,
      brief: "First stand-in.",
    });

    await expect(
      service.startStandIn({ agentId: executor.id, brief: "Second stand-in." }),
    ).rejects.toThrow(/already has a running stand-in/);

    await service.stopStandIn(first.id);
    expect((await service.inspectStandIn(first.id)).status).toBe("stopped");
  });
});

async function waitForStandInToStop(service: StandInService, standInId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await service.inspectStandIn(standInId)).status !== "running") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for stand-in ${standInId} to stop`);
}
