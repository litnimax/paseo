import { describe, expect, test } from "vitest";
import {
  MAX_USER_PROMPTS,
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
} from "./messages";

describe("daemon user prompts", () => {
  test("keeps the field optional for responses from older daemons", () => {
    const config = MutableDaemonConfigSchema.parse({
      mcp: { injectIntoAgents: false },
    });

    expect(config.userPrompts).toBeUndefined();
  });

  test("validates prompt patches at the server limit", () => {
    const userPrompts = Array.from({ length: MAX_USER_PROMPTS }, (_, index) => ({
      id: `prompt-${index}`,
      name: `Prompt ${index}`,
      prompt: `Run prompt ${index}`,
    }));

    expect(MutableDaemonConfigPatchSchema.parse({ userPrompts })).toEqual({ userPrompts });
    expect(
      MutableDaemonConfigPatchSchema.safeParse({
        userPrompts: [...userPrompts, { id: "extra", name: "Extra", prompt: "Extra prompt" }],
      }).success,
    ).toBe(false);
  });
});
