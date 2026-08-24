import { GitActionsSplitButton } from "@/git/actions-split-button";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useGitActions } from "@/git/use-actions";
import { useReviewActionItems } from "@/review";

interface WorkspaceActionsProps {
  serverId: string;
  cwd: string;
  workspaceId: string | null;
}

export function WorkspaceActions({ serverId, cwd, workspaceId }: WorkspaceActionsProps) {
  const { gitActions } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });
  const extraItems = useReviewActionItems({ serverId, workspaceId, cwd });

  return <GitActionsSplitButton gitActions={gitActions} extraItems={extraItems} />;
}
