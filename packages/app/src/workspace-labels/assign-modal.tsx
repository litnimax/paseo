import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import {
  workspaceLabelKey,
  type WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import {
  normalizeCurrentBranch,
  projectNameForWorkspace,
} from "@/hooks/sidebar-workspaces-view-model";
import { useAppSettings, type WorkspaceTitleSource } from "@/hooks/use-settings";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useServerWorkspaceFields } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import {
  createWorkspaceLabelBulkAssignModel,
  useWorkspaceLabelProjection,
  workspaceLabels,
  type WorkspaceLabelBulkRow,
  type WorkspaceLabelBulkWorkspace,
} from "@/workspace-labels";
import { WorkspaceLabelDot } from "./swatch";

const ThemedCheck = withUnistyles(Check);
const checkedIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

interface WorkspaceLabelAssignTarget {
  serverId: string;
  label: WorkspaceLabelDefinition;
}

/**
 * Which label the dialog is assigning, if any. A store rather than a prop because the dialog is
 * opened from a label's own menu, and that menu unmounts the moment its item is chosen.
 */
const useWorkspaceLabelAssignDialog = create<{ target: WorkspaceLabelAssignTarget | null }>(() => ({
  target: null,
}));

export function openWorkspaceLabelAssignDialog(target: WorkspaceLabelAssignTarget): void {
  useWorkspaceLabelAssignDialog.setState({ target });
}

function closeWorkspaceLabelAssignDialog(): void {
  useWorkspaceLabelAssignDialog.setState({ target: null });
}

/** Mounted once at the app root, so any label menu can hand off to it. */
export function WorkspaceLabelAssignHost(): ReactElement | null {
  const target = useWorkspaceLabelAssignDialog((state) => state.target);
  if (!target) return null;
  return (
    <WorkspaceLabelAssignModal
      key={`${target.serverId}:${workspaceLabelKey(target.label.name)}`}
      target={target}
      onClose={closeWorkspaceLabelAssignDialog}
    />
  );
}

/** What the dialog reads of a workspace, and nothing that ticks while an agent runs. */
interface BulkWorkspaceSource {
  workspaceId: string;
  name: string;
  currentBranch: string | null;
  projectName: string;
  labels: readonly string[];
}

const NO_LABELS: readonly string[] = [];

/**
 * Background workspaces stay out: the sidebar does not show them, so a label put on one would be
 * a label nobody sees. Neither does a workspace on its way out.
 */
function projectBulkWorkspaceSource(workspace: WorkspaceDescriptor): BulkWorkspaceSource | null {
  if (workspace.background || workspace.archivingAt) return null;
  return {
    workspaceId: workspace.id,
    name: workspace.name,
    currentBranch: normalizeCurrentBranch(workspace.gitRuntime?.currentBranch),
    projectName: projectNameForWorkspace(workspace),
    labels: workspace.labels ?? NO_LABELS,
  };
}

/**
 * One label across every workspace on its host. Ticks are a draft; Apply sends them, so ticking
 * twenty rows is twenty taps and one round of requests rather than twenty separate saves.
 */
function WorkspaceLabelAssignModal({
  target,
  onClose,
}: {
  target: WorkspaceLabelAssignTarget;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { serverId, label } = target;
  const { targetHost: host } = useWorkspaceLabelProjection(serverId);
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const sources = useServerWorkspaceFields(serverId, projectBulkWorkspaceSource);
  const workspaces = useMemo(
    () => buildBulkWorkspaces({ sources, labelName: label.name, workspaceTitleSource }),
    [label.name, sources, workspaceTitleSource],
  );
  // Seeded on creation, so the first frame already has the rows rather than the empty state.
  const [model] = useState(() => {
    const created = createWorkspaceLabelBulkAssignModel({
      mutate: ({ workspaceId, assigned }) =>
        workspaceLabels.setAssignment({ serverId, workspaceId, label, assigned }),
    });
    created.sync(workspaces);
    return created;
  });
  useEffect(() => model.sync(workspaces), [model, workspaces]);
  const state = useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
  const offline = host?.status !== "online";
  const disabled = offline || state.pending;

  const setQuery = useCallback((value: string) => model.setQuery(value), [model]);
  const toggle = useCallback((workspaceId: string) => model.toggle(workspaceId), [model]);
  const allVisibleSelected =
    state.visibleRows.length > 0 && state.visibleRows.every((row) => row.selected);
  const toggleVisible = useCallback(
    () => model.setVisible(!allVisibleSelected),
    [allVisibleSelected, model],
  );
  const apply = useCallback(() => {
    void (async () => {
      if (await model.apply()) onClose();
    })();
  }, [model, onClose]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("workspaceLabels.assign.title", { name: label.name }),
      leading: <WorkspaceLabelDot color={label.color} />,
      search: {
        onChange: setQuery,
        placeholder: t("workspaceLabels.assign.search"),
        testID: "workspace-label-assign-search",
      },
    }),
    [label.color, label.name, setQuery, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="outline"
          disabled={disabled || state.visibleRows.length === 0}
          onPress={toggleVisible}
          testID="workspace-label-assign-toggle-all"
        >
          {allVisibleSelected
            ? t("workspaceLabels.assign.clear")
            : t("workspaceLabels.assign.selectAll")}
        </Button>
        <Button
          style={styles.applyButton}
          disabled={disabled || state.changes === 0}
          loading={state.pending}
          onPress={apply}
          testID="workspace-label-assign-apply"
        >
          {state.changes > 0
            ? t("workspaceLabels.assign.applyCount", { changes: state.changes })
            : t("workspaceLabels.assign.apply")}
        </Button>
      </View>
    ),
    [
      allVisibleSelected,
      apply,
      disabled,
      state.changes,
      state.pending,
      state.visibleRows.length,
      t,
      toggleVisible,
    ],
  );

  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={header}
      footer={footer}
      testID="workspace-label-assign"
    >
      <View style={styles.list}>
        {state.visibleRows.map((row) => (
          <WorkspaceLabelAssignRow
            key={row.workspaceId}
            row={row}
            disabled={disabled}
            onToggle={toggle}
          />
        ))}
      </View>
      {state.rows.length === 0 ? (
        <Text style={styles.muted}>{t("workspaceLabels.assign.empty")}</Text>
      ) : null}
      {state.rows.length > 0 && state.visibleRows.length === 0 ? (
        <Text style={styles.muted}>{t("workspaceLabels.assign.noMatches")}</Text>
      ) : null}
      {offline ? <Text style={styles.muted}>{t("workspaceLabels.manage.offline")}</Text> : null}
      {state.error ? (
        <Text style={styles.error} testID="workspace-label-assign-error">
          {state.error}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

/**
 * The rows, named the way the sidebar names them — by branch when that is the user's setting —
 * and grouped by project as the sidebar groups them.
 */
function buildBulkWorkspaces(input: {
  sources: readonly BulkWorkspaceSource[];
  labelName: string;
  workspaceTitleSource: WorkspaceTitleSource;
}): WorkspaceLabelBulkWorkspace[] {
  const key = workspaceLabelKey(input.labelName);
  const rows = input.sources.map((source) => ({
    workspaceId: source.workspaceId,
    name: resolveSidebarWorkspacePrimaryLabel({
      workspace: source,
      workspaceTitleSource: input.workspaceTitleSource,
    }),
    projectName: source.projectName,
    assigned: source.labels.some((name) => workspaceLabelKey(name) === key),
  }));
  return rows.sort(
    (a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name),
  );
}

function WorkspaceLabelAssignRow({
  row,
  disabled,
  onToggle,
}: {
  row: WorkspaceLabelBulkRow;
  disabled: boolean;
  onToggle: (workspaceId: string) => void;
}): ReactElement {
  const toggle = useCallback(() => onToggle(row.workspaceId), [onToggle, row.workspaceId]);
  const accessibilityState = useMemo(
    () => ({ checked: row.selected, disabled }),
    [disabled, row.selected],
  );
  return (
    <PressHighlight
      style={styles.row}
      onPress={toggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={`${row.projectName}, ${row.name}`}
      accessibilityState={accessibilityState}
      aria-checked={row.selected}
      testID={`workspace-label-assign-row-${row.workspaceId}`}
    >
      <View style={row.selected ? styles.checkboxChecked : styles.checkbox}>
        {row.selected ? <ThemedCheck size={14} uniProps={checkedIconMapping} /> : null}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.rowProject} numberOfLines={1}>
          {row.projectName}
        </Text>
      </View>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowProject: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  applyButton: {
    minWidth: 112,
  },
}));
