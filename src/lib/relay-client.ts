"use client";

import {
  createClient,
  getClient,
  type Execute,
} from "@relayprotocol/relay-sdk";
import { configureDynamicChains } from "@relayprotocol/relay-sdk/chain-utils";
import {
  createWalletClient,
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
  await prepareRelay();
  const quotedChainId = quote.details?.currencyIn?.currency?.chainId;
  if (quotedChainId !== originChainId)
    throw new Error("The payment route changed. Choose the token again.");
  const source = getClient().chains.find((chain) => chain.id === originChainId);
  if (!source?.viemChain)
    throw new Error("Relay no longer supports this payment network.");
  onStep(`Switching your wallet to ${source.displayName}…`);
  const wallet = await walletOnRelayChain(connectedWallet, source.viemChain);
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

export type RelayExecutableQuote = Execute & { requestId: string };
