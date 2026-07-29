import { Command } from "commander";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandOptions, CommandError, OutputSchema, ListResult } from "../../output/index.js";
import type { StandInDaemonClient, StandInListItem } from "./types.js";

interface StandInListRow {
  id: string;
  name: string | null;
  agentId: string;
  status: string;
  replies: string;
  updated: string;
}

export interface StandInLsOptions extends CommandOptions {}

export const standInLsSchema: OutputSchema<StandInListRow> = {
  idField: "id",
  columns: [
    { header: "STAND-IN ID", field: "id", width: 12 },
    { header: "NAME", field: "name", width: 20 },
    { header: "AGENT", field: "agentId", width: 38 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "REPLIES", field: "replies", width: 8 },
    { header: "UPDATED", field: "updated", width: 24 },
  ],
};

export function addStandInLsOptions(command: Command): Command {
  return command.description("List stand-ins");
}

function toRow(standIn: StandInListItem): StandInListRow {
  return {
    id: standIn.id,
    name: standIn.name,
    agentId: standIn.agentId,
    status: standIn.status,
    replies: String(standIn.replyCount),
    updated: standIn.updatedAt,
  };
}

export type StandInLsResult = ListResult<StandInListRow>;

export async function runStandInLsCommand(
  options: StandInLsOptions,
  _command: Command,
): Promise<StandInLsResult> {
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
    const payload = await client.standInList();
    await client.close();
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      type: "list",
      data: payload.standIns.map(toRow),
      schema: standInLsSchema,
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw {
      code: "STANDIN_LIST_FAILED",
      message: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }
}
