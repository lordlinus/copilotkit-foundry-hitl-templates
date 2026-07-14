import { expect, test, type Page } from "@playwright/test";

const READ_PROMPT = "Show me the claim summary.";
const ACTION_PROMPT = "Submit the claim.";

async function runAndWait(page: Page, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/copilotkit/agent/") &&
      response.url().endsWith("/run"),
  );
  await action();
  const response = await responsePromise;
  await response.finished();
}

async function send(page: Page, text: string) {
  await page.getByTestId("copilot-chat-textarea").fill(text);
  await expect(page.getByTestId("copilot-send-button")).toBeEnabled();
  await runAndWait(page, () => page.getByTestId("copilot-send-button").click());
}

test("read, reject, approve, and follow up without duplicate submission", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await send(page, READ_PROMPT);
  const claimCards = page.locator(".card .fn", { hasText: "Claim" });
  await expect(claimCards.last()).toBeVisible();
  const initialClaim = await claimCards.last().textContent();

  await send(page, ACTION_PROMPT);
  const rejectCard = page.locator(".approval").last();
  await expect(rejectCard).toBeVisible();
  await runAndWait(page, () => rejectCard.getByRole("button", { name: "Reject" }).click());
  await expect(page.getByText("Decision recorded").last()).toBeVisible();
  await expect(page.locator(".card.resolved", { hasText: "Claim filed" })).toHaveCount(0);

  await send(page, ACTION_PROMPT);
  const approveCard = page.locator(".approval").last();
  await expect(approveCard).toBeVisible();
  await expect(approveCard.getByRole("button", { name: "Approve & submit" })).toBeInViewport();
  await runAndWait(page, () => approveCard.getByRole("button", { name: "Approve & submit" }).click());
  const executedCard = page.locator(".card.resolved", {
    hasText: /Claim filed|Approved claim submission executed server-side/,
  });
  await expect(executedCard).toHaveCount(1);

  const initialReadCount = await claimCards.count();
  await send(page, READ_PROMPT);
  await expect(claimCards).toHaveCount(initialReadCount + 1);
  expect(await claimCards.last().textContent()).not.toBe(initialClaim);
  await expect(executedCard).toHaveCount(1);
  expect(errors).toEqual([]);
});
