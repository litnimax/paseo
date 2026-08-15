import type { StyleProp, TextStyle } from "react-native";
import { useMemo } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";

interface SettingsTextFieldProps {
  accessibilityLabel: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  maxLength?: number;
  placeholder?: string;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

/** Single-line sibling of {@link SettingsTextArea} for short values such as a branch name. */
export function SettingsTextField({
  accessibilityLabel,
  value,
  onChangeText,
  onBlur,
  maxLength,
  placeholder,
  testID,
  style,
}: SettingsTextFieldProps) {
  const inputStyle = useMemo(() => [styles.input, style], [style]);

  return (
    <TextInput
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      maxLength={maxLength}
      placeholder={placeholder}
      placeholderTextColor={styles.placeholder.color}
      autoCapitalize="none"
      autoCorrect={false}
      style={inputStyle}
    />
  );
}

export function SettingsTextFieldCard(props: SettingsTextFieldProps) {
  return (
    <View style={settingsStyles.card}>
      <SettingsTextField {...props} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
}));
