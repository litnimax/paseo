import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type NativeSyntheticEvent } from "react-native";
import type { TextInputKeyPressEventData } from "react-native";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import type { Theme } from "@/styles/theme";
import type { TranscriptFindBarProps } from "./find-bar";
import type { TimelineSearchHit } from "./model";
import { isSearchableQuery } from "./model";

type FindBarKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean }
>;

const ThemedSearch = withUnistyles(Search);
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedX = withUnistyles(X);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Find in this session. It floats over the transcript rather than sitting in the pane
 * toolbar: the toolbar belongs to the whole pane, while this is scoped to one agent's
 * transcript and disappears with Escape.
 *
 * The result rows carry a preview because a bare "3 of 40" over a transcript is not
 * enough to choose from — the daemon already marked where each match sits, so the list
 * shows what it found instead of making the user step through every hit to see it.
 */
export function TranscriptFindBar({ search }: TranscriptFindBarProps): ReactElement | null {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const { isOpen, close, goToNextHit, goToPreviousHit } = search;

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleKeyPress = useCallback(
    (event: FindBarKeyPressEvent) => {
      const { key } = event.nativeEvent;
      if (key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (key !== "Enter") return;
      event.preventDefault();
      if (event.nativeEvent.shiftKey) {
        goToPreviousHit();
        return;
      }
      goToNextHit();
    },
    [close, goToNextHit, goToPreviousHit],
  );

  if (!isOpen) return null;

  const hasQuery = isSearchableQuery(search.query);
  const hitCount = search.hits.length;
  const position = search.activeIndex >= 0 ? search.activeIndex + 1 : 0;

  return (
    <View style={styles.container} testID="transcript-find-bar">
      <View style={styles.bar}>
        <ThemedSearch size={14} uniProps={mutedColorMapping} />
        <ThemedTextInput
          testID="transcript-find-input"
          ref={inputRef}
          initialValue={search.query}
          onChangeText={search.setQuery}
          onKeyPress={handleKeyPress}
          placeholder={t("agentStream.find.placeholder")}
          accessibilityLabel={t("agentStream.find.placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        <FindBarStatus
          hasQuery={hasQuery}
          isSearching={search.isSearching}
          failed={search.failed}
          hitCount={hitCount}
          position={position}
          truncated={search.truncated}
        />
        <ToolbarButton
          label={t("agentStream.find.previous")}
          onPress={goToPreviousHit}
          disabled={hitCount === 0}
          testID="transcript-find-previous"
          compact
        >
          <ThemedChevronUp size={14} uniProps={mutedColorMapping} />
        </ToolbarButton>
        <ToolbarButton
          label={t("agentStream.find.next")}
          onPress={goToNextHit}
          disabled={hitCount === 0}
          testID="transcript-find-next"
          compact
        >
          <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
        </ToolbarButton>
        <ToolbarButton
          label={t("agentStream.find.close")}
          onPress={close}
          testID="transcript-find-close"
          compact
        >
          <ThemedX size={14} uniProps={mutedColorMapping} />
        </ToolbarButton>
      </View>
      {hitCount > 0 ? (
        <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
          {search.hits.map((hit, index) => (
            <FindBarResult
              key={hit.seq}
              hit={hit}
              index={index}
              label={t(`agentStream.find.kind.${hit.kind}`)}
              selected={index === search.activeIndex}
              onSelect={search.goToHit}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function FindBarStatus({
  hasQuery,
  isSearching,
  failed,
  hitCount,
  position,
  truncated,
}: {
  hasQuery: boolean;
  isSearching: boolean;
  failed: boolean;
  hitCount: number;
  position: number;
  truncated: boolean;
}): ReactElement | null {
  const { t } = useTranslation();

  if (isSearching) {
    return <LoadingSpinner size={14} color={styles.status.color} />;
  }
  if (failed) {
    return (
      <Text style={styles.statusError} testID="transcript-find-status">
        {t("agentStream.find.failed")}
      </Text>
    );
  }
  if (!hasQuery) return null;
  if (hitCount === 0) {
    return (
      <Text style={styles.status} testID="transcript-find-status">
        {t("agentStream.find.noMatches")}
      </Text>
    );
  }
  return (
    <Text style={styles.status} testID="transcript-find-status">
      {truncated
        ? t("agentStream.find.countTruncated", { position, total: hitCount })
        : t("agentStream.find.count", { position, total: hitCount })}
    </Text>
  );
}

function FindBarResult({
  hit,
  index,
  label,
  selected,
  onSelect,
}: {
  hit: TimelineSearchHit;
  index: number;
  label: string;
  selected: boolean;
  onSelect: (index: number) => void;
}): ReactElement {
  const handlePress = useCallback(() => onSelect(index), [index, onSelect]);
  const rowStyle = useMemo(() => [styles.result, selected && styles.resultSelected], [selected]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <Text style={styles.resultKind}>{label}</Text>
      <HighlightedText
        text={hit.preview}
        ranges={hit.ranges}
        style={styles.resultPreview}
        numberOfLines={2}
      />
    </Pressable>
  );
}

const FIND_BAR_WIDTH = 420;
const RESULTS_MAX_HEIGHT = 260;

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[4],
    width: FIND_BAR_WIDTH,
    maxWidth: "100%",
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    height: 20,
    // The browser's focus ring would sit inside the bar's own border.
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  statusError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  results: {
    maxHeight: RESULTS_MAX_HEIGHT,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  result: {
    gap: theme.spacing[0.5],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
  },
  resultSelected: {
    backgroundColor: theme.colors.surface2,
  },
  resultKind: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  resultPreview: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
