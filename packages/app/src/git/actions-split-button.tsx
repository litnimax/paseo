import { useCallback, useMemo, type ReactElement } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronDown, Info, MoreVertical } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useToast } from "@/contexts/toast-context";
import type { GitAction, GitActions } from "@/git/policy";

/**
 * A non-git action appended to the git actions caret menu (e.g. "Review").
 * Kept separate from the pure {@link GitAction} policy so the git machinery
 * stays focused on git RPCs.
 */
export interface SplitButtonExtraItem {
  key: string;
  label: string;
  icon?: ReactElement;
  disabled?: boolean;
  /** When set, selecting the item shows this message as a toast instead of running it. */
  unavailableMessage?: string;
  testID?: string;
  onSelect: () => void;
}

interface GitActionsSplitButtonProps {
  gitActions: GitActions;
  hideLabels?: boolean;
  extraItems?: SplitButtonExtraItem[];
}

const EMPTY_EXTRA_ITEMS: SplitButtonExtraItem[] = [];

function ExtraMenuItem({
  item,
  onSelect,
  showSeparator,
}: {
  item: SplitButtonExtraItem;
  onSelect: (item: SplitButtonExtraItem) => void;
  showSeparator: boolean;
}) {
  const handleSelect = useCallback(() => onSelect(item), [onSelect, item]);
  return (
    <View>
      {showSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        testID={item.testID}
        leading={item.icon}
        disabled={item.disabled}
        muted={Boolean(item.unavailableMessage)}
        closeOnSelect
        onSelect={handleSelect}
      >
        {item.label}
      </DropdownMenuItem>
    </View>
  );
}

interface GitActionMenuItemProps {
  action: GitAction;
  onSelect: (action: GitAction) => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  needsSeparator?: boolean;
  showSeparator?: boolean;
  closeOnSelect?: boolean;
}

function GitActionMenuItem({
  action,
  onSelect,
  archiveShortcutKeys,
  needsSeparator,
  showSeparator,
  closeOnSelect,
}: GitActionMenuItemProps) {
  const handleSelect = useCallback(() => onSelect(action), [onSelect, action]);
  const trailing = useMemo(
    () =>
      action.id === "archive-workspace" && archiveShortcutKeys ? (
        <Shortcut chord={archiveShortcutKeys} />
      ) : undefined,
    [action.id, archiveShortcutKeys],
  );
  return (
    <View>
      {needsSeparator && showSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        testID={
          action.id === "archive-workspace"
            ? "workspace-archive-action"
            : `changes-menu-${action.id}`
        }
        leading={action.icon}
        trailing={trailing}
        disabled={action.disabled}
        muted={Boolean(action.unavailableMessage)}
        status={action.status}
        pendingLabel={action.pendingLabel}
        successLabel={action.successLabel}
        closeOnSelect={closeOnSelect}
        onSelect={handleSelect}
      >
        {action.label}
      </DropdownMenuItem>
    </View>
  );
}

export function GitActionsSplitButton({
  gitActions,
  hideLabels,
  extraItems,
}: GitActionsSplitButtonProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const toast = useToast();
  const archiveShortcutKeys = useShortcutKeys("archive-workspace");
  const resolvedExtraItems = extraItems ?? EMPTY_EXTRA_ITEMS;

  const handleExtraItemSelect = useCallback(
    (item: SplitButtonExtraItem) => {
      if (item.unavailableMessage) {
        toast.show(item.unavailableMessage, {
          durationMs: 3200,
          icon: <Info size={16} color={theme.colors.foreground} />,
        });
        return;
      }
      item.onSelect();
    },
    [theme.colors.foreground, toast],
  );

  const getActionDisplayLabel = useCallback((action: GitAction): string => {
    if (action.status === "pending") return action.pendingLabel;
    if (action.status === "success") return action.successLabel;
    return action.label;
  }, []);

  const handleActionSelect = useCallback(
    (action: GitAction) => {
      if (action.unavailableMessage) {
        toast.show(action.unavailableMessage, {
          durationMs: 3200,
          icon: <Info size={16} color={theme.colors.foreground} />,
        });
        return;
      }
      action.handler();
    },
    [theme.colors.foreground, toast],
  );

  const handlePrimaryPress = useCallback(() => {
    if (!gitActions.primary) {
      return;
    }
    handleActionSelect(gitActions.primary);
  }, [gitActions.primary, handleActionSelect]);

  const overflowMenuButtonStyle = useMemo(() => [styles.iconButton, styles.overflowMenuButton], []);

  const primaryDisabled = gitActions.primary?.disabled;
  const primaryPressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.splitButtonPrimary,
      (Boolean(hovered) || pressed) &&
        inlineUnistylesStyle({ backgroundColor: theme.colors.surface2 }),
      primaryDisabled && styles.splitButtonPrimaryDisabled,
    ],
    [primaryDisabled, theme.colors.surface2],
  );

  const caretTriggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.splitButtonCaret,
      (hovered || pressed || open) &&
        inlineUnistylesStyle({ backgroundColor: theme.colors.surface2 }),
    ],
    [theme.colors.surface2],
  );

  return (
    <View style={styles.row}>
      {gitActions.primary ? (
        <View style={styles.splitButton}>
          <Pressable
            testID="changes-primary-cta"
            style={primaryPressableStyle}
            onPress={handlePrimaryPress}
            disabled={gitActions.primary.disabled}
            accessibilityRole="button"
            accessibilityLabel={gitActions.primary.label}
          >
            {gitActions.primary.status === "pending" ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.foreground}
                style={styles.splitButtonSpinnerOnly}
              />
            ) : (
              <View style={styles.splitButtonContent}>
                {gitActions.primary.icon}
                {!hideLabels && (
                  <Text style={styles.splitButtonText}>
                    {getActionDisplayLabel(gitActions.primary)}
                  </Text>
                )}
              </View>
            )}
          </Pressable>
          {gitActions.secondary.length > 0 || resolvedExtraItems.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                testID="changes-primary-cta-caret"
                style={caretTriggerStyle}
                accessibilityRole="button"
                accessibilityLabel={t("workspace.git.actions.moreOptions")}
              >
                <ChevronDown size={16} color={theme.colors.foregroundMuted} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" testID="changes-primary-cta-menu">
                {gitActions.secondary.map((action, index) => (
                  <GitActionMenuItem
                    key={action.id}
                    action={action}
                    onSelect={handleActionSelect}
                    archiveShortcutKeys={archiveShortcutKeys}
                    needsSeparator={action.startsGroup}
                    showSeparator={index > 0}
                    closeOnSelect={
                      action.status === "idle" &&
                      action.id === "pr" &&
                      action.label === action.pendingLabel &&
                      action.label === action.successLabel
                    }
                  />
                ))}
                {resolvedExtraItems.map((item, index) => (
                  <ExtraMenuItem
                    key={item.key}
                    item={item}
                    onSelect={handleExtraItemSelect}
                    showSeparator={gitActions.secondary.length > 0 || index > 0}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </View>
      ) : null}
      {gitActions.menu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            testID="changes-overflow-menu"
            hitSlop={8}
            style={overflowMenuButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.git.actions.moreActions")}
          >
            <MoreVertical size={16} color={theme.colors.foregroundMuted} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width={220} testID="changes-overflow-content">
            {gitActions.menu.map((action) => (
              <GitActionMenuItem
                key={action.id}
                action={action}
                onSelect={handleActionSelect}
                closeOnSelect={false}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  splitButton: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  splitButtonPrimary: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    justifyContent: "center",
    position: "relative",
  },
  splitButtonPrimaryDisabled: {
    opacity: 0.6,
  },
  splitButtonText: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  splitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  splitButtonSpinnerOnly: {
    transform: [{ scale: 0.8 }],
  },
  splitButtonCaret: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.borderAccent,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  overflowMenuButton: {
    marginRight: -theme.spacing[2],
  },
}));
