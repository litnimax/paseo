import { writeFile } from "node:fs/promises";
import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const APP_SETTINGS_KEY = "@paseo:app-settings";
const REVIEW_PROMPT = "Review this worktree for release-blocking bugs.";

test("Review changes opens a clean draft with the configured model", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "review-action-",
    title: "Existing chat",
  });

  try {
    await writeFile(`${workspace.cwd}/review-me.ts`, "export const needsReview = true;\n");
    await workspace.client.checkoutRefresh(workspace.cwd);
    await page.addInitScript(
      ({ settingsKey, reviewPrompt }) => {
        localStorage.setItem(
          settingsKey,
          JSON.stringify({
            reviewPrompt,
            reviewModelProvider: "mock",
            reviewModelId: "ten-second-stream",
          }),
        );
      },
      { settingsKey: APP_SETTINGS_KEY, reviewPrompt: REVIEW_PROMPT },
    );

    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    const composer = page
      .locator("textarea[data-composer-input]")
      .filter({ visible: true })
      .first();
    await expect(composer).toBeEditable({ timeout: 30_000 });
    await composer.fill("Keep this existing draft");

    await expect(page.getByTestId("changes-primary-cta-caret")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("changes-primary-cta-caret").click();
    await page.getByTestId("changes-menu-review").click();

    const reviewComposer = page
      .locator("textarea[data-composer-input]")
      .filter({ visible: true })
      .first();
    await expect(reviewComposer).toHaveValue(REVIEW_PROMPT);
    await expect(page.locator('[data-testid^="workspace-tab-draft_"]')).toBeVisible();
    await expect(
      page.getByTestId("combined-model-selector").filter({ visible: true }),
    ).toContainText("Ten second stream");

    await page.getByTestId(`workspace-tab-agent_${workspace.agentId}`).click();
    await expect(composer).toHaveValue("Keep this existing draft");
  } finally {
    await workspace.cleanup();
  }
});
