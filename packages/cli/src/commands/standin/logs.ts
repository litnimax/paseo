import { Command } from "commander";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, CommandOptions } from "../../output/index.js";
import type { StandInDaemonClient, StandInLogEntry } from "./types.js";

export interface StandInLogsOptions extends CommandOptions {
  pollInterval?: string;
}

export function addStandInLogsOptions(command: Command): Command {
  return command
    .description("Stream the stand-in conversation")
    .argument("<id>", "Stand-in ID")
    .option("--poll-interval <ms>", "Polling interval in milliseconds", "1000");
}

function parsePollInterval(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw {
      code: "INVALID_POLL_INTERVAL",
      message: "--poll-interval must be a positive integer",
    } satisfies CommandError;
  }
  return parsed;
}

function renderLogEntry(entry: StandInLogEntry): string {
  const prefix = [
    entry.timestamp,
    entry.source,
    entry.exchange === null ? null : `exchange=${entry.exchange}`,
    entry.level === "error" ? "ERROR" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${prefix}\n${entry.text}`;
}

export async function runStandInLogsCommand(
  id: string,
  options: StandInLogsOptions,
  _command: Command,
): Promise<void> {
  const host = getDaemonHost({ host: options.host });
  const pollInterval = parsePollInterval(options.pollInterval ?? "1000");
  let client: StandInDaemonClient;
  try {
    client = (await connectToDaemon({
      host: options.host,
    })) as unknown as StandInDaemonClient;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: Cannot connect to daemon at ${host}: ${message}`);
    console.error("Start the daemon with: paseo daemon start");
    process.exit(1);
  }

  async function streamLogs(cursor: number): Promise<void> {
    const payload = await client.standInLogs(id, cursor);
    if (payload.error || !payload.standIn) {
      throw new Error(payload.error ?? `Stand-in not found: ${id}`);
    }
    for (const entry of payload.entries) {
      console.log(renderLogEntry(entry));
    }
    if (payload.standIn.status !== "running") {
      await client.close();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    return streamLogs(payload.nextCursor);
  }

  try {
    await streamLogs(0);
  } catch (error) {
    await client.close().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: Failed to stream stand-in logs: ${message}`);
    process.exit(1);
  }
}
