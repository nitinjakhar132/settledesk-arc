import { test, expect } from "@playwright/test";

test("an expired QR recovers an already-paid Relay receipt without sending money", async ({
  page,
}) => {
  page.on("pageerror", (error) => console.error(error.message));
  const payment = {
    id: "relay-recovery-test",
    owner: "test",
    mode: "mainnet",
    customer: "Test buyer",
    description: "Test sale",
    reference: "TEST",
    amount: "0.1",
    merchantName: "Test store",
    merchantAddress: "0x1111111111111111111111111111111111111111",
    createdAt: Date.now() - 3600000,
    expiresAt: Date.now() - 60000,
    refunds: [],
    pendingRelay: {
      requestId: "test-request",
      originChainId: 42161,
      originCurrency: "0x0000000000000000000000000000000000000000",
      originSymbol: "ETH",
      payer: "0x2222222222222222222222222222222222222222",
      quotedAt: Date.now() - 3600000,
    },
  };
  let confirmations = 0;
  const writes: string[] = [];
  await page.route("http://localhost:3000/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") writes.push(url.pathname);
    if (url.pathname.endsWith("/relay-confirm")) {
      confirmations++;
      expect(route.request().postDataJSON()).toEqual({
        requestId: "test-request",
      });
      return route.fulfill({
        json: {
          payment: {
            ...payment,
            pendingRelay: undefined,
            transfer: {
              status: "settled",
              startedAt: Date.now(),
              settledAt: Date.now(),
              rail: "relay",
            },
          },
        },
      });
    }
    if (url.pathname.includes("/intents/status/"))
      return route.fulfill({
        json: { status: "success", inTxHashes: ["source-hash"] },
      });
    if (url.pathname === `/api/payments/${payment.id}`)
      return route.fulfill({ json: { payment } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/pay/${payment.id}`);
  await expect(
    page.getByRole("heading", { name: "You’re all set." }),
  ).toBeVisible();
  expect(confirmations).toBeGreaterThan(0);
  expect(writes.every((path) => path.endsWith("/relay-confirm"))).toBeTruthy();
});
