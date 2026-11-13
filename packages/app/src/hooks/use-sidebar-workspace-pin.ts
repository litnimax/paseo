import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSidebarPinnedFoldersStore } from "@/stores/sidebar-pinned-folders-store";

// Everything the pin toggle actually needs. Kept narrower than SidebarWorkspaceEntry so the
// global keyboard handler can build one from the active route selection without a sidebar row.
export type PinnableWorkspace = Pick<
  SidebarWorkspaceEntry,
  "serverId" | "workspaceId" | "workspaceKey" | "pinnedAt"
>;

/**
 * Where a new pin is filed, instead of the Pinned root: an existing folder, or a top-level folder
 * made for it. Ignored when unpinning.
 */
export type PinFiling = { folderId: string } | { newFolderName: string };

export type ToggleSidebarWorkspacePin = (
  workspace: PinnableWorkspace,
  options?: { filing?: PinFiling },
) => void;

// Module scope, not a per-hook ref: the sidebar row menus and the global keyboard shortcut each
// hold their own controller instance, and a per-instance guard would let a keypress and a menu
// click fire two concurrent, opposite setWorkspacePinned calls for the same workspace.
const pendingWorkspaceKeys = new Set<string>();

export function useSidebarWorkspacePinController(): ToggleSidebarWorkspacePin {
  const { t } = useTranslation();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async ({
      workspace,
      pinned,
      filing,
    }: {
      workspace: PinnableWorkspace;
      pinned: boolean;
      filing: PinFiling | null;
    }) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspacePinned(workspace.workspaceId, pinned);
      // Filing, and making the folder to file into, wait for the host so a rejected pin leaves
      // no trace. A pin arrives in the root unless it was pinned into a folder; the host itself
      // forgets the folder of anything unpinned, from any client.
      const folderId = pinned ? resolveFilingFolderId(filing) : null;
      if (folderId) {
        useSidebarPinnedFoldersStore
          .getState()
          .assignWorkspaceFolder(workspace.workspaceKey, folderId);
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
    onSettled: (_data, _error, { workspace }) => {
      pendingWorkspaceKeys.delete(workspace.workspaceKey);
    },
  });
  const mutate = mutation.mutate;

  return useCallback(
    (workspace: PinnableWorkspace, options?: { filing?: PinFiling }) => {
      if (pendingWorkspaceKeys.has(workspace.workspaceKey)) {
        return;
      }
      pendingWorkspaceKeys.add(workspace.workspaceKey);
      mutate({
        workspace,
        pinned: workspace.pinnedAt == null,
        filing: options?.filing ?? null,
      });
    },
    [mutate],
  );
}

function resolveFilingFolderId(filing: PinFiling | null): string | null {
  if (!filing) return null;
  if ("folderId" in filing) return filing.folderId;
  return useSidebarPinnedFoldersStore
    .getState()
    .createFolder({ name: filing.newFolderName, parentId: null });
}
