import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useAppSettings } from "@/hooks/use-settings";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  useHostRuntimeClient,
  useHostRegistryLoaded,
  useHostRuntimeConnectionStatus,
  useHosts,
} from "@/runtime/host-runtime";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { useSessionStore } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import {
  applyViewProfile,
  captureViewProfile,
  parseViewProfile,
  toWireView,
  type ViewDisplaySettings,
} from "./profile";

/** The saved view this device last put on screen or saved, so a restart loads only what is new. */
export interface AppliedViewMarker {
  serverId: string;
  operatorId: string;
  revision: number;
  /**
   * When the host saved that revision. A host whose file was lost counts from 1 again, so the
   * revision alone can name two different views.
   */
  savedAt?: string;
}

const AppliedViewMarkerSchema = z.strictObject({
  applied: z
    .strictObject({
      serverId: z.string(),
      operatorId: z.string(),
      revision: z.number().int().positive(),
      savedAt: z.string().optional(),
    })
    .nullable()
    .optional(),
});

interface ViewProfileSyncState {
  applied: AppliedViewMarker | null;
  setApplied: (marker: AppliedViewMarker) => void;
}

export const useViewProfileSyncStore = create<ViewProfileSyncState>()(
  persist<ViewProfileSyncState, [], [], z.infer<typeof AppliedViewMarkerSchema>>(
    (set) => ({
      applied: null,
      setApplied: (applied) => set({ applied }),
    }),
    {
      name: "view-profile-sync",
      storage: createValidatedPersistStorage(AsyncStorage, AppliedViewMarkerSchema),
      partialize: (state) => ({ applied: state.applied }),
      merge: (persisted, current) => {
        const result = AppliedViewMarkerSchema.safeParse(persisted);
        return result.success ? { ...current, applied: result.data.applied ?? null } : current;
      },
    },
  ),
);

/**
 * Whose view this client follows: the default host when a team member is chosen there, else the
 * first host that has one. A view is personal, so a host without a chosen member offers none.
 */
export function resolveViewProfileHost(input: {
  hosts: readonly Pick<HostProfile, "serverId" | "operatorId">[];
  defaultHostServerId: string | null;
}): { serverId: string; operatorId: string } | null {
  const withMember = input.hosts.filter((host) => Boolean(host.operatorId?.trim()));
  const chosen =
    withMember.find((host) => host.serverId === input.defaultHostServerId) ?? withMember[0];
  const operatorId = chosen?.operatorId?.trim();
  return chosen && operatorId ? { serverId: chosen.serverId, operatorId } : null;
}

/**
 * Whether a saved view should replace what is on screen. Switching host or member always loads
 * theirs; otherwise only a revision this device has not applied or saved itself does, so a view
 * tweaked here and not saved survives a restart until someone saves a newer one.
 */
export function shouldApplySavedView(input: {
  applied: AppliedViewMarker | null;
  serverId: string;
  operatorId: string;
  revision: number;
  savedAt: string;
}): boolean {
  const { applied } = input;
  if (!applied || applied.serverId !== input.serverId || applied.operatorId !== input.operatorId) {
    return true;
  }
  return applied.revision !== input.revision || applied.savedAt !== input.savedAt;
}

/** `stale`: the connection still speaks for the previous member; ask again on the new one. */
export type ViewLoadOutcome = "loaded" | "unchanged" | "empty" | "stale";

/** Loads the member's saved view. `force` puts it on screen even if this device already has it. */
export async function loadSavedView(input: {
  client: DaemonClient;
  serverId: string;
  /** The member the caller expects; a reply for anyone else is not theirs to apply. */
  operatorId?: string;
  force: boolean;
}): Promise<ViewLoadOutcome> {
  const { operatorId, profile } = await input.client.getOperatorViewProfile();
  if (input.operatorId && operatorId !== input.operatorId) return "stale";
  if (!profile) return "empty";
  const marker = {
    serverId: input.serverId,
    operatorId,
    revision: profile.revision,
    savedAt: profile.savedAt,
  };
  const sync = useViewProfileSyncStore.getState();
  if (!input.force && !shouldApplySavedView({ applied: sync.applied, ...marker })) {
    return "unchanged";
  }
  await applyViewProfile(parseViewProfile(profile.view));
  sync.setApplied(marker);
  return "loaded";
}

/** The host holds a view this device has not seen; saving would replace it. */
export function isViewConflictError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "operator_view_conflict";
}

/**
 * Saves what is on screen as the member's view. The host refuses, with an error
 * `isViewConflictError` recognises, when another device saved since this one last loaded or
 * saved; `overwrite` saves anyway.
 */
export async function saveCurrentView(input: {
  client: DaemonClient;
  serverId: string;
  operatorId: string;
  display: ViewDisplaySettings;
  overwrite?: boolean;
}): Promise<void> {
  const sync = useViewProfileSyncStore.getState();
  const seen =
    sync.applied?.serverId === input.serverId && sync.applied.operatorId === input.operatorId
      ? sync.applied.revision
      : 0;
  const { operatorId, profile } = await input.client.saveOperatorViewProfile({
    view: toWireView(captureViewProfile(input.display)),
    ...(input.overwrite ? {} : { baseRevision: seen }),
  });
  sync.setApplied({
    serverId: input.serverId,
    operatorId,
    revision: profile.revision,
    savedAt: profile.savedAt,
  });
}

export interface ViewProfileTarget {
  serverId: string;
  operatorId: string;
  /** The member's display name from the host's team, or their id until the config arrives. */
  memberName: string;
  client: DaemonClient;
}

/** The host and member this client saves and loads its view with, once that host is online. */
export function useViewProfileTarget(): ViewProfileTarget | null {
  const hosts = useHosts();
  const {
    settings: { defaultHostServerId },
  } = useAppSettings();
  const host = useMemo(
    () => resolveViewProfileHost({ hosts, defaultHostServerId }),
    [defaultHostServerId, hosts],
  );
  const serverId = host?.serverId ?? "";
  const client = useHostRuntimeClient(serverId);
  const status = useHostRuntimeConnectionStatus(serverId);
  // COMPAT(operatorViewProfiles): added in v0.16.0, remove gate after 2027-05-13.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.operatorViewProfiles === true,
  );
  const { config } = useDaemonConfig(host?.serverId ?? null);
  const memberName =
    config?.teamMembers?.find((member) => member.id === host?.operatorId)?.name ??
    host?.operatorId ??
    "";
  return useMemo(
    () =>
      host && client && status === "online" && supported
        ? { serverId: host.serverId, operatorId: host.operatorId, memberName, client }
        : null,
    [client, host, memberName, status, supported],
  );
}

/**
 * Loads the chosen member's view. Choosing a member — another one, or the same one again after
 * Unassigned — always puts their saved view on screen. Starting the client loads it only when the
 * host has a revision this device has not applied or saved, so an unsaved tweak survives a
 * restart. Renders nothing; mounted once beside the sidebar model.
 */
export function ViewProfileAutoLoad(): null {
  const hosts = useHosts();
  const hostsLoaded = useHostRegistryLoaded();
  const {
    settings: { defaultHostServerId },
  } = useAppSettings();
  const selection = resolveViewProfileHost({ hosts, defaultHostServerId });
  const selectionKey = selection ? `${selection.serverId}\u0000${selection.operatorId}` : null;
  const lastSelectionKey = useRef<string | null | undefined>(undefined);
  const forceNextLoad = useRef(false);
  useEffect(() => {
    // The registry arrives after launch; the selection it holds then is where this run started.
    if (!hostsLoaded) return;
    if (lastSelectionKey.current !== undefined && lastSelectionKey.current !== selectionKey) {
      forceNextLoad.current = true;
    }
    lastSelectionKey.current = selectionKey;
  }, [hostsLoaded, selectionKey]);

  const target = useViewProfileTarget();
  const serverId = target?.serverId ?? null;
  const operatorId = target?.operatorId ?? null;
  const client = target?.client ?? null;
  useEffect(() => {
    if (!serverId || !operatorId || !client) return;
    const force = forceNextLoad.current;
    forceNextLoad.current = false;
    void loadSavedView({ client, serverId, operatorId, force })
      .then((outcome) => {
        // Changing member reconnects; until it does, keep the choice to load theirs.
        if (outcome === "stale" && force) forceNextLoad.current = true;
        return undefined;
      })
      .catch((error) => {
        if (force) forceNextLoad.current = true;
        console.warn("[view-profiles] could not load the saved view", { serverId, error });
      });
  }, [client, operatorId, serverId]);
  return null;
}
