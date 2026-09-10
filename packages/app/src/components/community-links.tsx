import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Scale } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { openExternalUrl } from "@/utils/open-external-url";

const renderGitHubIcon = (color: string) => <GitHubIcon color={color} size={14} />;

export function CommunityLinks() {
  const handleOpenGitHub = useCallback(() => {
    void openExternalUrl("https://github.com/litnimax/paseo");
  }, []);

  const handleOpenLicenses = useCallback(() => {
    void openExternalUrl("https://github.com/litnimax/paseo/blob/main/NOTICE");
  }, []);

  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={renderGitHubIcon}
        onPress={handleOpenGitHub}
        testID="community-links-github-star"
      >
        Star
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Scale}
        onPress={handleOpenLicenses}
        testID="community-links-licenses"
      >
        Licenses
      </Button>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
