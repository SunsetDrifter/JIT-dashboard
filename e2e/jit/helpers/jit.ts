import { expect, type Page, type Locator } from "@playwright/test";
import * as path from "path";

export const STORAGE_STATE = path.join(__dirname, "..", ".auth", "jack.json");

/** Dashboard admin login, from env so no secret is committed. */
export function creds(): { username: string; password: string } {
  const username = process.env.JIT_E2E_USER;
  const password = process.env.JIT_E2E_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "JIT e2e needs a dashboard admin login: set JIT_E2E_USER and JIT_E2E_PASSWORD.",
    );
  }
  return { username, password };
}

/** Drive the NetBird embedded-IdP login form and wait for the dashboard shell. */
export async function login(page: Page): Promise<void> {
  const { username, password } = creds();
  await page.goto("/");
  await page.locator("#login").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#submit-login").click();
  await page.waitForURL((u) => !u.toString().includes("/oauth2/"), { timeout: 30_000 });
  await expect(page.getByTestId("user-dropdown")).toBeVisible({ timeout: 30_000 });
}

/** A data-table row (or any <tr>) containing the given text. */
export const rowWith = (page: Page, text: string): Locator =>
  page.locator("tr", { hasText: text });

/** The currently open modal dialog. */
export const dialog = (page: Page): Locator => page.getByRole("dialog");

/** Confirm a danger/warning confirmation dialog (Delete / Revoke / End / Cancel). */
export async function confirmDialog(page: Page): Promise<void> {
  await page.getByTestId("confirmation.confirm").click({ force: true });
}

/** Unique, collision-proof policy name for a test run. */
export const uniqueName = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
