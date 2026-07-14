import { expect, test, type Page } from "@playwright/test";

const READ_PROMPT = "Show me my accounts and balances.";
const ACTION_PROMPT = "Transfer 100 from checking to savings.";

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

test("read, reject, approve, and follow up without duplicate transfer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await send(page, READ_PROMPT);
  const accountCards = page.locator(".card", { hasText: "Accounts" });
  await expect(accountCards.last()).toBeVisible();
  const initialAccounts = await accountCards.last().textContent();

  await send(page, ACTION_PROMPT);
  const rejectCard = page.locator(".approval").last();
  await expect(rejectCard).toBeVisible();
  await runAndWait(page, () => rejectCard.getByRole("button", { name: "Reject" }).click());
  await expect(page.getByText("Decision recorded").last()).toBeVisible();
  await expect(page.locator(".card.resolved", { hasText: "Transfer complete" })).toHaveCount(0);

  await send(page, ACTION_PROMPT);
  const approveCard = page.locator(".approval").last();
  await expect(approveCard).toBeVisible();
  await expect(approveCard.getByRole("button", { name: "Approve & pay" })).toBeInViewport();
  await runAndWait(page, () => approveCard.getByRole("button", { name: "Approve & pay" }).click());
  const executedCard = page.locator(".card.resolved", {
    hasText: /Transfer complete|Approved transaction executed server-side/,
  });
  await expect(executedCard).toHaveCount(1);

  const initialReadCount = await accountCards.count();
  await send(page, READ_PROMPT);
  await expect(accountCards).toHaveCount(initialReadCount + 1);
  expect(await accountCards.last().textContent()).not.toBe(initialAccounts);
  await expect(executedCard).toHaveCount(1);
  expect(errors).toEqual([]);
});
