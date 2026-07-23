import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import {
  Archive,
  ArrowDownUp,
  Download,
  FileSearch,
  GitCommitHorizontal,
  GitMerge,
  RefreshCcw,
  Upload,
} from "lucide-react-native";
import { GitActionsSplitButton, type SplitButtonExtraItem } from "@/git/actions-split-button";
import { useGitActions } from "@/git/use-actions";
import { useSettings } from "@/hooks/use-settings";
import { resolveReviewPrompt } from "@/review/review-prompt";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import type { Theme } from "@/styles/theme";

interface WorkspaceActionsProps {
  serverId: string;
  cwd: string;
  hideLabels?: boolean;
  /** Agent focused in this workspace; the Review action prefills its composer. */
  focusedAgentId?: string | null;
}

const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
const ThemedDownload = withUnistyles(Download);
const ThemedUpload = withUnistyles(Upload);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);
const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedArchive = withUnistyles(Archive);
const ThemedFileSearch = withUnistyles(FileSearch);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ICONS = {
  commit: <ThemedGitCommitHorizontal size={16} uniProps={mutedColorMapping} />,
  pull: <ThemedDownload size={16} uniProps={mutedColorMapping} />,
  push: <ThemedUpload size={16} uniProps={mutedColorMapping} />,
  pullAndPush: <ThemedArrowDownUp size={16} uniProps={mutedColorMapping} />,
  merge: <ThemedGitMerge size={16} uniProps={mutedColorMapping} />,
  mergeFromBase: <ThemedRefreshCcw size={16} uniProps={mutedColorMapping} />,
  archive: <ThemedArchive size={16} uniProps={mutedColorMapping} />,
};

const REVIEW_ICON = <ThemedFileSearch size={16} uniProps={mutedColorMapping} />;

export function WorkspaceActions({
  serverId,
  cwd,
  hideLabels,
  focusedAgentId,
}: WorkspaceActionsProps) {
  const { t } = useTranslation();
  const { gitActions } = useGitActions({
    serverId,
    cwd,
    icons: ICONS,
  });

  const reviewPrompt = useSettings((settings) => settings.reviewPrompt);

  const handleReview = useCallback(async () => {
    if (!focusedAgentId) {
      return;
    }
    const promptText = resolveReviewPrompt(reviewPrompt);
    const draftKey = buildDraftStoreKey({ serverId, agentId: focusedAgentId });
    const store = useDraftStore.getState();
    // Ensure any unsent draft is loaded before we append, so we never clobber it.
    await store.hydrateDraftInput({ draftKey });
    const current = store.getDraftInput(draftKey) ?? { text: "", attachments: [] };
    const existing = current.text.replace(/\s+$/, "");
    const nextText = existing.length > 0 ? `${existing}\n\n${promptText}` : promptText;
    store.saveDraftInput({
      draftKey,
      draft: { text: nextText, attachments: current.attachments },
    });
  }, [focusedAgentId, reviewPrompt, serverId]);

  const extraItems = useMemo<SplitButtonExtraItem[]>(
    () => [
      {
        key: "review",
        label: t("workspace.git.actions.review.label"),
        icon: REVIEW_ICON,
        // Keep the item clickable when there's no focused agent so selecting it
        // surfaces the explanatory toast (disabled items don't fire onSelect).
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

  return (
    <GitActionsSplitButton
      gitActions={gitActions}
      hideLabels={hideLabels}
      extraItems={extraItems}
    />
  );
}
