import { GitActionsSplitButton } from "@/git/actions-split-button";
import { useGitActions } from "@/git/use-actions";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useReviewActionItems } from "@/review";

interface WorkspaceActionsProps {
  serverId: string;
  cwd: string;
  hideLabels?: boolean;
  workspaceId: string | null;
}

export function WorkspaceActions({
  serverId,
  cwd,
  hideLabels,
  workspaceId,
}: WorkspaceActionsProps) {
  const { gitActions } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });
  const extraItems = useReviewActionItems({ serverId, workspaceId, cwd });

  return (
    <GitActionsSplitButton
      gitActions={gitActions}
      hideLabels={hideLabels}
      extraItems={extraItems}
    />
  );
}
