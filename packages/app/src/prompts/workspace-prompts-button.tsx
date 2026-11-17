import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, MessageSquareText, Settings } from "lucide-react-native";
import type { UserPrompt } from "@getpaseo/protocol/messages";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type DropdownMenuItemSelectEvent,
} from "@/components/ui/dropdown-menu";
import { openDraftChat } from "@/composer/draft/open-draft-chat";
import {
  resolveFocusedChatTarget,
  resolveFocusedPaneChatTarget,
} from "@/composer/focused-chat-target";
import { useToast } from "@/contexts/toast-api-context";
import { useServerPrompts } from "@/prompts/use-server-prompts";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  appendPromptText,
  shouldOpenPromptInNewChat,
  shouldSendPromptImmediately,
} from "./prompt-insertion";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedMessageSquareText = withUnistyles(MessageSquareText);
const ThemedSettings = withUnistyles(Settings);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const MANAGE_PROMPTS_ICON = <ThemedSettings size={16} uniProps={mutedColorMapping} />;

function promptPreview(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

interface WorkspacePromptsButtonProps {
  serverId: string;
  workspaceId: string | null;
  cwd: string;
  hideLabels?: boolean;
}

function PromptMenuItem({
  prompt,
  onSelect,
}: {
  prompt: UserPrompt;
  onSelect: (prompt: UserPrompt, event: DropdownMenuItemSelectEvent) => void;
}) {
  const handleSelect = useCallback(
    (event: DropdownMenuItemSelectEvent) => onSelect(prompt, event),
    [onSelect, prompt],
  );
  return (
    <DropdownMenuItem
      description={promptPreview(prompt.prompt)}
      closeOnSelect
      onSelect={handleSelect}
      testID={`workspace-prompt-${prompt.id}`}
    >
      {prompt.name}
    </DropdownMenuItem>
  );
}

export function WorkspacePromptsButton({
  serverId,
  workspaceId,
  cwd,
  hideLabels,
}: WorkspacePromptsButtonProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { prompts } = useServerPrompts(serverId);
  const shortcutOs = getShortcutOs();
  const persistenceKey = useMemo(
    () =>
      buildWorkspaceTabPersistenceKey({
        serverId,
        workspaceId: workspaceId ?? cwd,
      }),
    [cwd, serverId, workspaceId],
  );
  const layout = useWorkspaceLayoutStore((state) =>
    persistenceKey ? state.layoutByWorkspace[persistenceKey] : undefined,
  );
  const toast = useToast();

  const openPromptInNewChat = useCallback(
    (prompt: UserPrompt, send: boolean) => {
      const sent = openDraftChat({ serverId, workspaceId, cwd, text: prompt.prompt, send });
      if (send && !sent) toast.error(t("workspace.prompts.sendUnavailable"));
    },
    [cwd, serverId, t, toast, workspaceId],
  );

  const insertPromptIntoCurrentChat = useCallback(
    async (prompt: UserPrompt) => {
      const focusedChat = resolveFocusedChatTarget({ serverId, layout });
      if (!focusedChat) {
        openPromptInNewChat(prompt, false);
        return;
      }
      await useDraftStore.getState().updateDraftText({
        draftKey: focusedChat.draftKey,
        update: (currentText) => appendPromptText(currentText, prompt.prompt),
      });
    },
    [layout, openPromptInNewChat, serverId],
  );

  // Only the focused pane's chat: a prompt sent elsewhere would reach an agent the user is not
  // looking at. A chat whose composer is not mounted (archived) cannot take it either.
  const sendPromptToCurrentChat = useCallback(
    (prompt: UserPrompt) => {
      const focusedChat = resolveFocusedPaneChatTarget({ serverId, layout });
      const requested =
        focusedChat !== null &&
        useDraftStore
          .getState()
          .requestDraftSend({ draftKey: focusedChat.draftKey, text: prompt.prompt });
      if (!requested) openPromptInNewChat(prompt, true);
    },
    [layout, openPromptInNewChat, serverId],
  );

  const handleSelectPrompt = useCallback(
    (prompt: UserPrompt, event: DropdownMenuItemSelectEvent) => {
      const send = shouldSendPromptImmediately(event);
      if (shouldOpenPromptInNewChat(event, shortcutOs)) {
        openPromptInNewChat(prompt, send);
        return;
      }
      if (send) {
        sendPromptToCurrentChat(prompt);
        return;
      }
      void insertPromptIntoCurrentChat(prompt);
    },
    [insertPromptIntoCurrentChat, openPromptInNewChat, sendPromptToCurrentChat, shortcutOs],
  );

  const handleManagePrompts = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(serverId, "prompts"));
  }, [router, serverId]);

  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.trigger,
      (hovered || pressed || open) && styles.triggerActive,
    ],
    [],
  );

  return (
    <View style={styles.frame}>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.prompts.accessibilityLabel")}
          testID="workspace-prompts-button"
        >
          <View style={styles.content}>
            <ThemedMessageSquareText size={14} uniProps={mutedColorMapping} />
            {!hideLabels ? <Text style={styles.label}>{t("workspace.prompts.label")}</Text> : null}
            <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
          </View>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" minWidth={240} maxWidth={340}>
          <DropdownMenuHint>
            {t(shortcutOs === "mac" ? "workspace.prompts.hintMac" : "workspace.prompts.hintOther")}
          </DropdownMenuHint>
          {prompts.length > 0 ? (
            prompts.map((prompt) => (
              <PromptMenuItem key={prompt.id} prompt={prompt} onSelect={handleSelectPrompt} />
            ))
          ) : (
            <DropdownMenuLabel>{t("workspace.prompts.empty")}</DropdownMenuLabel>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem leading={MANAGE_PROMPTS_ICON} onSelect={handleManagePrompts}>
            {t("workspace.prompts.manage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
    flexShrink: 0,
  },
  trigger: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    justifyContent: "center",
  },
  triggerActive: {
    backgroundColor: theme.colors.surface2,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
    fontWeight: theme.fontWeight.normal,
  },
}));
