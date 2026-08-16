import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  MAX_USER_PROMPT_NAME_LENGTH,
  MAX_USER_PROMPT_TEXT_LENGTH,
  type UserPrompt,
} from "@/hooks/use-settings";

export type UserPromptDraft = Pick<UserPrompt, "name" | "prompt">;

interface PromptEditSheetProps {
  title: string;
  initialDraft: UserPromptDraft;
  onClose: () => void;
  onSave: (draft: UserPromptDraft) => Promise<void>;
}

export function PromptEditSheet({ title, initialDraft, onClose, onSave }: PromptEditSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialDraft.name);
  const [prompt, setPrompt] = useState(initialDraft.prompt);
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const sheetHeader = useMemo<SheetHeader>(() => ({ title }), [title]);
  const nameError = showErrors && !name.trim() ? t("settings.prompts.form.nameRequired") : null;
  const promptError =
    showErrors && !prompt.trim() ? t("settings.prompts.form.promptRequired") : null;

  const handleSave = useCallback(async () => {
    if (isPending) return;
    if (!name.trim() || !prompt.trim()) {
      setShowErrors(true);
      return;
    }
    setSubmitError(null);
    setIsPending(true);
    try {
      await onSave({ name: name.trim(), prompt: prompt.trim() });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("common.errors.unableToSave"));
    } finally {
      setIsPending(false);
    }
  }, [isPending, name, onClose, onSave, prompt, t]);

  const handleCancel = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);

  return (
    <AdaptiveModalSheet
      visible
      header={sheetHeader}
      onClose={handleCancel}
      testID="prompt-edit-sheet"
      desktopMaxWidth={520}
    >
      <View style={styles.body}>
        <Field label={t("settings.prompts.form.nameLabel")} error={nameError}>
          <FormTextInput
            initialValue={initialDraft.name}
            onChangeText={setName}
            maxLength={MAX_USER_PROMPT_NAME_LENGTH}
            editable={!isPending}
            autoFocus
            accessibilityLabel={t("settings.prompts.form.nameLabel")}
            testID="prompt-name-input"
          />
        </Field>
        <Field label={t("settings.prompts.form.promptLabel")} error={promptError}>
          <FormTextInput
            initialValue={initialDraft.prompt}
            onChangeText={setPrompt}
            maxLength={MAX_USER_PROMPT_TEXT_LENGTH}
            editable={!isPending}
            multiline
            textAlignVertical="top"
            style={styles.promptInput}
            accessibilityLabel={t("settings.prompts.form.promptLabel")}
            testID="prompt-text-input"
          />
        </Field>
        {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
        <View style={styles.actions}>
          <Button
            variant="secondary"
            style={styles.actionButton}
            onPress={handleCancel}
            disabled={isPending}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            style={styles.actionButton}
            onPress={handleSave}
            loading={isPending}
            testID="prompt-save-button"
          >
            {t("settings.prompts.actions.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  promptInput: {
    minHeight: 180,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
  submitError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
