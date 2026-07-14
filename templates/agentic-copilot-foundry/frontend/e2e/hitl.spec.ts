import { expect, test, type Page } from "@playwright/test";

const READ_PROMPT = "What is the current value?";
const ACTION_PROMPT = "Apply a delta of 10.";

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

test("read, reject, approve, and follow up without duplicate execution", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByText("forgewright", { exact: true })).toBeVisible();

  await send(page, READ_PROMPT);
  const readCards = page.locator(".card", { hasText: "Current value" });
  await expect(readCards.last()).toBeVisible();
  const initialValue = Number((await readCards.last().textContent())?.match(/[\d.]+/)?.[0]);

  await send(page, ACTION_PROMPT);
  const rejectCard = page.locator(".approval").last();
  await expect(rejectCard).toBeVisible();
  await expect(rejectCard.getByRole("button", { name: "Approve" })).toBeInViewport();
  await runAndWait(page, () => rejectCard.getByRole("button", { name: "Reject" }).click());
  await expect(page.getByText("Decision recorded").last()).toBeVisible();
  await expect(page.locator(".card.resolved", { hasText: "Applied" })).toHaveCount(0);

  await send(page, ACTION_PROMPT);
  const approveCard = page.locator(".approval").last();
  await expect(approveCard).toBeVisible();
  await runAndWait(page, () => approveCard.getByRole("button", { name: "Approve" }).click());
  const executedCard = page.locator(".card.resolved", {
    hasText: /Applied|Approved action executed server-side/,
  });
  await expect(executedCard).toHaveCount(1);

  const initialReadCount = await readCards.count();
  await send(page, READ_PROMPT);
  await expect(readCards).toHaveCount(initialReadCount + 1);
  const finalValue = Number((await readCards.last().textContent())?.match(/[\d.]+/)?.[0]);
  expect(finalValue).not.toBe(initialValue);
  await expect(executedCard).toHaveCount(1);
  expect(errors).toEqual([]);
});
