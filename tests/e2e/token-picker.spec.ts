import { test, expect } from "@playwright/test";

test("checkout uses compact network and token dropdowns on mobile", async ({
  page,
}) => {
  const origin = process.env.TEST_BASE_URL || "http://localhost:3000";
  const payment = {
    id: "picker-test",
    owner: "test",
    mode: "mainnet",
    customer: "Buyer",
    description: "Coffee",
    reference: "PICKER",
    amount: "5",
    merchantName: "Test Store",
    merchantAddress: "0x1111111111111111111111111111111111111111",
    createdAt: Date.now(),
    refunds: [],
  };
  const tokens = [
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    },
    {
      symbol: "ETH",
      name: "Ether",
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
    },
  ];
  const chains = [
    [9999, "Obscure Chain"],
    [324, "ZKsync"],
    [8453, "Base"],
    [1, "Ethereum"],
    [42161, "Arbitrum"],
    [10, "Optimism"],
    [137, "Polygon"],
    [43114, "Avalanche"],
    [56, "BNB Chain"],
    [5042, "Arc"],
    [59144, "Linea"],
  ].map(([id, name]) => ({ id, name, displayName: name, tokens }));
  await page.route(`${origin}/api/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/relay/catalog")
      return route.fulfill({ json: { chains } });
    if (path === `/api/payments/${payment.id}`)
      return route.fulfill({ json: { payment } });
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/pay/${payment.id}`);
  await page.getByRole("button", { name: /Pay with any token/ }).click();
  const network = page.getByRole("button", {
    name: "Network: Base",
    exact: true,
  });
  await expect(network).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Token: USDC", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Paste its contract address"),
  ).not.toBeVisible();
  await network.click();
  await expect(page.locator(".asset-options button")).toHaveCount(10);
  await expect(
    page.getByRole("button", { name: "Select Obscure Chain", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select Arbitrum", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Network: Arbitrum", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Token: USDC", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search token", exact: true })
    .fill("Ether");
  await expect(page.locator(".asset-options button")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Select ETH, Ether", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Token: ETH", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".asset-menu")).toHaveCount(0);
  await page.getByRole("button", { name: "Token: ETH", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Token: ETH", exact: true }),
  ).toBeFocused();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".any-token-panel")
    .screenshot({ path: "outputs/token-picker-mobile.png" });
});
