import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileSearch } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { SplitButtonExtraItem } from "@/git/actions-split-button";
import { useSettings } from "@/hooks/use-settings";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceDraftTabSetup } from "@/stores/workspace-tabs-store";
import type { Theme } from "@/styles/theme";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";
import { resolveReviewPrompt } from "./review-prompt";

const ThemedFileSearch = withUnistyles(FileSearch);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const REVIEW_ICON = <ThemedFileSearch size={16} uniProps={mutedColorMapping} />;

/**
 * The Review action opens a fresh, clean chat (a new agent draft) in the current
 * workspace, prefilled with the review prompt and — when a review model is set in
 * Settings — seeded to that provider/model. It deliberately does NOT reuse the
 * focused agent so the review runs from a clean context with its own model.
 */
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
    const promptText = resolveReviewPrompt(reviewPrompt);
    const draftId = generateDraftId();
    const provider = reviewModelProvider.trim();
    // Only seed a setup when a review provider is configured; otherwise the new
    // chat inherits the user's default provider/model. An unavailable provider or
    // model is resolved away by the draft form's own validation.
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

    // Seed the new draft's composer text before opening it; hydrateDraftInput keeps
    // an existing active draft record intact, so this is picked up on mount.
    useDraftStore.getState().saveDraftInput({
      draftKey: buildDraftStoreKey({ serverId, agentId: draftId, draftId }),
      draft: { text: promptText, attachments: [] },
    });

    const target = normalizeWorkspaceTabTarget({ kind: "draft", draftId, setup });
    if (!target || target.kind !== "draft") {
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
