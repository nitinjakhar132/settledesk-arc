import { defineChain, parseAbi, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Mode } from "./model";
export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
});
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
  testnet: true,
});
export function network(mode: Mode, side: "base" | "arc") {
  const main = mode === "mainnet";
  return {
    chain:
      side === "base" ? (main ? base : baseSepolia) : main ? arc : arcTestnet,
    domain: side === "base" ? 6 : 26,
    usdc: (side === "arc"
      ? "0x3600000000000000000000000000000000000000"
      : main
        ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        : "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address,
    messenger: (main
      ? "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"
      : "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA") as Address,
    transmitter: (main
      ? "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64"
      : "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275") as Address,
    iris: main
      ? "https://iris-api.circle.com"
      : "https://iris-api-sandbox.circle.com",
  };
}
export const messengerAbi = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
  "function getMinFeeAmount(uint256 amount) view returns (uint256)",
]);
export const transmitterAbi = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
  "function usedNonces(bytes32 nonce) view returns (uint256)",
  "event MessageSent(bytes message)",
  "event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 nonce, bytes32 sender, uint32 finalityThresholdExecuted, bytes messageBody)",
]);
export function explorer(mode: Mode, side: "base" | "arc", hash: string) {
  return `${network(mode, side).chain.blockExplorers!.default.url}/tx/${hash}`;
}
