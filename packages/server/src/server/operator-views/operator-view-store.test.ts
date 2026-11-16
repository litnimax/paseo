import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  OPERATOR_VIEW_MAX_BYTES,
  OperatorViewConflictError,
  OperatorViewStore,
  OperatorViewTooLargeError,
} from "./operator-view-store.js";

let paseoHome: string;
let directory: string;

beforeEach(async () => {
  paseoHome = await mkdtemp(join(tmpdir(), "paseo-operator-views-"));
  directory = join(paseoHome, "operator-views");
});

afterEach(async () => {
  await rm(paseoHome, { recursive: true, force: true });
});

function clock(...instants: string[]): () => Date {
  let index = 0;
  return () => new Date(instants[Math.min(index++, instants.length - 1)] ?? 0);
}

async function onlyFile(): Promise<string> {
  const names = await readdir(directory);
  expect(names).toHaveLength(1);
  return join(directory, names[0]!);
}

test("each team member keeps their own view, and saving again advances its revision", async () => {
  const store = new OperatorViewStore({
    directory,
    now: clock("2026-11-13T10:00:00.000Z", "2026-11-13T11:00:00.000Z", "2026-11-13T12:00:00.000Z"),
  });

  expect(await store.get("max")).toBeNull();
  await store.save({ operatorId: "max", view: { grouping: "project" } });
  await store.save({ operatorId: "jurij", view: { grouping: "status" } });
  const saved = await store.save({
    operatorId: "max",
    view: { grouping: "status", sort: "manual" },
  });

  expect(saved).toEqual({
    view: { grouping: "status", sort: "manual" },
    revision: 2,
    savedAt: "2026-11-13T12:00:00.000Z",
  });
  const reopened = new OperatorViewStore({ directory });
  expect(await reopened.get("max")).toEqual(saved);
  expect((await reopened.get("jurij"))?.view).toEqual({ grouping: "status" });
});

test("keeps members whose ids differ only by case apart", async () => {
  const store = new OperatorViewStore({ directory });

  await store.save({ operatorId: "Max", view: { grouping: "project" } });
  await store.save({ operatorId: "max", view: { grouping: "status" } });

  expect((await store.get("Max"))?.view).toEqual({ grouping: "project" });
  expect((await store.get("max"))?.view).toEqual({ grouping: "status" });
  const names = (await readdir(directory)).map((name) => name.toLowerCase());
  expect(new Set(names).size).toBe(2);
});

test("refuses a view too large to be a set of preferences, measured as it is written", async () => {
  const store = new OperatorViewStore({ directory });
  let nested: unknown[] = [];
  for (let depth = 0; depth < 2000; depth += 1) nested = [nested];

  await expect(
    store.save({ operatorId: "max", view: { blob: "x".repeat(300_000) } }),
  ).rejects.toBeInstanceOf(OperatorViewTooLargeError);
  expect(await store.get("max")).toBeNull();

  await store.save({ operatorId: "max", view: { nested: nested as never } });
  expect((await readFile(await onlyFile(), "utf8")).length).toBeLessThanOrEqual(
    OPERATOR_VIEW_MAX_BYTES,
  );
});

test("a stored view that cannot be read counts as none and is replaced by the next save", async () => {
  const unreadable: string[] = [];
  const store = new OperatorViewStore({
    directory,
    onUnreadable: ({ operatorId }) => unreadable.push(operatorId),
  });
  await store.save({ operatorId: "max", view: { grouping: "project" } });
  await writeFile(await onlyFile(), "{ not json");

  expect(await store.get("max")).toBeNull();
  const saved = await store.save({ operatorId: "max", view: { grouping: "status" } });

  expect(unreadable).toEqual(["max", "max"]);
  expect(saved.revision).toBe(1);
  expect((await store.get("max"))?.view).toEqual({ grouping: "status" });
});

test("refuses a save based on a revision the host no longer holds", async () => {
  const store = new OperatorViewStore({ directory });
  await store.save({ operatorId: "max", view: { grouping: "project" }, baseRevision: 0 });
  await store.save({ operatorId: "max", view: { grouping: "status" }, baseRevision: 1 });

  await expect(
    store.save({ operatorId: "max", view: { grouping: "project" }, baseRevision: 1 }),
  ).rejects.toBeInstanceOf(OperatorViewConflictError);
  const overwritten = await store.save({ operatorId: "max", view: { sort: "manual" } });

  expect(overwritten).toMatchObject({ view: { sort: "manual" }, revision: 3 });
});

test("removes the views of people who are no longer team members", async () => {
  const store = new OperatorViewStore({ directory });
  await store.save({ operatorId: "max", view: { grouping: "project" } });
  await store.save({ operatorId: "left", view: { grouping: "status" } });
  await mkdir(directory, { recursive: true });

  await store.retainMembers(["max"]);

  expect(await store.get("left")).toBeNull();
  expect((await store.get("max"))?.view).toEqual({ grouping: "project" });
});

test("never turns a team member id into a path outside its directory", async () => {
  const store = new OperatorViewStore({ directory });

  await expect(
    store.save({ operatorId: "../escape", view: { grouping: "project" } }),
  ).rejects.toThrow(/Invalid team member id/);
});
