import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { Folder, FolderPlus, Pin } from "lucide-react-native";
import {
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  MenuTextField,
  useMenuContext,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import {
  useSidebarWorkspacePinController,
  type PinFiling,
} from "@/hooks/use-sidebar-workspace-pin";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarPinnedFoldersStore } from "@/stores/sidebar-pinned-folders-store";
import type { Theme } from "@/styles/theme";
import { listPinnedFolderPaths, resolveWorkspaceFolderId } from "./model";

/** The `MenuSubTrigger` on a pinned workspace's menu that opens the folder page. */
export const PINNED_FOLDER_PAGE_ID = "pinnedFolders";
/** The `MenuSubTrigger` that replaces "Pin to top" while there are folders to pin into. */
export const PIN_INTO_FOLDER_PAGE_ID = "pinIntoFolder";
const CREATE_PAGE_SUFFIX = "Create";

const NO_PAGES: readonly MenuPageDefinition[] = [];
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedPin = withUnistyles(Pin);
const folderLeading = <ThemedFolder size={14} uniProps={mutedMapping} />;
const rootLeading = <ThemedPin size={14} uniProps={mutedMapping} />;
const createLeading = <ThemedFolderPlus size={14} uniProps={mutedMapping} />;

/**
 * "pin" files an unpinned workspace as it pins it; "move" refiles one that is already pinned. The
 * two share every row, so the Labels-style list reads the same from either entry.
 */
type FolderMenuMode = "pin" | "move";

export interface PinnedFolderMenuTarget {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
}

/**
 * The pin whose folder decides where the workspace sits in Pinned: the workspace itself, or the
 * topmost pinned parent it nests under. A nested handoff always lives in that parent's folder.
 */
function usePinnedBranchRootKey(target: PinnedFolderMenuTarget | null): string | null {
  const serverId = target?.serverId;
  const workspaceId = target?.workspaceId;
  return useSessionStore((state) => {
    if (!serverId || !workspaceId) return null;
    const workspaces = state.sessions[serverId]?.workspaces;
    const seen = new Set<string>([workspaceId]);
    let rootId = workspaceId;
    for (;;) {
      const parentId = workspaces?.get(rootId)?.parentWorkspaceId;
      if (!parentId || seen.has(parentId) || !workspaces?.get(parentId)?.pinnedAt) break;
      seen.add(parentId);
      rootId = parentId;
    }
    return `${serverId}:${rootId}`;
  });
}

/**
 * Which folder list the workspace's menu offers, if any. Without a folder, Pin to top stays a
 * single press. So does pinning a handoff whose parent is pinned: it lands under that parent, and
 * a folder picked for it would be ignored.
 */
export function usePinnedFolderMenuMode(input: {
  target: PinnedFolderMenuTarget | null;
  isPinned: boolean;
  canPin: boolean;
}): FolderMenuMode | null {
  const { target, isPinned, canPin } = input;
  const hasFolders = useSidebarPinnedFoldersStore((state) => state.folders.length > 0);
  // Only a host that keeps Pinned folders can file one of its pins into a folder.
  const hostKeepsFolders = useSidebarPinnedFoldersStore((state) =>
    target ? state.hosts[target.serverId]?.status === "online" : false,
  );
  const branchRootKey = usePinnedBranchRootKey(target);
  if (!target || !hasFolders || !hostKeepsFolders) return null;
  if (isPinned) return "move";
  return canPin && branchRootKey === target.workspaceKey ? "pin" : null;
}

/**
 * The pages behind "Pin to top ▸" and "Move to folder ▸". The pin page is offered only where the
 * host can pin (`canPin`), so it never promises a pin the row's own item would not make.
 */
export function usePinnedFolderMenuPages(input: {
  target: PinnedFolderMenuTarget | null;
  isPinned: boolean;
  canPin: boolean;
}): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  const mode = usePinnedFolderMenuMode(input);
  const { target } = input;
  return useMemo(() => {
    if (!target || !mode) return NO_PAGES;
    const pageId = mode === "pin" ? PIN_INTO_FOLDER_PAGE_ID : PINNED_FOLDER_PAGE_ID;
    return [
      {
        id: pageId,
        title: t(mode === "pin" ? "sidebar.workspace.actions.pin" : "sidebar.pinned.moveToFolder"),
        content: <PinnedFolderPickerPage mode={mode} target={target} />,
      },
      {
        id: `${pageId}${CREATE_PAGE_SUFFIX}`,
        title: t("sidebar.pinned.newFolder"),
        // A page you type into is not one the pointer opens or dismisses on its own.
        hoverIntent: false,
        content: <PinnedFolderCreatePage mode={mode} target={target} />,
      },
    ];
  }, [mode, t, target]);
}

type FolderChoice = { folderId: string | null } | { newFolderName: string };

function toPinFiling(choice: FolderChoice): PinFiling | undefined {
  if ("newFolderName" in choice) return choice;
  return choice.folderId ? { folderId: choice.folderId } : undefined;
}

/**
 * Pins into a folder, or refiles the pin, depending on what the menu was opened for. Refiling a
 * nested handoff moves the branch it sits in, the same as dragging that branch.
 */
function useFileWorkspace(mode: FolderMenuMode, target: PinnedFolderMenuTarget) {
  const togglePin = useSidebarWorkspacePinController();
  const filedKey = usePinnedBranchRootKey(target) ?? target.workspaceKey;
  return useCallback(
    (choice: FolderChoice) => {
      if (mode === "pin") {
        togglePin({ ...target, pinnedAt: null }, { filing: toPinFiling(choice) });
        return;
      }
      const store = useSidebarPinnedFoldersStore.getState();
      const folderId =
        "folderId" in choice
          ? choice.folderId
          : store.createFolder({ name: choice.newFolderName, parentId: null });
      store.assignWorkspaceFolder(filedKey, folderId);
    },
    [filedKey, mode, target, togglePin],
  );
}

function PinnedFolderPickerPage({
  mode,
  target,
}: {
  mode: FolderMenuMode;
  target: PinnedFolderMenuTarget;
}): ReactElement {
  const { t } = useTranslation();
  const { workspaceKey } = target;
  const folders = useSidebarPinnedFoldersStore((state) => state.folders);
  const folderIdByWorkspaceKey = useSidebarPinnedFoldersStore(
    (state) => state.folderIdByWorkspaceKey,
  );
  // Only a pin has a folder it is in; a workspace about to be pinned ticks nothing.
  const filedKey = usePinnedBranchRootKey(target) ?? workspaceKey;
  const currentFolderId =
    mode === "move"
      ? resolveWorkspaceFolderId(
          filedKey,
          folderIdByWorkspaceKey,
          new Set(folders.map((folder) => folder.id)),
        )
      : undefined;
  const rows = useMemo(() => listPinnedFolderPaths(folders), [folders]);
  const file = useFileWorkspace(mode, target);
  const fileInto = useCallback((folderId: string | null) => file({ folderId }), [file]);
  const fileIntoRoot = useCallback(() => fileInto(null), [fileInto]);
  const testIDPrefix = mode === "pin" ? "pin-into" : "move-to";

  return (
    <>
      <MenuItem
        leading={rootLeading}
        selected={currentFolderId === null}
        onSelect={fileIntoRoot}
        testID={`sidebar-workspace-menu-${testIDPrefix}-root-${workspaceKey}`}
      >
        {t("sidebar.pinned.rootFolder")}
      </MenuItem>
      {rows.map(({ folder, path }) => (
        <PinnedFolderPickerRow
          key={folder.id}
          folderId={folder.id}
          path={path}
          selected={currentFolderId === folder.id}
          onFile={fileInto}
          testID={`sidebar-workspace-menu-${testIDPrefix}-folder-${folder.id}-${workspaceKey}`}
        />
      ))}
      <MenuSeparator />
      <MenuSubTrigger
        id={`${mode === "pin" ? PIN_INTO_FOLDER_PAGE_ID : PINNED_FOLDER_PAGE_ID}${CREATE_PAGE_SUFFIX}`}
        leading={createLeading}
        testID={`sidebar-workspace-menu-${testIDPrefix}-new-folder-${workspaceKey}`}
      >
        {t("sidebar.pinned.newFolder")}
      </MenuSubTrigger>
    </>
  );
}

function PinnedFolderPickerRow({
  folderId,
  path,
  selected,
  onFile,
  testID,
}: {
  folderId: string;
  path: string;
  selected: boolean;
  onFile: (folderId: string) => void;
  testID: string;
}): ReactElement {
  const select = useCallback(() => onFile(folderId), [folderId, onFile]);
  return (
    <MenuItem leading={folderLeading} selected={selected} onSelect={select} testID={testID}>
      {path}
    </MenuItem>
  );
}

/** Names a new top-level folder and files the workspace in it, in one step. */
function PinnedFolderCreatePage({
  mode,
  target,
}: {
  mode: FolderMenuMode;
  target: PinnedFolderMenuTarget;
}): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("PinnedFolderCreatePage");
  const [name, setName] = useState("");
  const file = useFileWorkspace(mode, target);
  const create = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed) file({ newFolderName: trimmed });
  }, [file, name]);
  const submitFromField = useCallback(() => {
    if (name.trim()) menu.selectItem(create, true);
  }, [create, menu, name]);
  const testIDPrefix = mode === "pin" ? "pin-into" : "move-to";

  return (
    <>
      <MenuTextField
        onChangeText={setName}
        placeholder={t("sidebar.pinned.folderName.placeholder")}
        autoFocus
        onSubmitEditing={submitFromField}
        testID={`sidebar-workspace-menu-${testIDPrefix}-new-folder-name`}
      />
      <MenuSeparator />
      <MenuItem
        disabled={!name.trim()}
        onSelect={create}
        testID={`sidebar-workspace-menu-${testIDPrefix}-new-folder-submit`}
      >
        {t("sidebar.pinned.folderName.create")}
      </MenuItem>
    </>
  );
}
