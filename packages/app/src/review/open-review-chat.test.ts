import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { openReviewChat } from "./open-review-chat";

beforeEach(() => {
  useDraftStore.setState({ drafts: {} });
  useCreateFlowStore.getState().clearAll();
  useWorkspaceDraftSubmissionStore.setState({ pendingByDraftId: {}, setupByDraftId: {} });
  useWorkspaceLayoutStore.setState({ openTabFocused: vi.fn(() => "tab-review") });
});

describe("openReviewChat", () => {
  it("queues a review for immediate submission on a normal click", () => {
    openReviewChat({
      serverId: "server-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
      text: "Review these changes",
      provider: "",
      model: "",
      event: { ctrlKey: false, metaKey: false },
      shortcutOs: "mac",
      generateDraftId: () => "draft-review",
      generateClientMessageId: () => "message-review",
      now: () => 123,
    });

    expect(useCreateFlowStore.getState().pendingByDraftId["draft-review"]).toMatchObject({
      clientMessageId: "message-review",
      text: "Review these changes",
      lifecycle: "active",
    });
    expect(
      useWorkspaceDraftSubmissionStore.getState().pendingByDraftId["draft-review"],
    ).toMatchObject({
      workspaceId: "workspace-1",
      cwd: "/repo",
      text: "Review these changes",
    });
    expect(
      useDraftStore.getState().getDraftInput(
        buildDraftStoreKey({
          serverId: "server-1",
          agentId: "draft-review",
          draftId: "draft-review",
        }),
      ),
    ).toBeUndefined();
  });

  it("keeps the review as a draft on Command-click on macOS", () => {
    openReviewChat({
      serverId: "server-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
      text: "Review these changes",
      provider: "codex",
      model: "gpt-5",
      event: { ctrlKey: false, metaKey: true },
      shortcutOs: "mac",
      generateDraftId: () => "draft-review",
    });

    expect(useCreateFlowStore.getState().pendingByDraftId["draft-review"]).toBeUndefined();
    expect(
      useWorkspaceDraftSubmissionStore.getState().pendingByDraftId["draft-review"],
    ).toBeUndefined();
    expect(
      useDraftStore.getState().getDraftInput(
        buildDraftStoreKey({
          serverId: "server-1",
          agentId: "draft-review",
          draftId: "draft-review",
        }),
      ),
    ).toEqual({ text: "Review these changes", attachments: [] });
  });

  it("keeps the review as a draft on Ctrl-click outside macOS", () => {
    openReviewChat({
      serverId: "server-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
      text: "Review these changes",
      provider: "",
      model: "",
      event: { ctrlKey: true, metaKey: false },
      shortcutOs: "non-mac",
      generateDraftId: () => "draft-review",
    });

    expect(useCreateFlowStore.getState().pendingByDraftId["draft-review"]).toBeUndefined();
    expect(
      useDraftStore.getState().getDraftInput(
        buildDraftStoreKey({
          serverId: "server-1",
          agentId: "draft-review",
          draftId: "draft-review",
        }),
      ),
    ).toEqual({ text: "Review these changes", attachments: [] });
  });
});
