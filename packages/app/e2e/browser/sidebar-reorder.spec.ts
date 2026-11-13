import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { clickSettingsBackToWorkspace, openSettingsHostSection } from "../support/helpers/settings";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  pinWorkspaceIntoFolderFromSidebar,
  selectSidebarStatusGrouping,
} from "../support/helpers/sidebar";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

async function rowTestIds(rows: Locator) {
  return rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid")),
  );
}

async function visibleBoundingBox(row: Locator) {
  const box = await row.boundingBox();
  if (!box) throw new Error("Expected a visible draggable row");
  return box;
}

async function pressProjectRow(rows: Locator) {
  await rows.page().mouse.down();
}

async function pressWorkspaceRow(rows: Locator) {
  const solidScrimStop = rows
    .nth(0)
    .getByTestId("sidebar-workspace-trailing-scrim")
    .locator("stop")
    .nth(1);
  const hoverScrimColor = await solidScrimStop.getAttribute("stop-color");
  await rows.page().mouse.down();
  await expect.poll(() => solidScrimStop.getAttribute("stop-color")).not.toBe(hoverScrimColor);
}

async function quickDragFirstRowAfterSecond(
  rows: Locator,
  pressRow: (rows: Locator) => Promise<void>,
) {
  await expect(rows).toHaveCount(2);
  const before = await rowTestIds(rows);
  const sourceBox = await visibleBoundingBox(rows.nth(0));
  const targetBox = await visibleBoundingBox(rows.nth(1));

  const page = rows.page();
  const source = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const target = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };

  await page.mouse.move(source.x, source.y);
  const trailingScrim = rows.nth(0).getByTestId("sidebar-workspace-trailing-scrim");
  await pressRow(rows);
  await page.mouse.move(source.x, source.y + 7);
  await expect(trailingScrim).toHaveCount(0);
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await finishSidebarDrag(page);

  await expect.poll(() => rowTestIds(rows)).toEqual([before[1], before[0]]);
}

async function finishSidebarDrag(page: Page): Promise<void> {
  await page.mouse.up();
  // dnd-kit's pointer sensor keeps its document click blocker for 50 ms after drop.
  // Row order updates before that blocker is removed; wait before the next user action.
  await page.waitForTimeout(60);
}

async function dragWithoutReordering(rows: Locator): Promise<void> {
  const before = await rowTestIds(rows);
  const source = await visibleBoundingBox(rows.nth(0));
  const target = await visibleBoundingBox(rows.nth(1));
  const page = rows.page();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await finishSidebarDrag(page);
  await expect.poll(() => rowTestIds(rows)).toEqual(before);
}

test("projects and pinned chats reorder while ordinary workspaces stay newest first", async ({
  page,
}) => {
  const firstProject = await seedWorkspace({ repoPrefix: "sidebar-reorder-first-" });
  const secondProject = await seedWorkspace({ repoPrefix: "sidebar-reorder-second-" });

  try {
    const secondWorkspace = await firstProject.client.createWorkspace({
      source: {
        kind: "directory",
        path: firstProject.repoPath,
        projectId: firstProject.projectId,
      },
      title: "Second workspace",
    });
    if (!secondWorkspace.workspace) {
      throw new Error(secondWorkspace.error ?? "Failed to seed a second workspace");
    }

    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    const firstProjectTestId = `sidebar-project-row-${projectEquivalenceViewKey(firstProject.projectKey)}`;
    const secondProjectTestId = `sidebar-project-row-${projectEquivalenceViewKey(secondProject.projectKey)}`;
    await quickDragFirstRowAfterSecond(
      page.locator(`[data-testid="${firstProjectTestId}"], [data-testid="${secondProjectTestId}"]`),
      pressProjectRow,
    );
    const firstWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${firstProject.workspaceId}`;
    const secondWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${secondWorkspace.workspace.id}`;
    const ordinaryRows = page.locator(
      `[data-testid="${firstWorkspaceTestId}"], [data-testid="${secondWorkspaceTestId}"]`,
    );
    await expect
      .poll(() => rowTestIds(ordinaryRows))
      .toEqual([secondWorkspaceTestId, firstWorkspaceTestId]);
    await dragWithoutReordering(ordinaryRows);

    await firstProject.client.setWorkspacePinned(firstProject.workspaceId, true);
    await secondProject.client.setWorkspacePinned(secondProject.workspaceId, true);
    const secondProjectWorkspaceTestId = `sidebar-workspace-row-${getServerId()}:${secondProject.workspaceId}`;
    await quickDragFirstRowAfterSecond(
      page.locator(
        `[data-testid="${firstWorkspaceTestId}"], [data-testid="${secondProjectWorkspaceTestId}"]`,
      ),
      pressWorkspaceRow,
    );
  } finally {
    await firstProject.cleanup();
    await secondProject.cleanup();
  }
});

async function selectWorkspaceSort(page: Page, name: "Manual" | "Created" | "Last prompt") {
  await page.getByLabel("Display preferences", { exact: true }).click();
  await page.getByRole("menuitem", { name: /^Sort/ }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function reconnectSidebar(page: Page): Promise<void> {
  await page.reload();
  await waitForSidebarHydration(page);
}

async function expectNoWorkspaceSortChoice(page: Page): Promise<void> {
  await page.getByLabel("Display preferences", { exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Sort/ })).toHaveCount(0);
}

async function promptWorkspace(seed: Awaited<ReturnType<typeof seedWorkspace>>, agentId: string) {
  await seed.client.sendAgentMessage(agentId, "sidebar ordering check");
  expect((await seed.client.waitForFinish(agentId, 30_000)).status).toBe("idle");
}

test("Created stays stable, Last prompt follows human submissions and survives tab archive", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seed = await seedWorkspace({ repoPrefix: "sidebar-sort-" });
  try {
    const newer = await seed.client.createWorkspace({
      source: { kind: "directory", path: seed.repoPath, projectId: seed.projectId },
      title: "Newer workspace",
    });
    if (!newer.workspace) throw new Error(newer.error ?? "Workspace creation failed");
    const agent = await seed.client.createAgent({
      provider: "mock",
      cwd: seed.repoPath,
      workspaceId: seed.workspaceId,
      modeId: "load-test",
      model: "e2e-fast-stream",
      title: "Ordering agent",
    });
    const newerAgent = await seed.client.createAgent({
      provider: "mock",
      cwd: seed.repoPath,
      workspaceId: newer.workspace.id,
      modeId: "load-test",
      model: "e2e-fast-stream",
      title: "Newer agent",
    });
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    const oldId = `sidebar-workspace-row-${getServerId()}:${seed.workspaceId}`;
    const newId = `sidebar-workspace-row-${getServerId()}:${newer.workspace.id}`;
    const rows = page.locator(`[data-testid="${oldId}"], [data-testid="${newId}"]`);
    await expect.poll(() => rowTestIds(rows)).toEqual([newId, oldId]);
    await promptWorkspace(seed, agent.id);
    await expect.poll(() => rowTestIds(rows)).toEqual([newId, oldId]);
    await selectWorkspaceSort(page, "Last prompt");
    await expect.poll(() => rowTestIds(rows)).toEqual([oldId, newId]);
    await promptWorkspace(seed, newerAgent.id);
    await expect.poll(() => rowTestIds(rows)).toEqual([newId, oldId]);
    await promptWorkspace(seed, agent.id);
    await expect.poll(() => rowTestIds(rows)).toEqual([oldId, newId]);
    await seed.client.archiveAgent(agent.id);
    await expect.poll(() => rowTestIds(rows)).toEqual([oldId, newId]);
    await reconnectSidebar(page);
    await expect.poll(() => rowTestIds(rows)).toEqual([oldId, newId]);
    await selectWorkspaceSort(page, "Created");
    await expect.poll(() => rowTestIds(rows)).toEqual([newId, oldId]);
    await selectSidebarStatusGrouping(page);
    await expectNoWorkspaceSortChoice(page);
  } finally {
    await seed.cleanup();
  }
});

async function seedCompactProject() {
  const seed = await seedWorkspace({
    repoPrefix: "sidebar-visibility-",
    title: "Oldest workspace",
  });
  const ids = [seed.workspaceId];
  for (let index = 2; index <= 12; index += 1) {
    const created = await seed.client.createWorkspace({
      source: { kind: "directory", path: seed.repoPath, projectId: seed.projectId },
      title: `Workspace ${index}`,
    });
    if (!created.workspace) throw new Error(created.error ?? "Workspace creation failed");
    ids.unshift(created.workspace.id);
  }
  const agent = await seed.client.createAgent({
    provider: "mock",
    model: "e2e-fast-stream",
    modeId: "load-test",
    cwd: seed.repoPath,
    workspaceId: seed.workspaceId,
    title: "Overflow agent",
  });
  return { seed, ids, agent };
}

async function expectWorkspaceOrder(rows: Locator, ids: string[]) {
  await expect
    .poll(() => rowTestIds(rows))
    .toEqual(ids.map((id) => `sidebar-workspace-row-${getServerId()}:${id}`));
}

async function revealWorkspaces(list: Locator, action: "Show more" | "Show less") {
  await list.getByLabel(action, { exact: true }).click();
}

async function selectProjectGrouping(page: Page) {
  await page.getByLabel("Display preferences", { exact: true }).click();
  await page.getByRole("menuitem", { name: /^Group/ }).click();
  await page.getByTestId("sidebar-grouping-project").click();
}

type CompactProject = Awaited<ReturnType<typeof seedCompactProject>>;

function compactProjectRows(page: Page, seed: CompactProject["seed"]) {
  const list = page.getByTestId(`sidebar-workspace-list-${seed.projectKey}`);
  return {
    rows: list.locator('[data-testid^="sidebar-workspace-row-"]'),
    group: list.locator(".."),
    project: page.getByTestId(`sidebar-project-row-${projectEquivalenceViewKey(seed.projectKey)}`),
  };
}

async function expectActiveOverflowTransitions(page: Page, { seed, ids, agent }: CompactProject) {
  const { rows } = compactProjectRows(page, seed);
  await expectWorkspaceOrder(rows, ids.slice(0, 7));

  await seed.client.sendAgentMessage(agent.id, "show active overflow");
  await expectWorkspaceOrder(rows, [...ids.slice(0, 7), ids[11]]);
  await seed.client.waitForFinish(agent.id, 15_000);
  await expectWorkspaceOrder(rows, [...ids.slice(0, 7), ids[11]]);
  await seed.client.clearWorkspaceAttention(seed.workspaceId);
  await expectWorkspaceOrder(rows, ids.slice(0, 7));
}

async function expectRevealSurvivesSortingAndCollapse(
  page: Page,
  { seed, ids, agent }: CompactProject,
) {
  const { rows, group, project } = compactProjectRows(page, seed);
  const retainedRows = await rows.elementHandles();
  await revealWorkspaces(group, "Show more");
  await expectWorkspaceOrder(rows, ids);
  for (const [index, retained] of retainedRows.entries()) {
    expect(
      await rows.nth(index).evaluate((current, previous) => current === previous, retained),
    ).toBe(true);
  }
  await project.click();
  await expect(rows).toHaveCount(0);
  await project.click();
  await expectWorkspaceOrder(rows, ids);
  await seed.client.sendAgentMessage(agent.id, "expanded overflow");
  await seed.client.waitForFinish(agent.id, 15_000);
  await seed.client.clearWorkspaceAttention(seed.workspaceId);
  await expectWorkspaceOrder(rows, ids);
  await selectWorkspaceSort(page, "Last prompt");
  await expectWorkspaceOrder(rows, [ids[11], ...ids.slice(0, 11)]);
  const revealedRow = await rows.nth(8).elementHandle();
  await revealWorkspaces(group, "Show less");
  await expectWorkspaceOrder(rows, [ids[11], ...ids.slice(0, 6)]);
  await selectWorkspaceSort(page, "Created");
  await expectWorkspaceOrder(rows, ids.slice(0, 7));
  expect(await revealedRow!.evaluate((row) => row.isConnected)).toBe(false);
  await reconnectSidebar(page);
  await expectWorkspaceOrder(rows, ids.slice(0, 7));
}

async function expectStatusBucketsRetainActiveOverflow(
  page: Page,
  { seed, ids, agent }: CompactProject,
) {
  const { rows } = compactProjectRows(page, seed);
  await selectSidebarStatusGrouping(page);
  const done = page.getByTestId("sidebar-status-group-rows-done");
  const doneRows = done.locator('[data-testid^="sidebar-workspace-row-"]');
  await expect(doneRows).toHaveCount(7);
  await revealWorkspaces(done, "Show more");
  await expect(doneRows).toHaveCount(12);
  await seed.client.sendAgentMessage(agent.id, "status overflow");
  await seed.client.waitForFinish(agent.id, 15_000);
  await expect(
    page
      .getByTestId("sidebar-status-group-rows-attention")
      .getByText("Oldest workspace", { exact: true }),
  ).toBeVisible();
  await expect(doneRows).toHaveCount(11);
  await seed.client.clearWorkspaceAttention(seed.workspaceId);
  await expect(doneRows).toHaveCount(12);
  await revealWorkspaces(done, "Show less");
  await expect(doneRows).toHaveCount(7);
  const activeAgents: Array<{ id: string }> = [];
  for (const workspaceId of ids.slice(0, 8)) {
    activeAgents.push(
      await seed.client.createAgent({
        provider: "mock",
        model: "e2e-fast-stream",
        modeId: "load-test",
        cwd: seed.repoPath,
        workspaceId,
        title: "Active overflow agent",
      }),
    );
  }
  await Promise.all(
    activeAgents.map((item) => seed.client.sendAgentMessage(item.id, "active bucket")),
  );
  await Promise.all(activeAgents.map((item) => seed.client.waitForFinish(item.id, 15_000)));
  const attention = page.getByTestId("sidebar-status-group-rows-attention");
  await expect(attention.locator('[data-testid^="sidebar-workspace-row-"]')).toHaveCount(8);
  await expect(attention.getByLabel("Show more", { exact: true })).toHaveCount(0);
  for (const workspaceId of ids.slice(0, 8)) await seed.client.clearWorkspaceAttention(workspaceId);
  await expect(doneRows).toHaveCount(7);
  await selectProjectGrouping(page);
  await expectWorkspaceOrder(rows, ids.slice(0, 7));
}

test("compact groups retain active overflow and reveal the current ordered rows", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await seedCompactProject();
  try {
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await test.step("Active overflow appears without intervening Done rows", () =>
      expectActiveOverflowTransitions(page, fixture));
    await test.step("Reveal follows current sort and survives collapse", () =>
      expectRevealSurvivesSortingAndCollapse(page, fixture));
    await test.step("Status reveals Done rows and keeps every active row", () =>
      expectStatusBucketsRetainActiveOverflow(page, fixture));
  } finally {
    await fixture.seed.cleanup();
  }
});

async function restorePreBetaOrder(page: Page, projectKey: string, workspaceKeys: string[]) {
  await page.evaluate(
    ({ projectKey: scope, workspaceKeys: order }) => {
      localStorage.setItem(
        "sidebar-project-workspace-order",
        JSON.stringify({
          version: 1,
          state: {
            projectOrder: [scope],
            pinnedWorkspaceOrder: [],
            workspaceOrderByProject: { [scope]: order },
          },
        }),
      );
    },
    { projectKey, workspaceKeys },
  );
  await reconnectSidebar(page);
}

test("Manual restores pre-beta order and keeps drag order across sorting and reloads", async ({
  page,
}) => {
  const seed = await seedWorkspace({ repoPrefix: "sidebar-manual-" });
  try {
    const second = await seed.client.createWorkspace({
      source: { kind: "directory", path: seed.repoPath, projectId: seed.projectId },
      title: "New manual workspace",
    });
    if (!second.workspace) throw new Error(second.error ?? "Workspace creation failed");
    const keys = [seed.workspaceId, second.workspace.id].map((id) => `${getServerId()}:${id}`);
    const ids = keys.map((key) => `sidebar-workspace-row-${key}`);
    const rows = page.locator(ids.map((id) => `[data-testid="${id}"]`).join(", "));
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await restorePreBetaOrder(page, projectEquivalenceViewKey(seed.projectKey), keys);
    await expect.poll(() => rowTestIds(rows)).toEqual([ids[1], ids[0]]);
    await selectWorkspaceSort(page, "Manual");
    await expect.poll(() => rowTestIds(rows)).toEqual(ids);
    await selectWorkspaceSort(page, "Created");
    await expect.poll(() => rowTestIds(rows)).toEqual([ids[1], ids[0]]);
    await selectWorkspaceSort(page, "Last prompt");
    await selectWorkspaceSort(page, "Manual");
    await expect.poll(() => rowTestIds(rows)).toEqual(ids);
    await quickDragFirstRowAfterSecond(rows, pressWorkspaceRow);
    await reconnectSidebar(page);
    await expect.poll(() => rowTestIds(rows)).toEqual([ids[1], ids[0]]);
    await quickDragFirstRowAfterSecond(rows, pressWorkspaceRow);
    await selectWorkspaceSort(page, "Created");
    await reconnectSidebar(page);
    await selectWorkspaceSort(page, "Manual");
    await expect.poll(() => rowTestIds(rows)).toEqual(ids);
  } finally {
    await seed.cleanup();
  }
});

function workspaceRows(page: Page, ids: string[]) {
  return page.locator(
    ids.map((id) => `[data-testid="sidebar-workspace-row-${getServerId()}:${id}"]`).join(", "),
  );
}

async function openWorkspaceRow(page: Page, workspaceId: string) {
  await page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${workspaceId}`));
}

test("collapsed groups lead with the open workspace instead of hiding it behind Show more", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { seed, ids } = await seedCompactProject();
  try {
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await selectWorkspaceSort(page, "Created");
    const { rows, group } = compactProjectRows(page, seed);
    await expectWorkspaceOrder(rows, ids.slice(0, 7));
    await revealWorkspaces(group, "Show more");
    await openWorkspaceRow(page, ids[9]!);
    await expectWorkspaceOrder(rows, ids);
    await revealWorkspaces(group, "Show less");
    await expectWorkspaceOrder(rows, [ids[9]!, ...ids.slice(0, 7)]);
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${ids[9]!}`),
    ).toHaveAttribute("aria-selected", "true");
    await reconnectSidebar(page);
    await expectWorkspaceOrder(rows, [ids[9]!, ...ids.slice(0, 7)]);
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${ids[9]!}`),
    ).toHaveAttribute("aria-selected", "true");
    await openWorkspaceRow(page, ids[2]!);
    await expectWorkspaceOrder(rows, ids.slice(0, 7));
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${ids[2]!}`),
    ).toHaveAttribute("aria-selected", "true");
  } finally {
    await seed.cleanup();
  }
});

test("a Manual drag in a collapsed group keeps the open workspace's saved place", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { seed, ids } = await seedCompactProject();
  try {
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    const projectKey = projectEquivalenceViewKey(seed.projectKey);
    await restorePreBetaOrder(
      page,
      projectKey,
      ids.map((id) => `${getServerId()}:${id}`),
    );
    await selectWorkspaceSort(page, "Manual");
    const rows = workspaceRows(page, ids);
    const toggle = page.getByTestId(`sidebar-project-show-more-${projectKey}`);
    await expectWorkspaceOrder(rows, ids.slice(0, 7));
    await toggle.click();
    await openWorkspaceRow(page, ids[9]!);
    await toggle.click();
    await expectWorkspaceOrder(rows, [ids[9]!, ...ids.slice(0, 7)]);
    await quickDragFirstRowAfterSecond(workspaceRows(page, [ids[0]!, ids[1]!]), pressWorkspaceRow);
    await expectWorkspaceOrder(rows, [ids[9]!, ids[1]!, ids[0]!, ...ids.slice(2, 7)]);
    await reconnectSidebar(page);
    await expectWorkspaceOrder(rows, [ids[9]!, ids[1]!, ids[0]!, ...ids.slice(2, 7)]);
    await toggle.click();
    await expectWorkspaceOrder(rows, [ids[1]!, ids[0]!, ...ids.slice(2)]);
  } finally {
    await seed.cleanup();
  }
});

let folderCounter = 0;

function uniqueFolderName(base: string): string {
  folderCounter += 1;
  return `${base} ${Date.now().toString(36)}${folderCounter}`;
}

type SeedClient = Awaited<ReturnType<typeof seedWorkspace>>["client"];

/** Pinned folders outlive the test on the shared host; an empty one keeps the section on screen. */
async function removePinnedFolders(client: SeedClient, name: string): Promise<void> {
  const { document } = await client.listPinnedFolders();
  for (const folder of document.folders.filter((candidate) => candidate.name === name)) {
    await client.changePinnedFolder({ change: { kind: "delete", folderId: folder.id } });
  }
}

async function dragRowOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await visibleBoundingBox(source);
  const to = await visibleBoundingBox(target);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 7);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await finishSidebarDrag(page);
}

test("pins file into Pinned folders by drag and come back out on the Pinned header", async ({
  page,
}) => {
  const seed = await seedWorkspace({ repoPrefix: "sidebar-pinned-folders-" });
  // Folders live on the host, which outlasts each test, so every test names its own.
  const folderName = uniqueFolderName("Clients");
  try {
    const second = await seed.client.createWorkspace({
      source: { kind: "directory", path: seed.repoPath, projectId: seed.projectId },
      title: "Second pinned workspace",
    });
    if (!second.workspace) throw new Error(second.error ?? "Workspace creation failed");
    await seed.client.setWorkspacePinned(seed.workspaceId, true);
    await seed.client.setWorkspacePinned(second.workspace.id, true);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    const pinned = page.getByTestId("sidebar-pinned-section");
    const filed = pinned.getByTestId(`sidebar-workspace-row-${getServerId()}:${seed.workspaceId}`);
    const unfiled = pinned.getByTestId(
      `sidebar-workspace-row-${getServerId()}:${second.workspace.id}`,
    );
    await expect(filed).toBeVisible();

    await page.getByTestId("sidebar-pinned-new-folder").click();
    await page.getByTestId("sidebar-pinned-folder-name-modal-input").fill(folderName);
    await page.getByTestId("sidebar-pinned-folder-name-modal-submit").click();
    await expect(page.getByTestId("sidebar-pinned-folder-name-modal-input")).toBeHidden();
    const folder = pinned
      .locator('[data-testid^="sidebar-pinned-folder-pf_"]')
      .filter({ hasText: folderName });
    await expect(folder).toBeVisible();

    await dragRowOnto(page, filed, folder);
    await folder.click();
    await expect(filed).toHaveCount(0);
    await expect(unfiled).toBeVisible();
    // A collapsed folder counts its pins once the pointer leaves it.
    await page.mouse.move(700, 600);
    await expect(folder.locator("..").getByText("1", { exact: true })).toBeVisible();

    // The tree and the filing come from the host, not this browser: a client with nothing
    // stored sees the pin in its folder.
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await waitForSidebarHydration(page);
    await expect(filed).toBeVisible();
    await folder.click();
    await expect(filed).toHaveCount(0);
    await expect(unfiled).toBeVisible();

    await folder.click();
    await dragRowOnto(page, filed, page.getByTestId("sidebar-pinned-section-header"));
    await folder.click();
    await expect(filed).toBeVisible();
  } finally {
    await removePinnedFolders(seed.client, folderName);
    await seed.cleanup();
  }
});

test("a handoff workspace nests under the workspace that created it and folds away", async ({
  page,
}) => {
  const seed = await seedWorkspace({ repoPrefix: "sidebar-handoff-tree-" });
  try {
    const agent = await seed.client.createAgent({
      provider: "mock",
      model: "e2e-fast-stream",
      modeId: "load-test",
      cwd: seed.repoPath,
      workspaceId: seed.workspaceId,
      title: "Handing off",
    });
    const handoff = await seed.client.createWorkspace({
      source: { kind: "directory", path: seed.repoPath, projectId: seed.projectId },
      title: "Handoff workspace",
      callerAgentId: agent.id,
    });
    if (!handoff.workspace) throw new Error(handoff.error ?? "Workspace creation failed");
    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    const parentKey = `${getServerId()}:${seed.workspaceId}`;
    const parentRow = page.getByTestId(`sidebar-workspace-row-${parentKey}`);
    const childRow = page.getByTestId(
      `sidebar-workspace-row-${getServerId()}:${handoff.workspace.id}`,
    );
    const rows = page.locator(
      `[data-testid="sidebar-workspace-row-${parentKey}"], [data-testid="sidebar-workspace-row-${getServerId()}:${handoff.workspace.id}"]`,
    );
    await expect
      .poll(() => rowTestIds(rows))
      .toEqual([
        `sidebar-workspace-row-${parentKey}`,
        `sidebar-workspace-row-${getServerId()}:${handoff.workspace.id}`,
      ]);
    const parentBox = await visibleBoundingBox(parentRow);
    const childBox = await visibleBoundingBox(childRow);
    expect(childBox.x).toBeGreaterThan(parentBox.x);

    const toggle = page.getByTestId(`sidebar-workspace-tree-toggle-${parentKey}`);
    await toggle.click();
    await expect(childRow).toHaveCount(0);
    await toggle.click();
    await expect(childRow).toBeVisible();

    // The chevron still folds while the handoff is the open workspace, and arriving at the
    // handoff from outside the sidebar opens its parent again.
    await childRow.click();
    await toggle.click();
    await expect(childRow).toHaveCount(0);
    await page.reload();
    await waitForSidebarHydration(page);
    await expect(childRow).toBeVisible();
  } finally {
    await seed.cleanup();
  }
});

test("Pin to top files straight into a folder, and pinned handoffs nest under their pinned parent", async ({
  page,
}) => {
  const seed = await seedWorkspace({ repoPrefix: "sidebar-pin-into-folder-" });
  // Folders live on the host, which outlasts each test, so every test names its own.
  const folderName = uniqueFolderName("Clients");
  try {
    const agent = await seed.client.createAgent({
      provider: "mock",
      model: "e2e-fast-stream",
      modeId: "load-test",
      cwd: seed.repoPath,
      workspaceId: seed.workspaceId,
      title: "Handing off",
    });
    const handoff = await seed.client.createWorkspace({
      source: { kind: "directory", path: seed.repoPath, projectId: seed.projectId },
      title: "Pinned handoff",
      callerAgentId: agent.id,
    });
    const loose = await seed.client.createWorkspace({
      source: { kind: "directory", path: seed.repoPath, projectId: seed.projectId },
      title: "Filed on pin",
    });
    if (!handoff.workspace || !loose.workspace) throw new Error("Workspace creation failed");
    await seed.client.setWorkspacePinned(seed.workspaceId, true);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    const pinned = page.getByTestId("sidebar-pinned-section");
    await page.getByTestId("sidebar-pinned-new-folder").click();
    await page.getByTestId("sidebar-pinned-folder-name-modal-input").fill(folderName);
    await page.getByTestId("sidebar-pinned-folder-name-modal-submit").click();
    await expect(page.getByTestId("sidebar-pinned-folder-name-modal-input")).toBeHidden();
    const folder = pinned
      .locator('[data-testid^="sidebar-pinned-folder-pf_"]')
      .filter({ hasText: folderName });

    await pinWorkspaceIntoFolderFromSidebar(page, loose.workspace.id, folderName);
    const looseRow = pinned.getByTestId(
      `sidebar-workspace-row-${getServerId()}:${loose.workspace.id}`,
    );
    await expect(looseRow).toBeVisible();
    await folder.click();
    await expect(looseRow).toHaveCount(0);

    await seed.client.setWorkspacePinned(handoff.workspace.id, true);
    const parentKey = `${getServerId()}:${seed.workspaceId}`;
    const childRow = pinned.getByTestId(
      `sidebar-workspace-row-${getServerId()}:${handoff.workspace.id}`,
    );
    await expect(childRow).toBeVisible();
    const toggle = pinned.getByTestId(`sidebar-workspace-tree-toggle-${parentKey}`);
    await toggle.click();
    await expect(childRow).toHaveCount(0);
    await toggle.click();
    await expect(childRow).toBeVisible();
  } finally {
    await removePinnedFolders(seed.client, folderName);
    await seed.cleanup();
  }
});

/** Picks who uses this device on the host, from its settings page, and comes back to the app. */
async function chooseTeamMember(page: Page, memberTestId: string): Promise<void> {
  await openSettings(page);
  await openSettingsHostSection(page, getServerId(), "host");
  await page.getByTestId(memberTestId).click();
  await clickSettingsBackToWorkspace(page);
}

async function saveOrRefreshView(page: Page, itemTestId: string): Promise<void> {
  await page.getByTestId("sidebar-display-preferences-menu").click();
  await page.getByTestId(itemTestId).click();
}

test("a team member's saved view comes back with Refresh view and when they are chosen", async ({
  page,
}) => {
  const seed = await seedWorkspace({ repoPrefix: "sidebar-saved-view-" });
  // Saved views live on the host per member; a member of its own keeps this test's view apart.
  const memberId = `max-${Date.now().toString(36)}`;
  const previousMembers = (await seed.client.getDaemonConfig()).config.teamMembers ?? [];
  await seed.client.patchDaemonConfig({
    teamMembers: [...previousMembers, { id: memberId, name: "Max", color: "sky" }],
  });
  const statusList = page.getByTestId("sidebar-status-list-scroll");
  try {
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await chooseTeamMember(page, `host-operator-${memberId}`);
    await expect(statusList).toHaveCount(0);

    await selectSidebarStatusGrouping(page);
    await expect(statusList).toBeVisible();
    await saveOrRefreshView(page, "sidebar-display-save-view");
    await expect(page.getByText("View saved for Max")).toBeVisible();

    await selectProjectGrouping(page);
    await expect(statusList).toHaveCount(0);
    await saveOrRefreshView(page, "sidebar-display-refresh-view");
    await expect(statusList).toBeVisible();

    // Choosing the member again, after this device stepped away from them, loads their view.
    await selectProjectGrouping(page);
    await expect(statusList).toHaveCount(0);
    await chooseTeamMember(page, "host-operator-unassigned");
    await chooseTeamMember(page, `host-operator-${memberId}`);
    await expect(statusList).toBeVisible({ timeout: 15_000 });
  } finally {
    await seed.client.patchDaemonConfig({ teamMembers: previousMembers }).catch(() => undefined);
    await seed.cleanup();
  }
});
