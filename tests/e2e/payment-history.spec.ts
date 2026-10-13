import { test, expect } from "@playwright/test";

test("merchant history shows received USDC, hides unpaid links, and keeps Relay details optional", async ({
  page,
}) => {
  const profile = { name: "Test Store", mode: "demo" };
  const paid = {
    id: "paid-relay",
    owner: "test",
    mode: "mainnet",
    customer: "Paid buyer",
    description: "Counter sale",
    reference: "TEST-PAID",
    amount: "0.1",
    merchantName: "Test Store",
    merchantAddress: "0x1111111111111111111111111111111111111111",
    payerAddress: "0x2222222222222222222222222222222222222222",
    createdAt: Date.now() - 3600000,
    expiresAt: Date.now() - 60000,
    fulfilledAt: Date.now(),
    refunds: [],
    transfer: {
      status: "settled",
      startedAt: Date.now() - 60000,
      settledAt: Date.now(),
      rail: "relay",
      originChainId: 42161,
      originSymbol: "ETH",
    },
  };
  const payments = [
    {
      ...paid,
      id: "unpaid",
      customer: "Unpaid buyer",
      transfer: undefined,
      fulfilledAt: undefined,
    },
    {
      ...paid,
      id: "pending",
      customer: "Pending buyer",
      transfer: { status: "processing", startedAt: Date.now() },
      fulfilledAt: undefined,
    },
    paid,
  ];
  await page.route("http://localhost:3000/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/demo") return route.fulfill({ json: { profile } });
    if (path === "/api/payments")
      return route.fulfill({ json: { profile, payments } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Payment history", exact: true })
    .click();
  await expect(page.getByText("Unpaid buyer", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Pending buyer", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: /Paid buyer, 0.10 USDC, USDC received/ })
    .click();
  const detail = page.getByRole("dialog", {
    name: "Payment details",
    exact: true,
  });
  await expect(
    detail.getByText("0.10 USDC received in your wallet"),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Order fulfilled" }),
  ).toBeVisible();
  await expect(
    detail.getByText("Needs attention", { exact: true }),
  ).toHaveCount(0);
  await expect(
    detail.getByText("Verified by Circle", { exact: true }),
  ).toHaveCount(0);
  await expect(
    detail.getByText("Delivered by Relay", { exact: true }),
  ).not.toBeVisible();
  await detail.getByText("Transaction details", { exact: true }).click();
  await expect(
    detail.getByText("Arbitrum → Arc", { exact: true }),
  ).toBeVisible();
  await expect(detail.getByText("ETH · Relay", { exact: true })).toBeVisible();
  await expect(
    detail.getByText("Delivered by Relay", { exact: true }),
  ).toBeVisible();
});
