import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  appendRequestedBy,
  resolveOperatorGitEnvironment,
  resolveOperatorGitHubEnvironment,
  resolveTeamMember,
} from "./operator-identity.js";

const member = {
  id: "max",
  name: "Max",
  color: "blue" as const,
  git: { name: "Max Example", email: "max@example.com" },
};

describe("operator identity", () => {
  test("resolves a configured member and process-scoped Git environments", () => {
    expect(resolveTeamMember({ teamMembers: [member] }, "max")).toEqual(member);
    expect(resolveOperatorGitEnvironment(member)).toEqual({
      GIT_AUTHOR_NAME: "Max Example",
      GIT_AUTHOR_EMAIL: "max@example.com",
      GIT_COMMITTER_NAME: "Max Example",
      GIT_COMMITTER_EMAIL: "max@example.com",
    });
    expect(resolveOperatorGitHubEnvironment("/paseo-home", member)).toEqual({
      GH_CONFIG_DIR: path.join("/paseo-home", "operator-credentials", "max", "gh"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "!gh auth git-credential",
    });
  });

  test("appends the requested-by sentence exactly once without Paseo branding", () => {
    expect(appendRequestedBy("Body", member)).toBe("Body\n\nRequested by Max.");
    expect(appendRequestedBy("Body\n\nRequested by Max.", member)).toBe(
      "Body\n\nRequested by Max.",
    );
  });
});
