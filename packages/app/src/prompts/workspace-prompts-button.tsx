import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, MessageSquareText, Settings } from "lucide-react-native";
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
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useAppSettings, type UserPrompt } from "@/hooks/use-settings";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { appendPromptText, shouldOpenPromptInNewChat } from "./prompt-insertion";

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
  const { settings } = useAppSettings();
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
  const focusedChat = useMemo(
    () => resolveFocusedChatTarget({ serverId, layout }),
    [layout, serverId],
  );

  const openPromptInNewChat = useCallback(
    (prompt: UserPrompt) => {
      const draftId = generateDraftId();
      useDraftStore.getState().saveDraftInput({
        draftKey: buildDraftStoreKey({ serverId, agentId: draftId, draftId }),
        draft: { text: prompt.prompt, attachments: [] },
      });
      const target = normalizeWorkspaceTabTarget({ kind: "draft", draftId });
      if (target && persistenceKey) {
        useWorkspaceLayoutStore.getState().openTabFocused(persistenceKey, target);
      }
    },
    [persistenceKey, serverId],
  );

  const insertPromptIntoCurrentChat = useCallback(
    async (prompt: UserPrompt) => {
      if (!focusedChat) {
        openPromptInNewChat(prompt);
        return;
      }
      const store = useDraftStore.getState();
      const hydrated =
        store.getDraftInput(focusedChat.draftKey) ??
        (await store.hydrateDraftInput({ draftKey: focusedChat.draftKey }));
      const current = store.getDraftInput(focusedChat.draftKey) ??
        hydrated ?? {
          text: "",
          attachments: [],
        };
      store.saveDraftInput({
        draftKey: focusedChat.draftKey,
        draft: { ...current, text: appendPromptText(current.text, prompt.prompt) },
      });
    },
    [focusedChat, openPromptInNewChat],
  );

  const handleSelectPrompt = useCallback(
    (prompt: UserPrompt, event: DropdownMenuItemSelectEvent) => {
      if (shouldOpenPromptInNewChat(event, shortcutOs)) {
        openPromptInNewChat(prompt);
        return;
      }
      void insertPromptIntoCurrentChat(prompt);
    },
    [insertPromptIntoCurrentChat, openPromptInNewChat, shortcutOs],
  );

  const handleManagePrompts = useCallback(() => {
    router.push(buildSettingsSectionRoute("prompts"));
  }, [router]);

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
          {settings.userPrompts.length > 0 ? (
            settings.userPrompts.map((prompt) => (
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
