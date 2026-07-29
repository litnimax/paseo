import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { StandInService } from "../../standin-service.js";

export type StandInRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "standin.start.request"
      | "standin.list.request"
      | "standin.inspect.request"
      | "standin.get_logs.request"
      | "standin.stop.request";
  }
>;

export interface StandInSessionHost {
  emit(msg: SessionOutboundMessage): void;
  resolveAgentIdentifier(
    identifier: string,
  ): Promise<{ ok: true; agentId: string } | { ok: false; error: string }>;
}

export interface StandInSessionOptions {
  host: StandInSessionHost;
  standInService: StandInService;
  logger: pino.Logger;
}

/**
 * A client's stand-in request surface. Like chat/schedule/loop this is a stateless
 * request/response over one service, with no subscriptions to tear down: the
 * stand-in conversation itself is watched by StandInService inside the daemon, not
 * by the client session that started it.
 */
export class StandInSession {
  private readonly host: StandInSessionHost;
  private readonly standInService: StandInService;
  private readonly logger: pino.Logger;

  constructor(options: StandInSessionOptions) {
    this.host = options.host;
    this.standInService = options.standInService;
    this.logger = options.logger;
  }

  async dispatch(request: StandInRequest): Promise<void> {
    switch (request.type) {
      case "standin.start.request":
        return await this.handleStart(request);
      case "standin.list.request":
        return await this.handleList(request);
      case "standin.inspect.request":
        return await this.handleInspect(request);
      case "standin.get_logs.request":
        return await this.handleLogs(request);
      case "standin.stop.request":
        return await this.handleStop(request);
    }
  }

  private emitRpcError(request: StandInRequest, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error({ err: error, requestType: request.type }, "Stand-in request failed");
    this.host.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "standin_request_failed",
      },
    });
  }

  private async handleStart(
    request: Extract<SessionInboundMessage, { type: "standin.start.request" }>,
  ): Promise<void> {
    try {
      const resolved = await this.host.resolveAgentIdentifier(request.agentId);
      if (!resolved.ok) {
        throw new Error(resolved.error);
      }
      const standIn = await this.standInService.startStandIn({
        agentId: resolved.agentId,
        brief: request.brief,
        name: request.name,
        provider: request.provider,
        model: request.model,
        modeId: request.modeId,
        label: request.label,
        labelReplies: request.labelReplies,
        archive: request.archive,
        maxReplies: request.maxReplies,
        maxTimeMs: request.maxTimeMs,
      });
      this.host.emit({
        type: "standin.start.response",
        payload: { requestId: request.requestId, standIn, error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  private async handleList(
    request: Extract<SessionInboundMessage, { type: "standin.list.request" }>,
  ): Promise<void> {
    try {
      const standIns = await this.standInService.listStandIns();
      this.host.emit({
        type: "standin.list.response",
        payload: { requestId: request.requestId, standIns, error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  private async handleInspect(
    request: Extract<SessionInboundMessage, { type: "standin.inspect.request" }>,
  ): Promise<void> {
    try {
      const standIn = await this.standInService.inspectStandIn(request.id);
      this.host.emit({
        type: "standin.inspect.response",
        payload: { requestId: request.requestId, standIn, error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  private async handleLogs(
    request: Extract<SessionInboundMessage, { type: "standin.get_logs.request" }>,
  ): Promise<void> {
    try {
      const result = await this.standInService.getStandInLogs(request.id, request.afterSeq ?? 0);
      this.host.emit({
        type: "standin.get_logs.response",
        payload: {
          requestId: request.requestId,
          standIn: result.standIn,
          entries: result.entries,
          nextCursor: result.nextCursor,
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  private async handleStop(
    request: Extract<SessionInboundMessage, { type: "standin.stop.request" }>,
  ): Promise<void> {
    try {
      const standIn = await this.standInService.stopStandIn(request.id);
      this.host.emit({
        type: "standin.stop.response",
        payload: { requestId: request.requestId, standIn, error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }
}
