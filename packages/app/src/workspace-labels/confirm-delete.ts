import { i18n } from "@/i18n/i18next";
import { confirmDialog } from "@/utils/confirm-dialog";

/** The one question every surface asks before deleting a label, with the host's count in it. */
export function confirmWorkspaceLabelDelete(input: {
  name: string;
  affectedWorkspaceCount: number;
}): Promise<boolean> {
  return confirmDialog({
    title: i18n.t("workspaceLabels.manage.deleteTitle", { name: input.name }),
    message: i18n.t("workspaceLabels.manage.deleteMessage", {
      count: input.affectedWorkspaceCount,
    }),
    confirmLabel: i18n.t("workspaceLabels.manage.delete"),
    // Red belongs to the confirm dialog, not to the surface that opens it — docs/design.md.
    destructive: true,
  });
}
