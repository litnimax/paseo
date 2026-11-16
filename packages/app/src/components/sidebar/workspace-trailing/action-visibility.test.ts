import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { resolveTrailingActionVisibility } from "./action-visibility";

const workspace = { diffStat: null, statusEnteredAt: null } as SidebarWorkspaceEntry;

function showArchiveButton(
  overrides: Partial<Parameters<typeof resolveTrailingActionVisibility>[0]>,
): boolean {
  return resolveTrailingActionVisibility({
    workspace,
    trailing: "none",
    hasArchiveAction: true,
    archiveButtonEnabled: true,
    isHovered: true,
    isTouchPlatform: false,
    showShortcut: false,
    ...overrides,
  }).showArchiveButton;
}

describe("resolveTrailingActionVisibility archive button", () => {
  it("shows on a hovered pointer row when the preference is on", () => {
    expect(showArchiveButton({})).toBe(true);
  });

  it.each([
    ["the preference is off", { archiveButtonEnabled: false }],
    ["the row is not hovered", { isHovered: false }],
    ["the row is touch-driven", { isTouchPlatform: true }],
    ["a shortcut badge holds the slot", { showShortcut: true }],
    ["the row cannot be archived", { hasArchiveAction: false }],
  ])("hides when %s", (_label, overrides) => {
    expect(showArchiveButton(overrides)).toBe(false);
  });

  it("keeps the kebab when the preference is off", () => {
    const visibility = resolveTrailingActionVisibility({
      workspace,
      trailing: "none",
      hasArchiveAction: true,
      archiveButtonEnabled: false,
      isHovered: true,
      isTouchPlatform: false,
      showShortcut: false,
    });
    expect(visibility.showKebab).toBe(true);
    expect(visibility.showScrim).toBe(true);
  });
});
