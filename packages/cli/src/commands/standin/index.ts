import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addDaemonHostOption } from "../../utils/command-options.js";
import { addStandInStartOptions, runStandInStartCommand } from "./start.js";
import { addStandInLsOptions, runStandInLsCommand } from "./ls.js";
import { addStandInInspectOptions, runStandInInspectCommand } from "./inspect.js";
import { addStandInLogsOptions, runStandInLogsCommand } from "./logs.js";
import { addStandInStopOptions, runStandInStopCommand } from "./stop.js";

export function createStandInCommand(): Command {
  const standIn = new Command("standin").description(
    "Let an agent answer another agent's questions in your place",
  );

  addJsonAndDaemonHostOptions(addStandInStartOptions(standIn.command("start"))).action(
    withOutput(runStandInStartCommand),
  );

  addJsonAndDaemonHostOptions(addStandInLsOptions(standIn.command("ls"))).action(
    withOutput(runStandInLsCommand),
  );

  addJsonAndDaemonHostOptions(addStandInInspectOptions(standIn.command("inspect"))).action(
    withOutput(runStandInInspectCommand),
  );

  addDaemonHostOption(addStandInLogsOptions(standIn.command("logs"))).action(runStandInLogsCommand);

  addJsonAndDaemonHostOptions(addStandInStopOptions(standIn.command("stop"))).action(
    withOutput(runStandInStopCommand),
  );

  return standIn;
}
