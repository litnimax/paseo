import { describe, expect, test } from "vitest";
import { MAX_USER_PROMPTS } from "@getpaseo/protocol/messages";
import { includesEveryUserPrompt, mergeUserPrompts } from "./user-prompts";

describe("mergeUserPrompts", () => {
  test("keeps the server copy when a legacy prompt has the same id", () => {
    expect(
      mergeUserPrompts(
        [{ id: "review", name: "Server review", prompt: "Review on the host" }],
        [
          { id: "review", name: "Local review", prompt: "Review on this device" },
          { id: "tests", name: "Tests", prompt: "Add tests" },
        ],
      ),
    ).toEqual([
      { id: "review", name: "Server review", prompt: "Review on the host" },
      { id: "tests", name: "Tests", prompt: "Add tests" },
    ]);
  });

  test("does not exceed the server limit while importing a legacy list", () => {
    const serverPrompts = Array.from({ length: MAX_USER_PROMPTS }, (_, index) => ({
      id: `server-${index}`,
      name: `Server ${index}`,
      prompt: `Server prompt ${index}`,
    }));
    const legacyPrompts = [{ id: "local", name: "Local", prompt: "Local prompt" }];

    const merged = mergeUserPrompts(serverPrompts, legacyPrompts);

    expect(merged).toHaveLength(MAX_USER_PROMPTS);
    expect(includesEveryUserPrompt(merged, legacyPrompts)).toBe(false);
  });
});
