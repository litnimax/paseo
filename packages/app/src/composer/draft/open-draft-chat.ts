import { useCreateFlowStore } from "@/stores/create-flow-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { generateMessageId } from "@/types/stream";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
} from "@/workspace-tabs/model";

export interface OpenDraftChatInput {
  serverId: string;
  workspaceId: string | null | undefined;
  cwd: string;
  text: string;
  setup?: WorkspaceDraftTabSetup;
  /** Sends `text` as soon as the draft can create its agent; otherwise leaves it in the composer. */
  send: boolean;
  generateDraftId?: () => string;
  generateClientMessageId?: () => string;
  now?: () => number;
}

/**
 * Opens a new chat tab holding `text`. Sending needs a workspace id; without one the text stays
 * as a draft. Returns whether the text was queued to send.
 */
export function openDraftChat(input: OpenDraftChatInput): boolean {
  const draftId = (input.generateDraftId ?? generateDraftId)();
  const target = normalizeWorkspaceTabTarget({ kind: "draft", draftId, setup: input.setup });
  if (!target) return false;

  const persistenceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId ?? input.cwd,
  });
  if (!persistenceKey) return false;

  const sendWorkspaceId = input.send ? input.workspaceId?.trim() : undefined;
  if (sendWorkspaceId) {
    const clientMessageId = (input.generateClientMessageId ?? generateMessageId)();
    const timestamp = (input.now ?? Date.now)();
    useCreateFlowStore.getState().setPending({
      serverId: input.serverId,
      draftId,
      workspaceId: sendWorkspaceId,
      agentId: null,
      clientMessageId,
      text: input.text,
      timestamp,
    });
    useWorkspaceDraftSubmissionStore.getState().setPending({
      serverId: input.serverId,
      workspaceId: sendWorkspaceId,
      draftId,
      text: input.text,
      attachments: [],
      cwd: input.cwd,
      ...(input.setup?.provider ? { provider: input.setup.provider } : {}),
      clientMessageId,
      timestamp,
    });
  } else {
    useDraftStore.getState().saveDraftInput({
      draftKey: buildDraftStoreKey({ serverId: input.serverId, agentId: draftId, draftId }),
      draft: { text: input.text, attachments: [] },
    });
  }
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: persistenceKey,
    target,
    intent: "reveal",
  });
  return Boolean(sendWorkspaceId);
}
