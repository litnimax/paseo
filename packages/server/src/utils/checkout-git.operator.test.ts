import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { commitChanges } from "./checkout-git.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("commit identity is process-scoped and leaves repository config unchanged", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "paseo-operator-git-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Shared Server"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "shared@example.com"], { cwd: repo });
  writeFileSync(path.join(repo, "file.txt"), "operator identity\n");

  await commitChanges(repo, {
    message: "Test operator identity",
    envOverlay: {
      GIT_AUTHOR_NAME: "Max Example",
      GIT_AUTHOR_EMAIL: "max@example.com",
      GIT_COMMITTER_NAME: "Max Example",
      GIT_COMMITTER_EMAIL: "max@example.com",
    },
  });

  expect(
    execFileSync("git", ["show", "-s", "--format=%an|%ae|%cn|%ce", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
  ).toBe("Max Example|max@example.com|Max Example|max@example.com");
  expect(execFileSync("git", ["config", "user.name"], { cwd: repo, encoding: "utf8" }).trim()).toBe(
    "Shared Server",
  );
  expect(
    execFileSync("git", ["config", "user.email"], { cwd: repo, encoding: "utf8" }).trim(),
  ).toBe("shared@example.com");
});
