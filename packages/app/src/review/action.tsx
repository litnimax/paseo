import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileSearch } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { SplitButtonExtraItem } from "@/git/actions-split-button";
import { useSettings } from "@/hooks/use-settings";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
} from "@/workspace-tabs/model";
import { resolveReviewPrompt } from "./review-prompt";

const ThemedFileSearch = withUnistyles(FileSearch);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const REVIEW_ICON = <ThemedFileSearch size={16} uniProps={mutedColorMapping} />;

export function useReviewActionItems({
  serverId,
  workspaceId,
  cwd,
}: {
  serverId: string;
  workspaceId: string | null | undefined;
  cwd: string;
}): SplitButtonExtraItem[] {
  const { t } = useTranslation();
  const reviewPrompt = useSettings((settings) => settings.reviewPrompt);
  const reviewModelProvider = useSettings((settings) => settings.reviewModelProvider);
  const reviewModelId = useSettings((settings) => settings.reviewModelId);

  const handleReview = useCallback(() => {
    const draftId = generateDraftId();
    const provider = reviewModelProvider.trim();
    const setup: WorkspaceDraftTabSetup | undefined = provider
      ? {
          provider,
          cwd,
          model: reviewModelId.trim() || null,
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        }
      : undefined;
    useDraftStore.getState().saveDraftInput({
      draftKey: buildDraftStoreKey({ serverId, agentId: draftId, draftId }),
      draft: { text: resolveReviewPrompt(reviewPrompt), attachments: [] },
    });

    const target = normalizeWorkspaceTabTarget({ kind: "draft", draftId, setup });
    if (!target) {
      return;
    }
    const persistenceKey = buildWorkspaceTabPersistenceKey({
      serverId,
      workspaceId: workspaceId ?? cwd,
    });
    if (!persistenceKey) {
      return;
    }
    useWorkspaceLayoutStore.getState().openTabFocused(persistenceKey, target);
  }, [cwd, reviewModelId, reviewModelProvider, reviewPrompt, serverId, workspaceId]);

  return useMemo(
    () => [
      {
        key: "review",
        label: t("workspace.git.actions.review.label"),
        icon: REVIEW_ICON,
        testID: "changes-menu-review",
        onSelect: handleReview,
      },
    ],
    [handleReview, t],
  );
}
