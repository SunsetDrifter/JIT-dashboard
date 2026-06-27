import { test, expect } from "@playwright/test";
import { rowWith, dialog, confirmDialog, uniqueName } from "./helpers/jit";

/**
 * The full JIT access lifecycle through the real UI + jit-service + NetBird:
 * create a policy → request access → approve → see the active grant → revoke →
 * delete the policy. Runs serially; each step depends on the previous.
 *
 * Requires the jit-service to allow self-approval (JIT_ALLOW_SELF_APPROVAL=true)
 * so a single admin login can both request and approve.
 */
test.describe.serial("JIT access lifecycle", () => {
  const policyName = uniqueName("e2e-life");
  const RESOURCE = /jit-test-res/; // a network resource present in the local env

  test("admin creates a JIT policy targeting a resource", async ({ page }) => {
    await page.goto("/jit/policies");
    await page.getByRole("button", { name: "Create JIT policy" }).click();

    const d = dialog(page);
    await d.getByPlaceholder("e.g. Prod database (break-glass)").fill(policyName);
    await d.getByRole("button", { name: RESOURCE }).click(); // select the resource
    // Default max duration (240) and "anyone can request" are fine.
    await d.getByRole("button", { name: "Create JIT policy" }).click({ force: true });

    await expect(rowWith(page, policyName)).toBeVisible();
  });

  test("user requests access; it appears as pending", async ({ page }) => {
    await page.goto("/jit/request");
    const card = page.locator("div.rounded-md.border", { hasText: policyName });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Request" }).click();

    const d = dialog(page);
    await d.getByPlaceholder("Why do you need this access?").fill("e2e: automated lifecycle test");
    await d.getByRole("button", { name: "Submit request" }).click({ force: true });

    // "My requests" now shows a pending row for this policy.
    await expect(rowWith(page, policyName).filter({ hasText: /pending/i })).toBeVisible();
  });

  test("admin approves the request → active grant", async ({ page }) => {
    await page.goto("/jit/approvals"); // defaults to the Pending tab
    const pendingRow = rowWith(page, policyName);
    await expect(pendingRow).toBeVisible();
    await pendingRow.getByRole("button", { name: "Approve" }).click({ force: true });

    // Switch to Active grants and confirm the grant is now active.
    await page.getByRole("button", { name: /active grants/i }).click();
    await expect(rowWith(page, policyName)).toBeVisible();
  });

  test("admin revokes the active grant", async ({ page }) => {
    await page.goto("/jit/approvals");
    await page.getByRole("button", { name: /active grants/i }).click();
    const activeRow = rowWith(page, policyName);
    await expect(activeRow).toBeVisible();
    await activeRow.getByRole("button", { name: "Revoke" }).click({ force: true });
    await confirmDialog(page);

    await expect(rowWith(page, policyName)).toHaveCount(0);
  });

  test("admin deletes the JIT policy (cleanup)", async ({ page }) => {
    await page.goto("/jit/policies");
    const policyRow = rowWith(page, policyName);
    await expect(policyRow).toBeVisible();
    await policyRow.getByRole("button", { name: "Delete" }).click({ force: true });
    await confirmDialog(page);

    await expect(rowWith(page, policyName)).toHaveCount(0);
  });
});
