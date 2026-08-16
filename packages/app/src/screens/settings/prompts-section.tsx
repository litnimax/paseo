import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MoreVertical, Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppSettings, type UserPrompt } from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { confirmDialog } from "@/utils/confirm-dialog";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { PromptEditSheet, type UserPromptDraft } from "./prompt-edit-sheet";

const ThemedMoreVertical = withUnistyles(MoreVertical);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type EditState =
  | { mode: "add"; draft: UserPromptDraft }
  | { mode: "edit"; prompt: UserPrompt; draft: UserPromptDraft };

function generateUserPromptId(): string {
  return `prompt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function promptPreview(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

interface PromptRowProps {
  prompt: UserPrompt;
  isFirst: boolean;
  onEdit: (prompt: UserPrompt) => void;
  onRemove: (prompt: UserPrompt) => void;
}

function PromptRow({ prompt, isFirst, onEdit, onRemove }: PromptRowProps) {
  const { t } = useTranslation();
  const rowStyle = useMemo(() => [styles.row, !isFirst && settingsStyles.rowBorder], [isFirst]);
  const handleEdit = useCallback(() => onEdit(prompt), [onEdit, prompt]);
  const handleRemove = useCallback(() => onRemove(prompt), [onRemove, prompt]);

  return (
    <View style={rowStyle} testID={`user-prompt-row-${prompt.id}`}>
      <Pressable style={styles.rowMain} onPress={handleEdit}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {prompt.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {promptPreview(prompt.prompt)}
        </Text>
      </Pressable>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={styles.menuTrigger}
          accessibilityLabel={t("settings.prompts.rowMenu", { name: prompt.name })}
          testID={`user-prompt-menu-${prompt.id}`}
        >
          <ThemedMoreVertical size={16} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" minWidth={160}>
          <DropdownMenuItem onSelect={handleEdit}>
            {t("settings.prompts.actions.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={handleRemove}>
            {t("settings.prompts.actions.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

export function PromptsSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const [editState, setEditState] = useState<EditState | null>(null);

  const handleAdd = useCallback(() => {
    setEditState({ mode: "add", draft: { name: "", prompt: "" } });
  }, []);
  const handleEdit = useCallback((prompt: UserPrompt) => {
    setEditState({
      mode: "edit",
      prompt,
      draft: { name: prompt.name, prompt: prompt.prompt },
    });
  }, []);
  const handleClose = useCallback(() => setEditState(null), []);

  const handleSave = useCallback(
    async (draft: UserPromptDraft) => {
      const nextPrompt: UserPrompt = {
        id: editState?.mode === "edit" ? editState.prompt.id : generateUserPromptId(),
        ...draft,
      };
      const nextPrompts =
        editState?.mode === "edit"
          ? settings.userPrompts.map((prompt) =>
              prompt.id === editState.prompt.id ? nextPrompt : prompt,
            )
          : [...settings.userPrompts, nextPrompt];
      await updateSettings({ userPrompts: nextPrompts });
    },
    [editState, settings.userPrompts, updateSettings],
  );

  const handleRemove = useCallback(
    async (prompt: UserPrompt) => {
      const confirmed = await confirmDialog({
        title: t("settings.prompts.removeTitle", { name: prompt.name }),
        message: t("settings.prompts.removeMessage"),
        confirmLabel: t("settings.prompts.actions.remove"),
        destructive: true,
      });
      if (!confirmed) return;
      try {
        await updateSettings({
          userPrompts: settings.userPrompts.filter((item) => item.id !== prompt.id),
        });
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [settings.userPrompts, t, updateSettings],
  );

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Plus}
        onPress={handleAdd}
        accessibilityLabel={t("settings.prompts.add")}
        testID="user-prompts-add-button"
      />
    ),
    [handleAdd, t],
  );

  const sheetTitle =
    editState?.mode === "edit" ? t("settings.prompts.editTitle") : t("settings.prompts.addTitle");

  return (
    <>
      <SettingsSection
        title={t("settings.prompts.title")}
        trailing={addButton}
        testID="user-prompts-section"
      >
        <Text style={styles.description}>{t("settings.prompts.description")}</Text>
        <View style={settingsStyles.card}>
          {settings.userPrompts.length > 0 ? (
            settings.userPrompts.map((prompt, index) => (
              <PromptRow
                key={prompt.id}
                prompt={prompt}
                isFirst={index === 0}
                onEdit={handleEdit}
                onRemove={handleRemove}
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>{t("settings.prompts.empty")}</Text>
            </View>
          )}
        </View>
      </SettingsSection>
      {editState ? (
        <PromptEditSheet
          key={editState.mode === "edit" ? editState.prompt.id : "new"}
          title={sheetTitle}
          initialDraft={editState.draft}
          onClose={handleClose}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[2],
  },
  rowMain: {
    flex: 1,
    paddingVertical: theme.spacing[4],
    paddingRight: theme.spacing[3],
  },
  menuTrigger: {
    width: theme.spacing[8],
    height: theme.spacing[8],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  emptyState: {
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
