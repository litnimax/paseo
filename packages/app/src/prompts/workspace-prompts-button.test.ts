import { describe, expect, it } from "vitest";
import { appendPromptText, shouldOpenPromptInNewChat } from "./prompt-insertion";

describe("workspace prompt insertion", () => {
  it("inserts into an empty composer without leading whitespace", () => {
    expect(appendPromptText("", "Review the current changes.")).toBe("Review the current changes.");
  });

  it("appends to existing composer text without overwriting it", () => {
    expect(appendPromptText("Keep this context.  ", "Review the current changes.")).toBe(
      "Keep this context.\n\nReview the current changes.",
    );
  });

  it("uses Command on Mac and Ctrl elsewhere to open a new chat", () => {
    expect(shouldOpenPromptInNewChat({ metaKey: true, ctrlKey: false }, "mac")).toBe(true);
    expect(shouldOpenPromptInNewChat({ metaKey: false, ctrlKey: true }, "mac")).toBe(false);
    expect(shouldOpenPromptInNewChat({ metaKey: false, ctrlKey: true }, "non-mac")).toBe(true);
    expect(shouldOpenPromptInNewChat({ metaKey: true, ctrlKey: false }, "non-mac")).toBe(false);
  });
});
