import { describe, expect, it } from "vitest";
import {
  appendPromptText,
  shouldOpenPromptInNewChat,
  resolvePromptSendStep,
  shouldSendPromptImmediately,
} from "./prompt-insertion";

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
    expect(
      shouldOpenPromptInNewChat({ metaKey: true, ctrlKey: false, shiftKey: false }, "mac"),
    ).toBe(true);
    expect(
      shouldOpenPromptInNewChat({ metaKey: false, ctrlKey: true, shiftKey: false }, "mac"),
    ).toBe(false);
    expect(
      shouldOpenPromptInNewChat({ metaKey: false, ctrlKey: true, shiftKey: false }, "non-mac"),
    ).toBe(true);
    expect(
      shouldOpenPromptInNewChat({ metaKey: true, ctrlKey: false, shiftKey: false }, "non-mac"),
    ).toBe(false);
  });

  it("sends straight away on Shift-click, alone or with the new-chat modifier", () => {
    expect(shouldSendPromptImmediately({ metaKey: false, ctrlKey: false, shiftKey: true })).toBe(
      true,
    );
    expect(shouldSendPromptImmediately({ metaKey: false, ctrlKey: true, shiftKey: true })).toBe(
      true,
    );
    expect(shouldSendPromptImmediately({ metaKey: false, ctrlKey: false, shiftKey: false })).toBe(
      false,
    );
  });

  it("sends into an empty composer and only inserts over the user's own message", () => {
    expect(
      resolvePromptSendStep({ isSubmitBlocked: false, composerText: "  ", hasAttachments: false }),
    ).toBe("send");
    expect(
      resolvePromptSendStep({
        isSubmitBlocked: false,
        composerText: "half typed",
        hasAttachments: false,
      }),
    ).toBe("insert");
    expect(
      resolvePromptSendStep({ isSubmitBlocked: false, composerText: "", hasAttachments: true }),
    ).toBe("insert");
  });

  it("waits while the composer cannot send", () => {
    expect(
      resolvePromptSendStep({ isSubmitBlocked: true, composerText: "", hasAttachments: false }),
    ).toBe("wait");
  });
});
