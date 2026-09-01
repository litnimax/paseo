import { MAX_USER_PROMPTS, type UserPrompt } from "@getpaseo/protocol/messages";

export function mergeUserPrompts(
  serverPrompts: readonly UserPrompt[],
  legacyPrompts: readonly UserPrompt[],
): UserPrompt[] {
  const merged = [...serverPrompts];
  const ids = new Set(serverPrompts.map((prompt) => prompt.id));
  for (const prompt of legacyPrompts) {
    if (merged.length >= MAX_USER_PROMPTS) break;
    if (ids.has(prompt.id)) continue;
    ids.add(prompt.id);
    merged.push(prompt);
  }
  return merged;
}

export function includesEveryUserPrompt(
  prompts: readonly UserPrompt[],
  expected: readonly UserPrompt[],
): boolean {
  const ids = new Set(prompts.map((prompt) => prompt.id));
  return expected.every((prompt) => ids.has(prompt.id));
}
