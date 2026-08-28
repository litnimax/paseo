import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createGitHubService, type GitHubCommandRunnerOptions } from "./github-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pull request creation uses the selected operator gh auth directory", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "paseo-operator-gh-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/project.git"], {
    cwd: repo,
  });
  const calls: Array<{ args: string[]; options: GitHubCommandRunnerOptions }> = [];
  const service = createGitHubService({
    resolveGhPath: async () => "gh",
    resolveRepoHost: async () => null,
    runner: async (args, options) => {
      calls.push({ args, options });
      return { stdout: '{"url":"https://github.com/acme/project/pull/7","number":7}', stderr: "" };
    },
  });

  await service.createPullRequest({
    cwd: repo,
    title: "Operator auth",
    body: "Requested by Max.",
    head: "max/operator-auth",
    base: "main",
    envOverlay: { GH_CONFIG_DIR: "/paseo-home/operator-credentials/max/gh" },
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.options.envOverlay).toMatchObject({
    GH_CONFIG_DIR: "/paseo-home/operator-credentials/max/gh",
  });
  expect(calls[0]?.args).toContain("body=Requested by Max.");
});
