import type { DropdownMenuItemSelectEvent } from "@/components/ui/dropdown-menu";
import type { ShortcutOs } from "@/utils/format-shortcut";

export function appendPromptText(currentText: string, prompt: string): string {
  const current = currentText.trimEnd();
  return current ? `${current}\n\n${prompt}` : prompt;
}

export function shouldOpenPromptInNewChat(
  event: DropdownMenuItemSelectEvent,
  shortcutOs: ShortcutOs,
): boolean {
  return shortcutOs === "mac" ? event.metaKey : event.ctrlKey;
}

/** Shift sends the prompt straight away instead of leaving it in the composer. */
export function shouldSendPromptImmediately(event: DropdownMenuItemSelectEvent): boolean {
  return event.shiftKey;
}

export type PromptSendStep = "wait" | "insert" | "send";

/**
 * What a composer does with a prompt asked to be sent. It waits while it cannot send, and only
 * inserts when the user already has a message or attachments there, so their work is not sent
 * along with the prompt.
 */
export function resolvePromptSendStep(input: {
  isSubmitBlocked: boolean;
  composerText: string;
  hasAttachments: boolean;
}): PromptSendStep {
  if (input.isSubmitBlocked) return "wait";
  if (input.composerText.trim() || input.hasAttachments) return "insert";
  return "send";
}
