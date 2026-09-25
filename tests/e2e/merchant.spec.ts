import { test, expect } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

test("unconfigured Privy state is clear, responsive, and error-free", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bring your business wallet to life." }),
  ).toBeVisible();
  await expect(page.getByText("Wallet", { exact: true })).toBeVisible();
  await expect(page.getByText("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("Mobile", { exact: true })).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `overflow at ${width}px`,
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test("API rejects cross-merchant actions, over-refunds, and unconfirmed fulfillment", async ({
  request,
  playwright,
}) => {
  await request.post("/api/demo", { data: {} });
  const list = await (await request.get("/api/payments")).json();
  const settled = list.payments.find(
    (payment: { customer: string }) => payment.customer === "Emma Wilson",
  );
  const ready = list.payments.find(
    (payment: { customer: string }) => payment.customer === "Alex Chen",
  );
  expect(
    (
      await request.post(`/api/payments/${ready.id}/fulfill`, { data: {} })
    ).status(),
  ).toBe(400);
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  await other.post("/api/demo", { data: {} });
  expect(
    (
      await other.post(`/api/payments/${settled.id}/refund`, {
        data: {
          amount: "10",
          reason: "Test",
          idempotencyKey: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(`/api/payments/${settled.id}/refund`, {
        data: {
          amount: "481",
          reason: "Test",
          idempotencyKey: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(400);
  const key = crypto.randomUUID();
  const input = { amount: "20", reason: "Test", idempotencyKey: key };
  expect(
    (
      await request.post(`/api/payments/${settled.id}/refund`, { data: input })
    ).status(),
  ).toBe(200);
  const replay = await (
    await request.post(`/api/payments/${settled.id}/refund`, { data: input })
  ).json();
  expect(replay.payment.refunds).toHaveLength(1);
  expect(
    (
      await request.post(`/api/payments/${settled.id}/refund`, {
        data: { ...input, idempotencyKey: crypto.randomUUID() },
      })
    ).status(),
  ).toBe(400);
  await other.dispose();
});

test("wallet signatures reject replay and separate test funds from mainnet", async ({
  request,
}) => {
  const account = privateKeyToAccount(generatePrivateKey());
  const challenge = await (
    await request.post("/api/auth/challenge", {
      data: { address: account.address },
    })
  ).json();
  const signature = await account.signMessage({ message: challenge.message });
  const credentials = {
    address: account.address,
    nonce: challenge.nonce,
    signature,
  };
  expect(
    (await request.post("/api/auth/verify", { data: credentials })).status(),
  ).toBe(200);
  expect(
    (await request.post("/api/auth/verify", { data: credentials })).status(),
  ).toBe(400);
  const made = await (
    await request.post("/api/payments", {
      data: { customer: "Test Buyer", description: "Test order", amount: "1" },
    })
  ).json();
  expect(made.payment.mode).toBe("testnet");
  await request.post("/api/profile", {
    data: { name: "Test Store", mode: "mainnet" },
  });
  expect(
    (await (await request.get("/api/payments")).json()).payments,
  ).toHaveLength(0);
  await request.post("/api/profile", {
    data: { name: "Test Store", mode: "testnet" },
  });
  expect(
    (await (await request.get("/api/payments")).json()).payments,
  ).toHaveLength(1);
  expect(
    (
      await request.post("/api/payments", {
        headers: { Origin: "https://malicious.example" },
        data: { customer: "No", description: "No", amount: "1" },
      })
    ).status(),
  ).toBe(403);
});

test("demo settlement and refund state machine remains available to API tests", async ({
  request,
}) => {
  await request.post("/api/demo", { data: {} });
  const created = await (
    await request.post("/api/payments", {
      data: {
        customer: "Jamie Test",
        description: "Studio session",
        amount: "100",
      },
    })
  ).json();
  const id = created.payment.id;
  await request.post(`/api/payments/${id}/demo-pay`, { data: {} });
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await request.post(`/api/payments/${id}/demo-receive`, { data: {} });
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const settled = await (await request.get(`/api/payments/${id}`)).json();
  expect(settled.payment.transfer.status).toBe("settled");
  const refund = await (
    await request.post(`/api/payments/${id}/refund`, {
      data: {
        amount: "50",
        reason: "Customer request",
        idempotencyKey: crypto.randomUUID(),
      },
    })
  ).json();
  expect(refund.payment.refunds).toHaveLength(1);
});
