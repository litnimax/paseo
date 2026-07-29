import { Command } from "commander";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type {
  CommandOptions,
  CommandError,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { parseDuration } from "../../utils/duration.js";
import { resolveProviderAndModel } from "../../utils/provider-model.js";
import type { StandInDaemonClient, StandInRecord, StandInStartInput } from "./types.js";

export interface StandInStartRow {
  id: string;
  agentId: string;
  status: string;
  name: string | null;
}

export interface StandInStartOptions extends CommandOptions {
  provider?: string;
  model?: string;
  mode?: string;
  name?: string;
  /** `--label <text>` gives a string; `--no-label` gives `false`. */
  label?: string | false;
  archive?: boolean;
  maxReplies?: string;
  maxTime?: string;
}

export const standInStartSchema: OutputSchema<StandInStartRow> = {
  idField: "id",
  columns: [
    { header: "STAND-IN ID", field: "id", width: 12 },
    { header: "AGENT", field: "agentId", width: 38 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "NAME", field: "name", width: 20 },
  ],
};

export function addStandInStartOptions(command: Command): Command {
  return command
    .description("Start a stand-in that answers an agent's questions for you")
    .argument("<agent>", "Agent ID, unique ID prefix, or exact title")
    .argument("<brief>", "Who the stand-in is and what they want from the agent")
    .option("--provider <provider>", "Provider for the stand-in agent")
    .option("--model <model>", "Model for the stand-in agent")
    .option("--mode <mode>", "Provider-specific mode for the stand-in agent")
    .option("--name <name>", "Optional stand-in name")
    .option("--label <label>", "Prefix added to each reply (defaults to the name or 'Stand-in')")
    .option("--no-label", "Send replies verbatim, with no prefix")
    .option("--archive", "Archive the stand-in agent when the stand-in ends")
    .option("--max-replies <n>", "Maximum replies before the stand-in gives up (default 20)")
    .option("--max-time <duration>", "Maximum total runtime (for example: 1h, 30m)");
}

function toRow(standIn: StandInRecord): StandInStartRow {
  return {
    id: standIn.id,
    agentId: standIn.agentId,
    status: standIn.status,
    name: standIn.name,
  };
}

function parseMaxReplies(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw {
      code: "INVALID_MAX_REPLIES",
      message: "--max-replies must be a positive integer",
    } satisfies CommandError;
  }
  return parsed;
}

export function buildStandInStartInput(
  agent: string,
  brief: string,
  options: StandInStartOptions,
): StandInStartInput {
  const trimmedBrief = brief.trim();
  if (!trimmedBrief) {
    throw {
      code: "INVALID_BRIEF",
      message: "brief cannot be empty",
    } satisfies CommandError;
  }

  const result: StandInStartInput = {
    agentId: agent,
    brief: trimmedBrief,
  };

  if (options.provider) {
    const { provider, model } = resolveProviderAndModel({ provider: options.provider });
    if (provider) result.provider = provider;
    if (options.model?.trim()) {
      result.model = options.model.trim();
    } else if (model) {
      result.model = model;
    }
  } else if (options.model?.trim()) {
    result.model = options.model.trim();
  }

  if (options.mode?.trim()) result.modeId = options.mode.trim();
  if (options.name?.trim()) result.name = options.name.trim();
  // commander maps `--no-label` onto the same key, so `false` here means "off".
  if (options.label === false) {
    result.labelReplies = false;
  } else if (typeof options.label === "string" && options.label.trim()) {
    result.label = options.label.trim();
  }
  if (options.archive) result.archive = true;
  const maxReplies = parseMaxReplies(options.maxReplies);
  if (maxReplies !== undefined) result.maxReplies = maxReplies;
  if (options.maxTime) result.maxTimeMs = parseDuration(options.maxTime);

  return result;
}

export type StandInStartResult = SingleResult<StandInStartRow>;

export async function runStandInStartCommand(
  agent: string,
  brief: string,
  options: StandInStartOptions,
  _command: Command,
): Promise<StandInStartResult> {
  const host = getDaemonHost({ host: options.host });
  const input = buildStandInStartInput(agent, brief, options);
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
    const payload = await client.standInStart(input);
    await client.close();
    if (payload.error || !payload.standIn) {
      throw new Error(payload.error ?? "Stand-in creation failed");
    }
    return {
      type: "single",
      data: toRow(payload.standIn),
      schema: standInStartSchema,
    };
  } catch (error) {
    await client.close().catch(() => {});
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }
    throw {
      code: "STANDIN_START_FAILED",
      message: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }
}
