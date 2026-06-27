import { test, expect } from "@playwright/test";
import { rowWith, dialog, confirmDialog, uniqueName } from "./helpers/jit";

/**
 * JIT policy management: create-form validation, creation, search filtering,
 * editing, and deletion. Creates and cleans up its own policy.
 */
test.describe.serial("JIT policies", () => {
  const policyName = uniqueName("e2e-pol");
  const RESOURCE = /jit-test-res/;

  test("the create form requires a name and a resource", async ({ page }) => {
    await page.goto("/jit/policies");
    await page.getByRole("button", { name: "Create JIT policy" }).click();

    const d = dialog(page);
    const submit = d.getByRole("button", { name: "Create JIT policy" });
    await expect(submit).toBeDisabled(); // nothing filled yet

    await d.getByPlaceholder("e.g. Prod database (break-glass)").fill(policyName);
    await expect(submit).toBeDisabled(); // name alone is not enough — needs a resource

    await d.getByRole("button", { name: RESOURCE }).click();
    await expect(submit).toBeEnabled(); // name + resource → valid
  });

  test("creates a policy and shows it with the right summary", async ({ page }) => {
    await page.goto("/jit/policies");
    await page.getByRole("button", { name: "Create JIT policy" }).click();

    const d = dialog(page);
    await d.getByPlaceholder("e.g. Prod database (break-glass)").fill(policyName);
    await d.getByRole("button", { name: RESOURCE }).click();
    await d.getByRole("button", { name: "Create JIT policy" }).click({ force: true });

    const row = rowWith(page, policyName);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Anyone"); // default "who can request"
  });

  test("search filters the policy list", async ({ page }) => {
    await page.goto("/jit/policies");
    await expect(rowWith(page, policyName)).toBeVisible();

    await page.getByPlaceholder("Search...").fill("zzz-no-such-policy");
    await expect(rowWith(page, policyName)).toHaveCount(0);

    await page.getByPlaceholder("Search...").fill(policyName);
    await expect(rowWith(page, policyName)).toBeVisible();
  });

  test("edits the policy max duration", async ({ page }) => {
    await page.goto("/jit/policies");
    await rowWith(page, policyName).getByRole("button", { name: "Edit" }).click({ force: true });

    const d = dialog(page);
    const duration = d.locator('input[type="number"]');
    await duration.fill("30");
    await d.getByRole("button", { name: /save|update/i }).click({ force: true });

    await expect(rowWith(page, policyName)).toContainText(/30m|30 min/i);
  });

  test("deletes the policy (cleanup)", async ({ page }) => {
    await page.goto("/jit/policies");
    await rowWith(page, policyName).getByRole("button", { name: "Delete" }).click({ force: true });
    await confirmDialog(page);
    await expect(rowWith(page, policyName)).toHaveCount(0);
  });
});
