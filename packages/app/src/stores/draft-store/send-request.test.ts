import { beforeEach, describe, expect, it } from "vitest";
import { useDraftStore } from "./index";

const draftKey = "draft:send-request";

describe("a draft's send request", () => {
  beforeEach(() => {
    useDraftStore.setState({
      drafts: {},
      sendRequestByDraftKey: {},
      sendTargetCountByDraftKey: {},
    });
  });

  it("is refused when no composer shows the draft", () => {
    expect(useDraftStore.getState().requestDraftSend({ draftKey, text: "Review" })).toBe(false);
    expect(useDraftStore.getState().sendRequestByDraftKey[draftKey]).toBeUndefined();
  });

  it("waits for the mounted composer and leaves the draft text alone", () => {
    const store = useDraftStore.getState();
    store.registerSendTarget({ draftKey });
    store.editDraftText({ draftKey, text: "half typed" });

    expect(store.requestDraftSend({ draftKey, text: "Review the changes" })).toBe(true);
    const state = useDraftStore.getState();
    expect(state.sendRequestByDraftKey[draftKey]?.text).toBe("Review the changes");
    expect(state.getDraftInput(draftKey)?.text).toBe("half typed");
  });

  it("is dropped when the last composer unmounts, so a later mount does not send it", () => {
    const store = useDraftStore.getState();
    const unregisterFirst = store.registerSendTarget({ draftKey });
    const unregisterSecond = store.registerSendTarget({ draftKey });
    store.requestDraftSend({ draftKey, text: "Review" });

    unregisterFirst();
    expect(useDraftStore.getState().sendRequestByDraftKey[draftKey]?.text).toBe("Review");
    unregisterSecond();
    expect(useDraftStore.getState().sendRequestByDraftKey[draftKey]).toBeUndefined();
    expect(useDraftStore.getState().requestDraftSend({ draftKey, text: "Again" })).toBe(false);
  });

  it("is consumed once, and a stale id does not drop a newer request", () => {
    const store = useDraftStore.getState();
    store.registerSendTarget({ draftKey });
    store.requestDraftSend({ draftKey, text: "first" });
    const first = useDraftStore.getState().sendRequestByDraftKey[draftKey];
    store.requestDraftSend({ draftKey, text: "second" });

    store.consumeDraftSend({ draftKey, id: first?.id ?? -1 });
    const second = useDraftStore.getState().sendRequestByDraftKey[draftKey];
    expect(second?.text).toBe("second");

    store.consumeDraftSend({ draftKey, id: second?.id ?? -1 });
    expect(useDraftStore.getState().sendRequestByDraftKey[draftKey]).toBeUndefined();
  });
});
