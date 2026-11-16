import {
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
  type PropsWithChildren,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Folder, FolderOpen, FolderPlus, MoreVertical, Pencil, Trash2 } from "lucide-react-native";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DensityIcon } from "@/components/ui/density-icon";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import type { PinnedFolder } from "@/stores/sidebar-pinned-folders-store";
import { mapLayout } from "@/components/ui/control-sizing";
import { density, densityIconBox, densityIconProps } from "@/styles/density";
import type { Theme } from "@/styles/theme";

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);

const newSubfolderLeading = <ThemedFolderPlus size={14} uniProps={mutedMapping} />;
const renameLeading = <ThemedPencil size={14} uniProps={mutedMapping} />;
const deleteLeading = <ThemedTrash2 size={14} uniProps={mutedMapping} />;
const kebabIconProps = densityIconProps("sm", mutedMapping);
const kebabIconHoveredProps = densityIconProps("sm", foregroundMapping);

function renderKebabIcon({ hovered }: { hovered?: boolean }) {
  return <ThemedMoreVertical uniProps={hovered ? kebabIconHoveredProps : kebabIconProps} />;
}

export interface PinnedFolderActions {
  onCreateSubfolder: (folder: PinnedFolder) => void;
  onRename: (folder: PinnedFolder) => void;
  onDelete: (folder: PinnedFolder) => void;
}

/**
 * A folder in the Pinned section. It takes the workspace row's geometry so the tree reads as one
 * list; the folder glyph sits in the status slot and pressing anywhere on the row opens or closes
 * it, the way a file manager's tree does.
 */
export function PinnedFolderRow({
  folder,
  collapsed,
  workspaceCount,
  onToggle,
  actions,
  dragHandleProps,
  isDragging,
  isDropTarget,
}: {
  folder: PinnedFolder;
  collapsed: boolean;
  workspaceCount: number;
  onToggle: (folderId: string) => void;
  actions: PinnedFolderActions;
  dragHandleProps?: DraggableListDragHandleProps;
  isDragging: boolean;
  isDropTarget: boolean;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => onToggle(folder.id), [folder.id, onToggle]);
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      isHovered && styles.rowHovered,
      pressed && styles.rowPressed,
      isDropTarget && styles.rowDropTarget,
      isDragging && styles.rowDragging,
    ],
    [isDragging, isDropTarget, isHovered],
  );
  const showActions = isHovered || contextMenuOpen || isNative || isCompact;

  return (
    <View
      {...dragAttributes}
      {...dragHandleProps?.listeners}
      ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
      style={styles.container}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <ContextMenu open={contextMenuOpen} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger
          enabledOnMobile={false}
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={folder.name}
          accessibilityState={accessibilityState}
          onPress={handlePress}
          style={rowStyle}
          testID={`sidebar-pinned-folder-${folder.id}`}
        >
          <View style={styles.iconSlot}>
            <DensityIcon
              icon={collapsed ? Folder : FolderOpen}
              size="md"
              color={isHovered ? "foreground" : "foregroundMuted"}
            />
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {folder.name}
          </Text>
        </ContextMenuTrigger>
        <ContextMenuContent
          align="start"
          width={220}
          testID={`sidebar-pinned-folder-context-menu-${folder.id}`}
        >
          <PinnedFolderMenuItems surface="context" folder={folder} actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
      {/* One trailing slot, reserved in the row's padding: the pin count at rest, the menu on
        hover. A long name truncates before it either way. */}
      <View style={styles.trailingSlot} pointerEvents="box-none">
        {showActions ? (
          <DropdownMenu compactMode="sheet">
            <DropdownMenuTrigger
              hitSlop={8}
              style={styles.kebab}
              accessibilityRole={isWeb ? undefined : "button"}
              accessibilityLabel={t("sidebar.pinned.folderMenu")}
              testID={`sidebar-pinned-folder-kebab-${folder.id}`}
            >
              {renderKebabIcon}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" width={220} sheetTitle={folder.name}>
              <PinnedFolderMenuItems surface="dropdown" folder={folder} actions={actions} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {!showActions && workspaceCount > 0 ? (
          <View pointerEvents="none">
            <Text style={styles.count}>{workspaceCount}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

type MenuSurface = "context" | "dropdown";

function FolderMenuItem({
  surface,
  children,
  ...props
}: PropsWithChildren<
  Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & { surface: MenuSurface }
>) {
  if (surface === "context") {
    return <ContextMenuItem {...props}>{children}</ContextMenuItem>;
  }
  return <DropdownMenuItem {...props}>{children}</DropdownMenuItem>;
}

function PinnedFolderMenuItems({
  surface,
  folder,
  actions,
}: {
  surface: MenuSurface;
  folder: PinnedFolder;
  actions: PinnedFolderActions;
}) {
  const { t } = useTranslation();
  const { onCreateSubfolder, onRename, onDelete } = actions;
  const handleCreateSubfolder = useCallback(
    () => onCreateSubfolder(folder),
    [folder, onCreateSubfolder],
  );
  const handleRename = useCallback(() => onRename(folder), [folder, onRename]);
  const handleDelete = useCallback(() => onDelete(folder), [folder, onDelete]);
  return (
    <>
      <FolderMenuItem
        surface={surface}
        leading={newSubfolderLeading}
        onSelect={handleCreateSubfolder}
        testID={`sidebar-pinned-folder-menu-new-subfolder-${folder.id}`}
      >
        {t("sidebar.pinned.newSubfolder")}
      </FolderMenuItem>
      <FolderMenuItem
        surface={surface}
        leading={renameLeading}
        onSelect={handleRename}
        testID={`sidebar-pinned-folder-menu-rename-${folder.id}`}
      >
        {t("sidebar.pinned.renameFolder")}
      </FolderMenuItem>
      <FolderMenuItem
        surface={surface}
        leading={deleteLeading}
        onSelect={handleDelete}
        testID={`sidebar-pinned-folder-menu-delete-${folder.id}`}
      >
        {t("sidebar.pinned.deleteFolder")}
      </FolderMenuItem>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
  },
  // Kept in step with `workspaceRow` in sidebar-workspace-list.tsx.
  row: {
    minHeight: density.rowHeight,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    // Room for the trailing slot, so a long name truncates before the count or the menu.
    paddingRight: mapLayout(
      densityIconBox("md"),
      (box) => theme.spacing[2] + box + theme.spacing[1],
    ),
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  // Stronger than hover: the pointer is over the row either way, so the fill has to say more.
  rowDropTarget: {
    backgroundColor: theme.colors.surface3,
  },
  rowDragging: {
    backgroundColor: theme.colors.surface2,
  },
  iconSlot: {
    width: densityIconBox("md"),
    height: densityIconBox("md"),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  trailingSlot: {
    position: "absolute",
    right: theme.spacing[2],
    top: 0,
    bottom: theme.spacing[0.5],
    width: densityIconBox("md"),
    alignItems: "center",
    justifyContent: "center",
  },
  kebab: {
    width: densityIconBox("md"),
    height: densityIconBox("md"),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
}));
