import { describe, expect, test, vi } from "vitest";
import type pino from "pino";
import { Session, type SessionOptions } from "./session.js";
import { OWNER_PERMISSIONS } from "./authorization/index.js";
import { createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import { createNoopWorkspaceGitService } from "./test-utils/workspace-git-service-stub.js";
import type { SessionOutboundMessage } from "./messages.js";
import type { AgentTimelineRow } from "./agent/agent-timeline-store-types.js";

const ROWS: AgentTimelineRow[] = [
  {
    seq: 1,
    timestamp: "2026-03-01T12:00:00.000Z",
    item: { type: "user_message", text: "fix the parser" },
  },
  {
    seq: 2,
    timestamp: "2026-03-01T12:00:01.000Z",
    item: { type: "assistant_message", text: "the parser is fixed" },
  },
  {
    seq: 3,
    timestamp: "2026-03-01T12:00:02.000Z",
    item: { type: "todo", items: [] },
  },
];

function createSessionForTimelineSearchTests(): {
  session: Session;
  emitted: SessionOutboundMessage[];
} {
  const emitted: SessionOutboundMessage[] = [];
  const logger = {
    child: () => logger,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const session = new Session({
    clientId: "test-client",
    permissions: OWNER_PERMISSIONS,
    onMessage: (message) => emitted.push(message),
    logger: createStub<pino.Logger>(logger),
    downloadTokenStore: createStub<SessionOptions["downloadTokenStore"]>({}),
    pushNotifications: createStub<SessionOptions["pushNotifications"]>({}),
    paseoHome: "/tmp/paseo-test",
    agentManager: createStub<SessionOptions["agentManager"]>({
      subscribe: () => () => {},
      listAgents: () => [],
      waitForAgentClose: async () => {},
      // ensureAgentLoaded stops here, so nothing resumes from storage.
      getAgent: () => ({}),
      getTimelineRows: async () => ROWS,
      fetchTimeline: () => ({ epoch: "epoch-1" }),
    }),
    agentStorage: createStub<SessionOptions["agentStorage"]>({
      list: async () => [],
      get: async () => null,
    }),
    projectRegistry: createStub<SessionOptions["projectRegistry"]>({
      subscribeToMutations: () => () => {},
      initialize: async () => {},
      list: async () => [],
    }),
    workspaceRegistry: createStub<SessionOptions["workspaceRegistry"]>({
      subscribeToMutations: () => () => {},
      initialize: async () => {},
      list: async () => [],
    }),
    checkoutDiffManager: createStub<SessionOptions["checkoutDiffManager"]>({
      dispose: () => {},
    }),
    workspaceGitService: createNoopWorkspaceGitService(),
    mcpBaseUrl: null,
    stt: null,
    tts: null,
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
    terminalManager: null,
    getDaemonTcpPort: () => 6767,
  });

  return { session, emitted };
}

function searchResponse(emitted: SessionOutboundMessage[]) {
  const message = emitted.find((entry) => entry.type === "agent.timeline.search.response");
  if (!message || message.type !== "agent.timeline.search.response") {
    throw new Error("no agent.timeline.search.response was emitted");
  }
  return message.payload;
}

describe("agent.timeline.search", () => {
  test("answers with the matching rows and the timeline epoch", async () => {
    const { session, emitted } = createSessionForTimelineSearchTests();

    await session.handleMessage({
      type: "agent.timeline.search.request",
      agentId: "agent-1",
      requestId: "req-1",
      query: "parser",
    });

    const payload = searchResponse(emitted);
    expect(payload).toMatchObject({
      requestId: "req-1",
      agentId: "agent-1",
      epoch: "epoch-1",
      query: "parser",
      truncated: false,
      error: null,
    });
    expect(payload.hits.map((hit) => hit.seq)).toEqual([1, 2]);
  });

  test("reports the failure instead of dropping the request", async () => {
    const { session, emitted } = createSessionForTimelineSearchTests();
    const failing = session as unknown as {
      agentManager: { getTimelineRows: () => Promise<AgentTimelineRow[]> };
    };
    failing.agentManager.getTimelineRows = () => Promise.reject(new Error("timeline unavailable"));

    await session.handleMessage({
      type: "agent.timeline.search.request",
      agentId: "agent-1",
      requestId: "req-2",
      query: "parser",
    });

    const payload = searchResponse(emitted);
    expect(payload.error).toBe("timeline unavailable");
    expect(payload.hits).toEqual([]);
  });
});
