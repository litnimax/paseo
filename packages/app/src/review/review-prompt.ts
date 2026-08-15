/**
 * Built-in default text for the "Review" action in the git actions menu.
 *
 * The Review action opens a new agent draft prefilled with the review prompt
 * (it does not auto-send). Users can override this text in
 * Settings → General → Review prompt; when their override is empty we fall
 * back to this constant. Kept as a portable, provider-agnostic natural-language
 * instruction so it works across Claude Code, Codex, Copilot, OpenCode, and Pi.
 */
export const DEFAULT_REVIEW_PROMPT =
  "Review the changes in this worktree. Look for correctness bugs, edge cases, " +
  "security issues, and anything that could break in production. Call out concrete " +
  "problems with file and line references, and suggest a fix for each. Be concise " +
  "and prioritize the most important issues first.";

/** Resolve the effective review prompt, falling back to the built-in default. */
export function resolveReviewPrompt(override: string | undefined | null): string {
  const trimmed = override?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : DEFAULT_REVIEW_PROMPT;
}
