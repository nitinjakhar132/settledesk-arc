"use client";

import {
  createClient,
  getClient,
  type Execute,
} from "@relayprotocol/relay-sdk";
import { configureDynamicChains } from "@relayprotocol/relay-sdk/chain-utils";
import { createWalletClient, custom, type Address } from "viem";
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
  connectedWallet: ConnectedWallet,
  onStep: (step: string) => void,
) {
  await prepareRelay();
  const provider = await connectedWallet.getEthereumProvider();
  const wallet = createWalletClient({
    account: connectedWallet.address as Address,
    transport: custom(provider),
  });
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

export type RelayExecutableQuote = Execute & { requestId: string };
