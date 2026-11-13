import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { RefreshCw, Save } from "lucide-react-native";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { isViewConflictError, loadSavedView, saveCurrentView, useViewProfileTarget } from "./sync";

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedSave = withUnistyles(Save);
const ThemedRefreshCw = withUnistyles(RefreshCw);
const saveLeading = <ThemedSave size={14} uniProps={mutedMapping} />;
const refreshLeading = <ThemedRefreshCw size={14} uniProps={mutedMapping} />;

type Pending = "save" | "refresh" | null;

/**
 * "Save view" and "Refresh view" at the foot of the Display menu. They appear once a team member
 * is chosen for this device on a host that keeps saved views; the view is that member's.
 */
export function ViewProfileMenuItems(): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const target = useViewProfileTarget();
  const { settings } = useAppSettings();
  const [pending, setPending] = useState<Pending>(null);

  const save = useCallback(() => {
    if (!target) return;
    const { client, serverId, operatorId, memberName } = target;
    const attempt = (overwrite: boolean) =>
      saveCurrentView({ client, serverId, operatorId, display: settings, overwrite });
    setPending("save");
    void (async () => {
      try {
        try {
          await attempt(false);
        } catch (error) {
          if (!isViewConflictError(error)) throw error;
          // Another device saved since this one last loaded: replacing its view is a choice.
          const overwrite = await confirmDialog({
            title: t("sidebar.display.viewProfile.conflict.title"),
            message: t("sidebar.display.viewProfile.conflict.message", { name: memberName }),
            confirmLabel: t("sidebar.display.viewProfile.conflict.confirm"),
            cancelLabel: t("sidebar.display.viewProfile.conflict.cancel"),
            destructive: true,
          });
          if (!overwrite) return;
          await attempt(true);
        }
        toast.show(t("sidebar.display.viewProfile.saved", { name: memberName }), {
          variant: "success",
        });
      } catch {
        toast.error(t("sidebar.display.viewProfile.failed"));
      } finally {
        setPending(null);
      }
    })();
  }, [settings, t, target, toast]);

  const refresh = useCallback(() => {
    if (!target) return;
    setPending("refresh");
    void loadSavedView({
      client: target.client,
      serverId: target.serverId,
      operatorId: target.operatorId,
      force: true,
    })
      .then((outcome) => {
        toast.show(
          outcome === "loaded"
            ? t("sidebar.display.viewProfile.loaded", { name: target.memberName })
            : t("sidebar.display.viewProfile.empty", { name: target.memberName }),
          { variant: outcome === "loaded" ? "success" : "default" },
        );
        return undefined;
      })
      .catch(() => {
        toast.error(t("sidebar.display.viewProfile.failed"));
      })
      .finally(() => setPending(null));
  }, [t, target, toast]);

  if (!target) return null;
  return (
    <>
      <MenuSeparator />
      <MenuItem
        leading={saveLeading}
        status={pending === "save" ? "pending" : "idle"}
        onSelect={save}
        testID="sidebar-display-save-view"
      >
        {t("sidebar.display.viewProfile.save", { name: target.memberName })}
      </MenuItem>
      <MenuItem
        leading={refreshLeading}
        status={pending === "refresh" ? "pending" : "idle"}
        onSelect={refresh}
        testID="sidebar-display-refresh-view"
      >
        {t("sidebar.display.viewProfile.refresh")}
      </MenuItem>
    </>
  );
}
