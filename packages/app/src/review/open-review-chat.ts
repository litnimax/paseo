import type { DropdownMenuItemSelectEvent } from "@/components/ui/dropdown-menu";
import { openDraftChat } from "@/composer/draft/open-draft-chat";
import { shouldOpenPromptInNewChat } from "@/prompts/prompt-insertion";
import type { ShortcutOs } from "@/utils/format-shortcut";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

interface OpenReviewChatInput {
  serverId: string;
  workspaceId: string | null | undefined;
  cwd: string;
  text: string;
  provider: string;
  model: string;
  event: DropdownMenuItemSelectEvent;
  shortcutOs: ShortcutOs;
  generateDraftId?: () => string;
  generateClientMessageId?: () => string;
  now?: () => number;
}

export function openReviewChat(input: OpenReviewChatInput): void {
  const provider = input.provider.trim();
  const setup: WorkspaceDraftTabSetup | undefined = provider
    ? {
        provider,
        cwd: input.cwd,
        model: input.model.trim() || null,
        modeId: null,
        thinkingOptionId: null,
        providerOptions: {},
      }
    : undefined;
  openDraftChat({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    text: input.text,
    setup,
    send: !shouldOpenPromptInNewChat(input.event, input.shortcutOs),
    generateDraftId: input.generateDraftId,
    generateClientMessageId: input.generateClientMessageId,
    now: input.now,
  });
}
