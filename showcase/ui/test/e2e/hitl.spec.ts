import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// End-to-end in a real browser against the built UI + a mock-mode gateway.
// Proves the user-visible HITL flow for each agent and screenshots it.

const SHOT_DIR = "screenshots";
mkdirSync(SHOT_DIR, { recursive: true });

async function openAgent(page: Page, cardTitle: string) {
  await page.goto("/");
  const card = page.locator(".card", { hasText: cardTitle });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /Try it/ }).click();
  await expect(page.locator(".drawer")).toBeVisible();
}

async function send(page: Page, text: string) {
  const input = page.locator(".composer-input");
  await input.fill(text);
  await page.locator(".composer button[type=submit]").click();
}

test("gallery renders three agent cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(3);
  await page.screenshot({ path: `${SHOT_DIR}/gallery.png`, fullPage: true });
});

test("banking: consequential action shows a VISIBLE approval card with Approve/Reject", async ({ page }) => {
  await openAgent(page, "Conversational Banking");
  await send(page, "Transfer 200 from checking to savings now.");

  const approval = page.locator(".approval").first();
  await expect(approval).toBeVisible({ timeout: 60_000 });
  // The Approve/Reject BUTTONS (not just the card) must be in the viewport — a
  // tall preview must not push them below the fold.
  const approveBtn = page.getByRole("button", { name: "Approve" });
  const rejectBtn = page.getByRole("button", { name: "Reject" });
  await expect(approveBtn).toBeInViewport();
  await expect(rejectBtn).toBeInViewport();
  // Preview must not be an empty object.
  await expect(approval).not.toHaveText(/\{\s*\}/);
  await page.screenshot({ path: `${SHOT_DIR}/banking-approval.png`, fullPage: true });

  // Approving resolves the gate.
  await approveBtn.click();
  await expect(page.locator(".approval.approved")).toBeVisible({ timeout: 60_000 });
});

test("claim: form loads on demand and submit approval shows the record (not {})", async ({ page }) => {
  await openAgent(page, "Health Claim Intake");
  await send(page, "Extract the claim form.");

  // Load-on-demand: a form toggle appears; expanding it reveals editable fields.
  const toggle = page.locator(".form-toggle").first();
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await toggle.click();
  const form = page.locator(".formcard").first();
  await expect(form).toBeVisible();
  await expect(form.locator(".formrow-input").first()).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/claim-form.png`, fullPage: true });

  // Submit → approval card shows the record under review, not an empty object.
  await send(page, "Submit the claim.");
  const approval = page.locator(".approval").first();
  await expect(approval).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Approve" })).toBeInViewport();
  await expect(approval).not.toHaveText(/Review before submit\s*\{\s*\}/);
  await page.screenshot({ path: `${SHOT_DIR}/claim-approval.png`, fullPage: true });
});
