import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserPrompt } from "@getpaseo/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { clearLegacyUserPrompts, loadLegacyUserPrompts } from "@/hooks/use-settings";
import { i18n } from "@/i18n/i18next";
import { useHostFeature } from "@/runtime/host-features";
import { includesEveryUserPrompt, mergeUserPrompts } from "./user-prompts";

const migrations = new Map<string, Promise<boolean>>();
const NO_USER_PROMPTS: UserPrompt[] = [];

interface UseServerPromptsResult {
  prompts: UserPrompt[];
  isLoading: boolean;
  isSupported: boolean;
  replacePrompts: (prompts: UserPrompt[]) => Promise<void>;
}

export function useServerPrompts(serverId: string | null): UseServerPromptsResult {
  const isSupported = useHostFeature(serverId, "userPrompts");
  const { config, isLoading: isConfigLoading, patchConfig } = useDaemonConfig(serverId);
  const [legacyPrompts, setLegacyPrompts] = useState<UserPrompt[] | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const prompts = await loadLegacyUserPrompts();
      if (active) setLegacyPrompts(prompts);
    })();
    return () => {
      active = false;
    };
  }, []);

  const serverPrompts = config?.userPrompts ?? NO_USER_PROMPTS;
  const prompts = useMemo(
    () => (isSupported ? mergeUserPrompts(serverPrompts, legacyPrompts ?? []) : []),
    [isSupported, legacyPrompts, serverPrompts],
  );

  useEffect(() => {
    if (!serverId || !isSupported || !config || !legacyPrompts?.length) return;

    let migration = migrations.get(serverId);
    if (!migration) {
      const currentPrompts = config.userPrompts ?? NO_USER_PROMPTS;
      const merged = mergeUserPrompts(currentPrompts, legacyPrompts);
      migration = (async () => {
        if (merged.length !== currentPrompts.length) {
          const updated = await patchConfig({ userPrompts: merged });
          if (!updated) throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
        }
        const migratedAll = includesEveryUserPrompt(merged, legacyPrompts);
        if (migratedAll) {
          await clearLegacyUserPrompts();
        }
        return migratedAll;
      })();
      migrations.set(serverId, migration);
      void migration.then(
        () => migrations.delete(serverId),
        () => migrations.delete(serverId),
      );
    }

    let active = true;
    void migration
      .then((migratedAll) => {
        if (active && migratedAll) setLegacyPrompts([]);
        return undefined;
      })
      .catch((error) => {
        console.error("[UserPrompts] Failed to migrate local prompts to the host:", error);
        return undefined;
      });
    return () => {
      active = false;
    };
  }, [config, isSupported, legacyPrompts, patchConfig, serverId]);

  const replacePrompts = useCallback(
    async (nextPrompts: UserPrompt[]) => {
      if (!serverId || !isSupported) {
        throw new Error(i18n.t("settings.prompts.updateHost"));
      }
      const updated = await patchConfig({ userPrompts: nextPrompts });
      if (!updated) throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
      if (legacyPrompts?.length && includesEveryUserPrompt(nextPrompts, legacyPrompts)) {
        await clearLegacyUserPrompts();
        setLegacyPrompts([]);
      }
    },
    [isSupported, legacyPrompts, patchConfig, serverId],
  );

  return {
    prompts,
    isLoading: isConfigLoading || legacyPrompts === null,
    isSupported,
    replacePrompts,
  };
}
