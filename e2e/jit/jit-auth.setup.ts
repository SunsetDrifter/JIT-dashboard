import { test as setup } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { login, STORAGE_STATE } from "./helpers/jit";

// Logs in once and saves the session so the specs run pre-authenticated.
setup("authenticate", async ({ page }) => {
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await login(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
