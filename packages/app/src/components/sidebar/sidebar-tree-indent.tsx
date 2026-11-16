import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { DensityIcon } from "@/components/ui/density-icon";
import { PressHighlight } from "@/components/ui/press-highlight";
import { isWeb } from "@/constants/platform";
import { density } from "@/styles/density";

/** How far each tree level steps in. One status slot, so a child's dot sits under its parent's title. */
export const SIDEBAR_TREE_INDENT = 16;
/** Past this the sidebar is too narrow for another step to read as one; deeper levels share it. */
const MAX_VISUAL_DEPTH = 4;

export interface SidebarTreeDisclosure {
  expanded: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
  testID?: string;
}

/**
 * One row of a sidebar tree: handoff workspaces under their parent, pins under their folder.
 *
 * The disclosure chevron hangs in the gutter left of the row instead of taking a slot inside it, so
 * a parent row keeps the same rails — status dot, title, trailing actions — as a row with no
 * children, and a list that gains its first child does not shift every row beside it.
 */
export function SidebarTreeIndent({
  depth,
  disclosure,
  children,
}: {
  depth: number;
  disclosure?: SidebarTreeDisclosure | null;
  children: ReactNode;
}) {
  const frameStyle = useMemo(
    () => [styles.frame, { marginLeft: Math.min(depth, MAX_VISUAL_DEPTH) * SIDEBAR_TREE_INDENT }],
    [depth],
  );
  const accessibilityState = useMemo(
    () => ({ expanded: disclosure?.expanded ?? false }),
    [disclosure?.expanded],
  );
  return (
    <View style={frameStyle}>
      {children}
      {disclosure ? (
        <PressHighlight
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={disclosure.accessibilityLabel}
          accessibilityState={accessibilityState}
          hitSlop={4}
          onPress={disclosure.onToggle}
          style={styles.disclosure}
          testID={disclosure.testID}
        >
          {({ hovered }) => (
            <DensityIcon
              icon={disclosure.expanded ? ChevronDown : ChevronRight}
              size="xs"
              color={hovered ? "foreground" : "foregroundMuted"}
            />
          )}
        </PressHighlight>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    position: "relative",
  },
  // Spans the list's own leading padding plus the first few points of the row's, which is empty
  // space left of the status slot at every depth.
  disclosure: {
    position: "absolute",
    left: -theme.spacing[2],
    top: 0,
    width: SIDEBAR_TREE_INDENT,
    height: density.rowHeight,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
}));
