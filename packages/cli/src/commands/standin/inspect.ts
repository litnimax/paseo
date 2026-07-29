import { Command } from "commander";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandOptions, CommandError, OutputSchema, ListResult } from "../../output/index.js";
import type { StandInDaemonClient, StandInRecord } from "./types.js";

interface InspectRow {
  key: string;
  value: string;
}

export interface StandInInspectOptions extends CommandOptions {}

export function addStandInInspectOptions(command: Command): Command {
  return command
    .description("Show stand-in details and the conversation so far")
    .argument("<id>", "Stand-in ID");
}

function createInspectSchema(standIn: StandInRecord): OutputSchema<InspectRow> {
  return {
    idField: "key",
    columns: [
      { header: "KEY", field: "key", width: 18 },
      { header: "VALUE", field: "value", width: 80 },
    ],
    serialize: () => standIn,
  };
}

function toRows(standIn: StandInRecord): InspectRow[] {
  return [
    { key: "Id", value: standIn.id },
    { key: "Name", value: standIn.name ?? "null" },
    { key: "Agent", value: standIn.agentId },
    { key: "StandInAgent", value: standIn.standInAgentId ?? "null" },
    { key: "Status", value: standIn.status },
    { key: "Cwd", value: standIn.cwd },
    { key: "Provider", value: standIn.provider },
    { key: "Model", value: standIn.model ?? "null" },
    { key: "Mode", value: standIn.modeId ?? "null" },
    { key: "Label", value: standIn.label ?? "null" },
    { key: "Brief", value: standIn.brief },
    { key: "Replies", value: String(standIn.replyCount) },
    { key: "MaxReplies", value: standIn.maxReplies === null ? "null" : String(standIn.maxReplies) },
    { key: "MaxTimeMs", value: standIn.maxTimeMs === null ? "null" : String(standIn.maxTimeMs) },
    { key: "Archive", value: String(standIn.archive) },
    { key: "CreatedAt", value: standIn.createdAt },
    { key: "UpdatedAt", value: standIn.updatedAt },
    { key: "CompletedAt", value: standIn.completedAt ?? "null" },
    {
      key: "Exchanges",
      value:
        standIn.exchanges.length === 0
          ? "[]"
          : standIn.exchanges
              .map((exchange) => `#${exchange.index} ${exchange.decision}: ${exchange.message}`)
              .join(" | "),
    },
  ];
}

export type StandInInspectResult = ListResult<InspectRow>;

export async function runStandInInspectCommand(
  id: string,
  options: StandInInspectOptions,
  _command: Command,
): Promise<StandInInspectResult> {
  const host = getDaemonHost({ host: options.host });
  let client;
  try {
    client = (await connectToDaemon({
      host: options.host,
    })) as unknown as StandInDaemonClient;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    } satisfies CommandError;
  }

  try {
    const payload = await client.standInInspect(id);
    await client.close();
    if (payload.error || !payload.standIn) {
      throw new Error(payload.error ?? `Stand-in not found: ${id}`);
    }
    return {
      type: "list",
      data: toRows(payload.standIn),
      schema: createInspectSchema(payload.standIn),
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw {
      code: "STANDIN_INSPECT_FAILED",
      message: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }
}
