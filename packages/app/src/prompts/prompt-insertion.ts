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
