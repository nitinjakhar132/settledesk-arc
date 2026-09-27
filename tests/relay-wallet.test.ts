import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { arbitrum } from "viem/chains";
import { errorText } from "../src/lib/client";
import { walletOnRelayChain } from "../src/lib/relay-client";

test("Relay switches the Privy wallet to the quoted source chain", async () => {
  let currentChain = 5042;
  let providerRequests = 0;
  const wallet = {
    address: "0x1111111111111111111111111111111111111111",
    switchChain: async (chainId: number) => {
      assert.equal(chainId, arbitrum.id);
      currentChain = chainId;
    },
    getEthereumProvider: async () => {
      providerRequests++;
      const providerChain = currentChain;
      return {
        request: async ({ method }: { method: string }) => {
          assert.equal(method, "eth_chainId");
          return `0x${providerChain.toString(16)}`;
        },
      };
    },
  } as unknown as ConnectedWallet;

  const client = await walletOnRelayChain(wallet, arbitrum);
  assert.equal(await client.getChainId(), arbitrum.id);
  assert.equal(providerRequests, 1);
});

test("Relay chain errors show a useful wallet message", () => {
  assert.match(
    errorText("Current chain id: 5042 does not match expected chain id: 42161"),
    /Switch to the selected payment network/,
  );
});
