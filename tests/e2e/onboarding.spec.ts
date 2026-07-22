import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

test("empty public deployment presents accessible signer onboarding", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  await expect(page.getByText("Facet", { exact: true }).first()).toBeVisible();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  await expect(page.getByText("💠", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Make cross-client decisions from signed, shared evidence.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /connect a signer/i })).toBeEnabled();
  await expect(page.getByText(/visibility: public/i)).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  if (testInfo.project.name === "chromium") {
    await page.screenshot({ path: "test-results/onboarding-desktop.png", fullPage: true });
  }
});

test("extension signer completes the core board, matrix, and discussion flow", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The full mutation flow runs once on desktop.");
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  await page.exposeFunction("__facetSign", (template: Parameters<typeof finalizeEvent>[0]) =>
    finalizeEvent(template, secretKey),
  );
  await page.addInitScript((identity) => {
    const testWindow = window as typeof window & {
      __facetSign: (template: unknown) => Promise<unknown>;
      nostr: {
        getPublicKey: () => Promise<string>;
        signEvent: (template: unknown) => Promise<unknown>;
      };
    };
    testWindow.nostr = {
      getPublicKey: async () => identity,
      signEvent: async (template) => testWindow.__facetSign(template),
    };
  }, pubkey);

  await page.goto("/");
  await page.getByRole("button", { name: /connect a signer/i }).click();
  await page.getByRole("button", { name: /browser extension/i }).click();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await page.getByRole("button", { name: "Bootstrap deployment" }).click();
  await expect(page.getByRole("button", { name: "Create White Noise board" })).toBeVisible();
  await page.getByRole("button", { name: "Create White Noise board" }).click();

  await expect(page.getByRole("heading", { name: "Parity overview" })).toBeVisible();
  await page.getByRole("link", { name: "Administration" }).click();
  await page.getByRole("button", { name: "Seed White Noise subjects" }).click();
  await expect(page.getByText("Flutter", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Matrix" }).click();
  await expect(page.getByRole("heading", { name: "Capability matrix" })).toBeVisible();
  const subjectSelector = page.getByLabel("Selected comparison subject");
  await expect(subjectSelector).toBeVisible();
  await expect(page.locator("header").getByLabel("Selected comparison subject")).toHaveCount(0);
  expect(
    await subjectSelector.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThan(260);
  const columns = page.getByRole("button", { name: "Choose visible subject columns" });
  await expect(columns).toHaveText(/Columns 5\/5/);
  await columns.click();
  await page.getByLabel("Show Linux column").uncheck();
  await expect(page.getByRole("columnheader", { name: /Linux/ })).toHaveCount(0);
  await expect(columns).toHaveText(/Columns 4\/5/);
  await expect(columns).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Capability matrix" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Linux/ })).toHaveCount(0);
  await expect(columns).toHaveText(/Columns 4\/5/);
  await columns.click();
  await page.getByLabel("Show Linux column").check();
  await expect(page.getByRole("columnheader", { name: /Linux/ })).toBeVisible();
  await columns.click();
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
  await expect(page.getByLabel("Feature area filter")).toHaveCount(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByLabel("Feature area filter")).toBeVisible();
  await page.getByRole("button", { name: "Add structure" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Feature area", exact: true }).click();
  await dialog.getByLabel("Title").fill("Messaging");
  await dialog.getByLabel("Description").fill("Core messaging behaviors.");
  await dialog.getByRole("button", { name: "Create area" }).click();

  await page.getByRole("button", { name: "Add structure" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Capability", exact: true }).click();
  await dialog.getByLabel("Title").fill("Message editing");
  await dialog.getByLabel("Description").fill("Edit a previously sent message.");
  await dialog.getByRole("button", { name: "Create capability" }).click();

  await page.getByRole("button", { name: "Message editing", exact: true }).click();
  let inlineEditor = page.getByRole("form", { name: "Edit Message editing inline" });
  await expect(inlineEditor).toBeVisible();
  await inlineEditor.getByLabel("Title").fill("Message revision");
  await inlineEditor.getByLabel("Desired outcome").selectOption("standardize");
  await inlineEditor.getByLabel("Decision status").selectOption("decided");
  await inlineEditor.getByLabel("Priority").selectOption("now");
  await inlineEditor.getByLabel("Completion").selectOption("complete");
  await inlineEditor.getByRole("button", { name: "Save & publish" }).click();
  await expect(inlineEditor).toHaveCount(0);
  const capabilityButton = page.getByRole("button", { name: "Message revision", exact: true });
  await expect(capabilityButton).toBeVisible();
  const capabilityRow = page.getByRole("row").filter({ has: capabilityButton });
  await expect(capabilityRow.getByText("now", { exact: true })).toBeVisible();
  await expect(capabilityRow.getByText("Complete", { exact: true })).toBeVisible();

  await page.getByLabel("Completion filter").click();
  await page.getByRole("option", { name: "In progress", exact: true }).click();
  await expect(capabilityButton).toHaveCount(0);
  await page.getByLabel("Completion filter").click();
  await page.getByRole("option", { name: "Complete", exact: true }).click();
  await expect(capabilityButton).toBeVisible();
  await page.getByLabel("Completion filter").click();
  await page.getByRole("option", { name: "All completion states", exact: true }).click();

  const status = page.getByLabel("Set Message revision status").first();
  await expect(status.locator("..")).toHaveAttribute("data-assessment-status", "unknown");
  await status.selectOption("implemented");
  await expect(status).toHaveValue("implemented");
  await expect(status.locator("..")).toHaveAttribute("data-assessment-status", "implemented");
  await capabilityButton.click();
  inlineEditor = page.getByRole("form", { name: "Edit Message revision inline" });
  await expect(inlineEditor.getByLabel("Desired outcome")).toHaveValue("standardize");
  await expect(inlineEditor.getByLabel("Decision status")).toHaveValue("decided");
  await expect(inlineEditor.getByLabel("Priority")).toHaveValue("now");
  await expect(inlineEditor.getByLabel("Completion")).toHaveValue("complete");
  const matrixAccessibility = await new AxeBuilder({ page }).analyze();
  expect(matrixAccessibility.violations).toEqual([]);
  await inlineEditor.getByRole("link", { name: "Open full details" }).click();

  await expect(page.getByLabel("Discussion target")).toHaveCount(0);
  await expect(page.getByText("Signed by your connected identity")).toHaveCount(0);
  await page
    .getByPlaceholder("Add a comment. Type @ to mention a board member.")
    .fill("Use one shared edit window.");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const thread = page.getByRole("article").first();
  await expect(thread.getByText("Use one shared edit window.", { exact: true })).toBeVisible();
  await thread.getByRole("button", { name: "React", exact: true }).click();
  await expect(thread.getByRole("button", { name: "Unlike (1)" })).toBeVisible();
  await thread.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = thread.locator('input[value="Use one shared edit window."]');
  await edit.fill("Use the same edit window on every client.");
  await thread.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Use the same edit window on every client.", { exact: true }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.context().setOffline(true);
  await expect(page.getByText("Read-only offline")).toBeVisible();
  await expect(thread.getByRole("button", { name: "React", exact: true })).toHaveCount(0);
  await expect(thread.getByRole("button", { name: "Unlike (1)" })).toBeDisabled();
});
