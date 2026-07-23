import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileSearch } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { SplitButtonExtraItem } from "@/git/actions-split-button";
import { useSettings } from "@/hooks/use-settings";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import type { Theme } from "@/styles/theme";
import { resolveReviewPrompt } from "./review-prompt";

const ThemedFileSearch = withUnistyles(FileSearch);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const REVIEW_ICON = <ThemedFileSearch size={16} uniProps={mutedColorMapping} />;

export function useReviewActionItems({
  serverId,
  focusedAgentId,
}: {
  serverId: string;
  focusedAgentId: string | null;
}): SplitButtonExtraItem[] {
  const { t } = useTranslation();
  const reviewPrompt = useSettings((settings) => settings.reviewPrompt);

  const handleReview = useCallback(async () => {
    if (!focusedAgentId) {
      return;
    }
    const promptText = resolveReviewPrompt(reviewPrompt);
    const draftKey = buildDraftStoreKey({ serverId, agentId: focusedAgentId });
    const store = useDraftStore.getState();
    await store.hydrateDraftInput({ draftKey });
    const current = store.getDraftInput(draftKey) ?? { text: "", attachments: [] };
    const existing = current.text.replace(/\s+$/, "");
    const nextText = existing.length > 0 ? `${existing}\n\n${promptText}` : promptText;
    store.saveDraftInput({
      draftKey,
      draft: { text: nextText, attachments: current.attachments },
    });
  }, [focusedAgentId, reviewPrompt, serverId]);

  return useMemo(
    () => [
      {
        key: "review",
        label: t("workspace.git.actions.review.label"),
        icon: REVIEW_ICON,
        unavailableMessage: focusedAgentId
          ? undefined
          : t("workspace.git.actions.review.unavailable"),
        testID: "changes-menu-review",
        onSelect: () => {
          void handleReview();
        },
      },
    ],
    [focusedAgentId, handleReview, t],
  );
}
