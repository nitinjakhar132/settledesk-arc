"use client";

import {
  createClient,
  getClient,
  type Execute,
} from "@relayprotocol/relay-sdk";
import { configureDynamicChains } from "@relayprotocol/relay-sdk/chain-utils";
import {
  createWalletClient,
  createPublicClient,
  erc20Abi,
  http,
  custom,
  numberToHex,
  type Address,
  type Chain,
} from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";

let relayReady: Promise<void> | undefined;

async function prepareRelay() {
  if (!relayReady) {
    relayReady = (async () => {
      createClient({
        baseApiUrl: `${window.location.origin}/api/relay`,
        source: window.location.hostname,
        pollingInterval: 4_000,
        confirmationPollingInterval: 1_500,
      });
      await configureDynamicChains();
    })().catch((error) => {
      relayReady = undefined;
      throw error;
    });
  }
  await relayReady;
}

export async function executeRelayPayment(
  quote: Execute,
  originChainId: number,
  connectedWallet: ConnectedWallet,
  onStep: (step: string) => void,
) {
  onStep("Preparing the payment network…");
  await preparationTimeout(
    prepareRelay(),
    "The payment network took too long to load. Please try again.",
  );
  const quotedChainId = quote.details?.currencyIn?.currency?.chainId;
  if (quotedChainId !== originChainId)
    throw new Error("The payment route changed. Choose the token again.");
  const source = getClient().chains.find((chain) => chain.id === originChainId);
  if (!source?.viemChain)
    throw new Error("Relay no longer supports this payment network.");
  onStep("Checking funds in your selected wallet…");
  await assertRelayFunds(
    quote,
    source.viemChain,
    connectedWallet.address as Address,
  );
  onStep(`Switching your wallet to ${source.displayName}…`);
  const wallet = await preparationTimeout(
    walletOnRelayChain(connectedWallet, source.viemChain),
    `Your wallet did not finish switching to ${source.displayName}. Open your wallet, select that network, then try again. No payment was submitted.`,
  );
  onStep("Confirm the Relay payment in your wallet…");
  return getClient().actions.execute({
    quote,
    wallet,
    disableCapabilitiesCheck: true,
    onProgress: ({ currentStep, currentStepItem }) => {
      const label =
        currentStepItem?.data?.sign?.signatureKind === "eip712"
          ? "Approve the protected payment…"
          : currentStep?.action || currentStep?.description;
      if (label) onStep(label);
    },
  });
}

export async function walletOnRelayChain(
  connectedWallet: ConnectedWallet,
  chain: Chain,
) {
  const initialProvider = await connectedWallet.getEthereumProvider();
  const initialWallet = createWalletClient({
    account: connectedWallet.address as Address,
    chain,
    transport: custom(initialProvider),
  });
  if ((await initialWallet.getChainId()) === chain.id) return initialWallet;
  try {
    await connectedWallet.switchChain(chain.id);
  } catch (error) {
    const e = error as { code?: number; cause?: { code?: number } };
    const message = error instanceof Error ? error.message : String(error);
    const unsupported =
      e.code === 4902 ||
      e.cause?.code === 4902 ||
      /unsupported|does not support|not configured|unknown chain/i.test(
        message,
      );
    if (!unsupported) throw error;
    const provider = await connectedWallet.getEthereumProvider();
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: numberToHex(chain.id) }],
      });
    } catch (switchError) {
      const switchValue = switchError as {
        code?: number;
        cause?: { code?: number };
        message?: string;
      };
      const switchCode = switchValue.code ?? switchValue.cause?.code;
      const unknownChain =
        switchCode === 4902 ||
        /unknown chain|not added|unrecognized/i.test(switchValue.message || "");
      if (!unknownChain) throw switchError;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: numberToHex(chain.id),
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http,
            blockExplorerUrls: chain.blockExplorers?.default?.url
              ? [chain.blockExplorers.default.url]
              : undefined,
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: numberToHex(chain.id) }],
      });
    }
  }
  // Privy returns a new provider after switching networks. The old provider
  // can still report Arc, causing Relay to stop before it opens the wallet.
  const provider = await connectedWallet.getEthereumProvider();
  return createWalletClient({
    account: connectedWallet.address as Address,
    chain,
    transport: custom(provider),
  });
}

// Bound only read/setup operations. Never race a submitted payment against a
// timeout: doing so could invite a duplicate payment while the first is pending.
async function preparationTimeout<T>(
  operation: Promise<T>,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 20000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function assertRelayFunds(
  quote: Execute,
  chain: Chain,
  address: Address,
) {
  const input = quote.details?.currencyIn;
  if (!input?.currency?.address || !input.amount || !/^\d+$/.test(input.amount))
    throw new Error(
      "The payment quote is incomplete. Choose your token again.",
    );
  const client = createPublicClient({
    chain,
    transport: http(undefined, { timeout: 10000, retryCount: 0 }),
  });
  const currency = input.currency.address as Address;
  const native =
    currency.toLowerCase() === "0x0000000000000000000000000000000000000000";
  const balance = native
    ? await client.getBalance({ address })
    : await client.readContract({
        address: currency,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
  if (balance < BigInt(input.amount))
    throw new Error(
      `Your selected wallet does not have enough ${input.currency.symbol || "tokens"} on ${chain.name}. Use another wallet that holds those funds, or fund this wallet first. No payment was submitted.`,
    );
}

export type RelayExecutableQuote = Execute & { requestId: string };
