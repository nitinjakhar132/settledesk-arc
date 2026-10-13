import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyMessage, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { isEmbeddedWallet, signIn } from "../src/lib/client";

test("email wallet login verifies a background signature without opening a provider", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const message =
    "SettleDesk sign-in proof, not a payment. Nonce: regression-test";
  const originalFetch = globalThis.fetch;
  let verified = false;
  globalThis.fetch = async (url, options) => {
    if (url === "/api/auth/challenge") {
      assert.equal(JSON.parse(String(options?.body)).address, account.address);
      return Response.json({ nonce: "regression-test", message });
    }
    assert.equal(url, "/api/auth/verify");
    const credentials = JSON.parse(String(options?.body));
    assert.equal(credentials.nonce, "regression-test");
    verified = await verifyMessage({
      address: account.address,
      message,
      signature: credentials.signature as Hex,
    });
    assert.equal(verified, true);
    return Response.json({ profile: { address: account.address } });
  };
  try {
    const wallet = {
      address: account.address,
      walletClientType: "privy",
      connectorType: "embedded",
      getEthereumProvider: async () => {
        throw new Error(
          "Email login must not open the provider confirmation flow",
        );
      },
    } as unknown as ConnectedWallet;
    const result = await signIn(wallet, (message) =>
      account.signMessage({ message }),
    );
    assert.equal(result.profile.address, account.address);
    assert.equal(verified, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("external wallets still require their own approval flow", () => {
  assert.equal(
    isEmbeddedWallet({
      walletClientType: "rainbow",
      connectorType: "wallet_connect_v2",
    }),
    false,
  );
  assert.equal(
    isEmbeddedWallet({
      walletClientType: "privy-v2",
      connectorType: "embedded",
    }),
    true,
  );
});
