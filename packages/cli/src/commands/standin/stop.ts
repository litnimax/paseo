import { Command } from "commander";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type {
  CommandOptions,
  CommandError,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import type { StandInDaemonClient, StandInRecord } from "./types.js";

interface StandInStopRow {
  id: string;
  status: string;
  replies: string;
}

export interface StandInStopOptions extends CommandOptions {}

export const standInStopSchema: OutputSchema<StandInStopRow> = {
  idField: "id",
  columns: [
    { header: "STAND-IN ID", field: "id", width: 12 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "REPLIES", field: "replies", width: 8 },
  ],
};

export function addStandInStopOptions(command: Command): Command {
  return command.description("Stop a running stand-in").argument("<id>", "Stand-in ID");
}

function toRow(standIn: StandInRecord): StandInStopRow {
  return {
    id: standIn.id,
    status: standIn.status,
    replies: String(standIn.replyCount),
  };
}

export type StandInStopResult = SingleResult<StandInStopRow>;

export async function runStandInStopCommand(
  id: string,
  options: StandInStopOptions,
  _command: Command,
): Promise<StandInStopResult> {
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
    const payload = await client.standInStop(id);
    await client.close();
    if (payload.error || !payload.standIn) {
      throw new Error(payload.error ?? `Stand-in not found: ${id}`);
    }
    return {
      type: "single",
      data: toRow(payload.standIn),
      schema: standInStopSchema,
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw {
      code: "STANDIN_STOP_FAILED",
      message: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }
}
