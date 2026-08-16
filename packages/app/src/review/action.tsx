import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileSearch } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { SplitButtonExtraItem } from "@/git/actions-split-button";
import type { DropdownMenuItemSelectEvent } from "@/components/ui/dropdown-menu";
import { useSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { resolveReviewPrompt } from "./review-prompt";
import { openReviewChat } from "./open-review-chat";

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

  const handleReview = useCallback(
    (event: DropdownMenuItemSelectEvent) => {
      openReviewChat({
        serverId,
        workspaceId,
        cwd,
        text: resolveReviewPrompt(reviewPrompt),
        provider: reviewModelProvider,
        model: reviewModelId,
        event,
        shortcutOs: getShortcutOs(),
      });
    },
    [cwd, reviewModelId, reviewModelProvider, reviewPrompt, serverId, workspaceId],
  );

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
