import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type RefObject,
} from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react-native";
import {
  normalizeWorkspaceLabelName,
  workspaceLabelKey,
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
  type WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";
import {
  MenuHint,
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  MenuTextField,
  isSubPageOpen,
  menuRowContentInset,
  useMenuContext,
  useMenuDepth,
  useMenuSurface,
  type MenuItemContextAction,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-api-context";
import {
  createWorkspaceLabelPickerModel,
  deleteWorkspaceLabelAfterConfirm,
  useWorkspaceLabelProjection,
  useWorkspaceLabels,
  workspaceLabelErrorMessage,
  workspaceLabelUpdateFromDraft,
  workspaceLabels,
  type WorkspaceLabelPickerRow,
} from "@/workspace-labels";
import type { Theme } from "@/styles/theme";
import { openWorkspaceLabelAssignDialog } from "./assign-modal";
import { confirmWorkspaceLabelDelete } from "./confirm-delete";
import { WorkspaceLabelDot, WorkspaceLabelSwatchRow } from "./swatch";

/** The `MenuSubTrigger` on a workspace's menu that opens the assign page. */
export const WORKSPACE_LABEL_PAGE_ID = "workspaceLabels";
const WORKSPACE_LABEL_CREATE_PAGE_ID = "workspaceLabelsCreate";
const WORKSPACE_LABEL_ACTIONS_PAGE_ID = "workspaceLabelsActions";
const WORKSPACE_LABEL_EDIT_PAGE_ID = "workspaceLabelsEdit";

/** The menu's own icon size, matching the trailing check on every other row. */
const MENU_ICON_SIZE = 14;

const ThemedPlus = withUnistyles(Plus);
const ThemedPencil = withUnistyles(Pencil);
const ThemedListChecks = withUnistyles(ListChecks);
const ThemedTrash = withUnistyles(Trash2);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// The create row keeps the leading column the label rows above it sit in. Without a mark there
// its label would start on the text rail while every label starts 24pt further in, and the last
// row of the page would read as one that slipped out of the list.
const CREATE_LEADING = <ThemedPlus size={MENU_ICON_SIZE} uniProps={mutedMapping} />;
const EDIT_LEADING = <ThemedPencil size={MENU_ICON_SIZE} uniProps={mutedMapping} />;
const ASSIGN_LEADING = <ThemedListChecks size={MENU_ICON_SIZE} uniProps={mutedMapping} />;
const DELETE_LEADING = <ThemedTrash size={MENU_ICON_SIZE} uniProps={mutedMapping} />;

/** The colour a new label takes until you say otherwise. */
const DEFAULT_CREATE_COLOR: WorkspaceLabelColor = WORKSPACE_LABEL_COLORS[0];

export interface WorkspaceLabelTarget {
  serverId: string;
  workspaceId: string;
  /** Label names the workspace already carries, from the sidebar entry. */
  labels: readonly string[];
}

/** The label a right click or long press opened the actions page on, and the row it came from. */
interface WorkspaceLabelActionTarget {
  /**
   * A name rather than a definition. The pages read the label from the host's catalog on every
   * render, so a rename, recolour or delete made elsewhere reaches a page that is already open.
   */
  name: string;
  anchorRef: RefObject<View | null>;
}

const NO_PAGES: readonly MenuPageDefinition[] = [];

/**
 * The pages behind a workspace's `Labels` row, for whichever menu is asking.
 *
 * Both the kebab dropdown and the row's context menu open the same thing, and a page defined
 * twice is a page that will be improved once.
 *
 * A label row toggles on press, so the label's own actions — edit, assign in bulk, delete — are
 * the row's context action and open as one more page beside that row.
 */
export function useWorkspaceLabelMenuPages(
  target: WorkspaceLabelTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  const toast = useToast();
  const [actionTarget, setActionTarget] = useState<WorkspaceLabelActionTarget | null>(null);
  const serverId = target?.serverId ?? null;
  const hostLabels = useWorkspaceLabels((state) =>
    serverId ? state.hosts[serverId]?.labels : undefined,
  );
  // Resolved against the workspace's own host, the only one these actions can reach. Once that
  // host no longer holds the name — deleted, or renamed from elsewhere — the pages go, and the
  // menu prunes them if they were open.
  const actionLabel = useMemo(() => {
    if (!actionTarget || !hostLabels) return null;
    const key = workspaceLabelKey(actionTarget.name);
    return hostLabels.find((label) => workspaceLabelKey(label.name) === key) ?? null;
  }, [actionTarget, hostLabels]);
  // The menu closes before this runs, so a failure has nowhere to land but a toast.
  const deleteLabel = useCallback(
    (label: WorkspaceLabelDefinition) => {
      if (!serverId) return;
      void deleteWorkspaceLabelAfterConfirm({
        target: { serverId, name: label.name },
        dependencies: workspaceLabels,
        confirm: (affectedWorkspaceCount) =>
          confirmWorkspaceLabelDelete({ name: label.name, affectedWorkspaceCount }),
      }).catch((cause: unknown) => toast.error(workspaceLabelErrorMessage(cause)));
    },
    [serverId, toast],
  );
  return useMemo(() => {
    if (!target) return NO_PAGES;
    const pages: MenuPageDefinition[] = [
      {
        id: WORKSPACE_LABEL_PAGE_ID,
        title: t("workspaceLabels.title"),
        content: (
          <WorkspaceLabelPickerPage
            serverId={target.serverId}
            workspaceId={target.workspaceId}
            assignedLabels={target.labels}
            onOpenActions={setActionTarget}
          />
        ),
      },
      {
        id: WORKSPACE_LABEL_CREATE_PAGE_ID,
        title: t("workspaceLabels.create"),
        // A page you type into is not one the pointer opens or dismisses on its own.
        hoverIntent: false,
        content: (
          <WorkspaceLabelCreatePage serverId={target.serverId} workspaceId={target.workspaceId} />
        ),
      },
    ];
    if (actionTarget && actionLabel) {
      pages.push(
        {
          id: WORKSPACE_LABEL_ACTIONS_PAGE_ID,
          title: actionLabel.name,
          content: (
            <WorkspaceLabelActionsPage
              serverId={target.serverId}
              label={actionLabel}
              anchorRef={actionTarget.anchorRef}
              onDelete={deleteLabel}
            />
          ),
        },
        {
          id: WORKSPACE_LABEL_EDIT_PAGE_ID,
          title: t("workspaceLabels.manage.edit"),
          hoverIntent: false,
          content: <WorkspaceLabelEditPage serverId={target.serverId} label={actionLabel} />,
        },
      );
    }
    return pages;
  }, [actionLabel, actionTarget, deleteLabel, t, target]);
}

/**
 * Every label on the host, with the ones this workspace carries ticked.
 *
 * Assigning is multi-select, so a press toggles and nothing closes; the menu ends when it is
 * dismissed. Assignment is the trailing check `MenuItem` already draws for a chosen row, and the
 * colour goes in the leading slot, which puts both on the rails every other row in the menu uses.
 */
function WorkspaceLabelPickerPage({
  serverId,
  workspaceId,
  assignedLabels,
  onOpenActions,
}: {
  serverId: string;
  workspaceId: string;
  assignedLabels: readonly string[];
  onOpenActions: (target: WorkspaceLabelActionTarget) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { labels, targetHost: host } = useWorkspaceLabelProjection(serverId);
  const model = useMemo(
    () =>
      createWorkspaceLabelPickerModel({
        mutate: ({ label, assigned }) =>
          workspaceLabels.setAssignment({ serverId, workspaceId, label, assigned }),
      }),
    [serverId, workspaceId],
  );
  useEffect(() => {
    model.sync({ labels, assigned: assignedLabels, online: host?.status === "online" });
  }, [assignedLabels, host?.status, labels, model]);
  const snapshot = useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
  const offline = !snapshot.online;
  const error = snapshot.error ?? (host?.error ? t("workspaceLabels.errors.load") : null);
  const pending = useMemo(() => new Set(snapshot.pendingNames), [snapshot.pendingNames]);
  // The list merges every online host's catalog, but a label's own actions can only reach this
  // workspace's host, so only the labels that host holds offer them.
  const hostKeys = useMemo(
    () => new Set((host?.labels ?? []).map((label) => workspaceLabelKey(label.name))),
    [host?.labels],
  );
  const toggle = useCallback(
    (label: WorkspaceLabelDefinition, assigned: boolean) => {
      void model.toggle(label, assigned);
    },
    [model],
  );

  return (
    <>
      {snapshot.rows.map((row) => (
        <WorkspaceLabelAssignRow
          key={row.name.toLocaleLowerCase()}
          row={row}
          offline={offline}
          pending={pending.has(row.name.toLocaleLowerCase())}
          ownedByHost={hostKeys.has(workspaceLabelKey(row.name))}
          onToggle={toggle}
          onOpenActions={onOpenActions}
        />
      ))}
      {snapshot.rows.length > 0 ? <MenuSeparator /> : null}
      <MenuSubTrigger
        id={WORKSPACE_LABEL_CREATE_PAGE_ID}
        leading={CREATE_LEADING}
        disabled={offline}
        testID="workspace-label-picker-create"
      >
        {t("workspaceLabels.create")}
      </MenuSubTrigger>
      {error ? <MenuHint testID="workspace-label-picker-error">{error}</MenuHint> : null}
      {host?.status === "unsupported" ? (
        <MenuHint>{t("workspaceLabels.updateHostUse")}</MenuHint>
      ) : null}
    </>
  );
}

function WorkspaceLabelAssignRow({
  row,
  offline,
  pending,
  ownedByHost,
  onToggle,
  onOpenActions,
}: {
  row: WorkspaceLabelPickerRow;
  offline: boolean;
  pending: boolean;
  ownedByHost: boolean;
  onToggle: (label: WorkspaceLabelDefinition, assigned: boolean) => void;
  onOpenActions: (target: WorkspaceLabelActionTarget) => void;
}): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("WorkspaceLabelAssignRow");
  const depth = useMenuDepth();
  const { registerSubAnchor } = useMenuSurface("WorkspaceLabelAssignRow");
  const anchorRef = useRef<View>(null);
  const leading = useMemo(() => <WorkspaceLabelDot color={row.color} />, [row.color]);
  const select = useCallback(() => {
    // Toggling a label steps away from the label whose actions are open, but not from a label
    // being created: that page holds a draft, and closing it would throw the typing away.
    const actionsOpen =
      isSubPageOpen(menu.path, { id: WORKSPACE_LABEL_ACTIONS_PAGE_ID, depth }) ||
      isSubPageOpen(menu.path, { id: WORKSPACE_LABEL_EDIT_PAGE_ID, depth });
    if (actionsOpen) menu.closeSub(depth);
    onToggle({ name: row.name, color: row.color }, !row.assigned);
  }, [depth, menu, onToggle, row.assigned, row.color, row.name]);
  const contextAction = useMemo<MenuItemContextAction | undefined>(() => {
    if (!ownedByHost) return undefined;
    return {
      label: t("workspaceLabels.actions.open", { name: row.name }),
      onTrigger: () => {
        onOpenActions({ name: row.name, anchorRef });
        registerSubAnchor(WORKSPACE_LABEL_ACTIONS_PAGE_ID, anchorRef);
        menu.openSub({ id: WORKSPACE_LABEL_ACTIONS_PAGE_ID, depth });
      },
    };
  }, [depth, menu, onOpenActions, ownedByHost, registerSubAnchor, row.name, t]);
  return (
    // The row is the anchor its actions open beside, the way a submenu trigger is its flyout's.
    <View ref={anchorRef} collapsable={false}>
      <MenuItem
        leading={leading}
        selected={row.assigned}
        disabled={offline}
        status={pending ? "pending" : "idle"}
        closeOnSelect={false}
        onSelect={select}
        contextAction={contextAction}
        testID={`workspace-label-picker-row-${row.name}`}
      >
        {row.name}
      </MenuItem>
    </View>
  );
}

/**
 * What you can do to a label itself, as opposed to this workspace's tick on it.
 *
 * Edit replaces this page beside the same row rather than nesting under it, so the form opens
 * where the label is and Back returns to the list the label is in.
 */
function WorkspaceLabelActionsPage({
  serverId,
  label,
  anchorRef,
  onDelete,
}: {
  serverId: string;
  label: WorkspaceLabelDefinition;
  anchorRef: RefObject<View | null>;
  onDelete: (label: WorkspaceLabelDefinition) => void;
}): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("WorkspaceLabelActionsPage");
  const depth = useMenuDepth();
  const { registerSubAnchor } = useMenuSurface("WorkspaceLabelActionsPage");
  const edit = useCallback(() => {
    registerSubAnchor(WORKSPACE_LABEL_EDIT_PAGE_ID, anchorRef);
    menu.openSub({ id: WORKSPACE_LABEL_EDIT_PAGE_ID, depth: depth - 1 });
  }, [anchorRef, depth, menu, registerSubAnchor]);
  const assign = useCallback(
    () => openWorkspaceLabelAssignDialog({ serverId, label }),
    [label, serverId],
  );
  const remove = useCallback(() => onDelete(label), [label, onDelete]);
  return (
    <>
      <MenuItem
        leading={EDIT_LEADING}
        closeOnSelect={false}
        onSelect={edit}
        testID="workspace-label-actions-edit"
      >
        {t("workspaceLabels.actions.edit")}
      </MenuItem>
      <MenuItem leading={ASSIGN_LEADING} onSelect={assign} testID="workspace-label-actions-assign">
        {t("workspaceLabels.actions.assign")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem leading={DELETE_LEADING} onSelect={remove} testID="workspace-label-actions-delete">
        {t("workspaceLabels.actions.delete")}
      </MenuItem>
    </>
  );
}

/**
 * Renaming and recolouring a label in place, the create page's shape with the label's values in
 * it. Save sends one update and is enabled by the same rule as the manager's; a failure keeps the
 * draft, as creating does.
 *
 * `label` is the host's current definition, so a change made elsewhere while this is open is what
 * the draft is compared against and what the update targets.
 */
function WorkspaceLabelEditPage({
  serverId,
  label,
}: {
  serverId: string;
  label: WorkspaceLabelDefinition;
}): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("WorkspaceLabelEditPage");
  const depth = useMenuDepth();
  const { targetHost: host } = useWorkspaceLabelProjection(serverId);
  const [initialName] = useState(label.name);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<WorkspaceLabelColor>(label.color);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = host?.status !== "online";
  const update = workspaceLabelUpdateFromDraft(label, { name, color });

  const submit = useCallback(() => {
    if (!update || pending) return;
    setPending(true);
    setError(null);
    workspaceLabels
      .update({ serverId, name: label.name, ...update })
      // Closes this page by its place in the path rather than popping one: a rename can reach
      // the catalog before the reply does, and the menu prunes the page under the old name first.
      .then(() => menu.closeSub(depth - 1))
      .catch((cause: unknown) => setError(workspaceLabelErrorMessage(cause)))
      .finally(() => setPending(false));
  }, [depth, label.name, menu, pending, serverId, update]);

  return (
    <>
      <MenuTextField
        initialValue={initialName}
        onChangeText={setName}
        placeholder={t("workspaceLabels.name")}
        autoFocus
        editable={!offline && !pending}
        onSubmitEditing={submit}
        testID="workspace-label-picker-edit-name"
      />
      <View style={styles.swatches}>
        <WorkspaceLabelSwatchRow
          value={color}
          onChange={setColor}
          disabled={offline || pending}
          testID="workspace-label-picker-edit-colors"
        />
      </View>
      <MenuSeparator />
      <MenuItem
        disabled={offline || !update}
        status={pending ? "pending" : "idle"}
        pendingLabel={t("workspaceLabels.actions.saving")}
        closeOnSelect={false}
        onSelect={submit}
        testID="workspace-label-picker-edit-submit"
      >
        {t("workspaceLabels.manage.save")}
      </MenuItem>
      {error ? <MenuHint testID="workspace-label-picker-error">{error}</MenuHint> : null}
    </>
  );
}

/**
 * Naming a new label and giving it a colour, in place of the list rather than under it.
 *
 * Picking a colour picks a colour: the label is created by the one row that says so, and only
 * once the name is not empty. A failure keeps the draft and says what happened, because the
 * alternative is retyping the name to find out whether the host is still there.
 */
function WorkspaceLabelCreatePage({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("WorkspaceLabelCreatePage");
  const { targetHost: host } = useWorkspaceLabelProjection(serverId);
  const [name, setName] = useState("");
  const [color, setColor] = useState<WorkspaceLabelColor>(DEFAULT_CREATE_COLOR);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = host?.status !== "online";

  const submit = useCallback(() => {
    const trimmed = normalizeWorkspaceLabelName(name);
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    workspaceLabels
      .setAssignment({
        serverId,
        workspaceId,
        label: { name: trimmed, color },
        assigned: true,
      })
      .then(() => menu.goBack())
      .catch((cause: unknown) => setError(workspaceLabelErrorMessage(cause)))
      .finally(() => setPending(false));
  }, [color, menu, name, pending, serverId, workspaceId]);

  return (
    <>
      <MenuTextField
        onChangeText={setName}
        placeholder={t("workspaceLabels.name")}
        autoFocus
        editable={!offline && !pending}
        onSubmitEditing={submit}
        testID="workspace-label-picker-create-name"
      />
      <View style={styles.swatches}>
        <WorkspaceLabelSwatchRow
          value={color}
          onChange={setColor}
          disabled={offline || pending}
          testID="workspace-label-picker-create-colors"
        />
      </View>
      <MenuSeparator />
      <MenuItem
        disabled={offline || !normalizeWorkspaceLabelName(name)}
        status={pending ? "pending" : "idle"}
        pendingLabel={t("workspaceLabels.creating")}
        closeOnSelect={false}
        onSelect={submit}
        testID="workspace-label-picker-create-submit"
      >
        {t("workspaceLabels.createConfirm")}
      </MenuItem>
      {error ? <MenuHint testID="workspace-label-picker-error">{error}</MenuHint> : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The swatches start where a row's label starts, so the page reads down one rail: field text,
  // first swatch, commit row. The inset is the text's box, which leaves the round swatch hanging
  // a hair left of the letters beside it — that overshoot is what makes a circle look aligned
  // with a flat stem, so it is the rail rather than a miss. Vertical room of its own because the
  // page's row gap is zero.
  swatches: {
    paddingHorizontal: menuRowContentInset(theme),
    paddingVertical: theme.spacing[2],
  },
}));
