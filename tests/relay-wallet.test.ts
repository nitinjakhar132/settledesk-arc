import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { arbitrum } from "viem/chains";
import { createServer } from "node:http";
import type { Execute } from "@relayprotocol/relay-sdk";
import { errorText } from "../src/lib/client";
import { assertRelayFunds, walletOnRelayChain } from "../src/lib/relay-client";

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
  assert.equal(providerRequests, 2);
});

test("an already-connected Arbitrum wallet is not asked to switch again", async () => {
  const wallet = {
    address: "0x1111111111111111111111111111111111111111",
    switchChain: async () => {
      throw new Error("A redundant switch would hang the mobile wallet");
    },
    getEthereumProvider: async () => ({ request: async () => "0xa4b1" }),
  } as unknown as ConnectedWallet;
  assert.equal(
    await (await walletOnRelayChain(wallet, arbitrum)).getChainId(),
    arbitrum.id,
  );
});

test("an unfunded email wallet fails clearly before payment approval", async () => {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (data) => {
      body += data;
    });
    request.on("end", () => {
      const rpc = JSON.parse(body);
      assert.equal(rpc.method, "eth_getBalance");
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: "0x0" }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const chain = {
      ...arbitrum,
      rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } },
    };
    const quote = {
      details: {
        currencyIn: {
          currency: {
            address: "0x0000000000000000000000000000000000000000",
            symbol: "ETH",
          },
          amount: "100",
        },
      },
    } as Execute;
    await assert.rejects(
      assertRelayFunds(
        quote,
        chain,
        "0x1111111111111111111111111111111111111111",
      ),
      /not have enough ETH.*No payment was submitted/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("Relay chain errors show a useful wallet message", () => {
  assert.match(
    errorText("Current chain id: 5042 does not match expected chain id: 42161"),
    /Switch to the selected payment network/,
  );
});
