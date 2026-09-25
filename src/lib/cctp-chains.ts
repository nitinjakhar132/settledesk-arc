import { defineChain, type Address, type Chain } from "viem";
import type { Mode } from "./model";

export type CctpChain = {
  id: number;
  domain: number;
  name: string;
  symbol: string;
  usdc: Address;
  rpc: string;
  explorer: string;
};

// Circle-issued USDC and CCTP V2 domains. Keeping this allowlist local makes
// the "USDC means CCTP" rule enforceable even if a third-party catalog changes.
const MAINNET_CCTP_CHAINS: CctpChain[] = [
  {
    id: 1,
    domain: 0,
    name: "Ethereum",
    symbol: "ETH",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    rpc: "https://ethereum.publicnode.com",
    explorer: "https://etherscan.io",
  },
  {
    id: 43114,
    domain: 1,
    name: "Avalanche",
    symbol: "AVAX",
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    rpc: "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://snowtrace.io",
  },
  {
    id: 10,
    domain: 2,
    name: "OP Mainnet",
    symbol: "ETH",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    rpc: "https://optimism.publicnode.com",
    explorer: "https://optimistic.etherscan.io",
  },
  {
    id: 42161,
    domain: 3,
    name: "Arbitrum",
    symbol: "ETH",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    rpc: "https://arbitrum-one.publicnode.com",
    explorer: "https://arbiscan.io",
  },
  {
    id: 8453,
    domain: 6,
    name: "Base",
    symbol: "ETH",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
  },
  {
    id: 137,
    domain: 7,
    name: "Polygon",
    symbol: "POL",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    rpc: "https://polygon-bor-rpc.publicnode.com",
    explorer: "https://polygonscan.com",
  },
  {
    id: 130,
    domain: 10,
    name: "Unichain",
    symbol: "ETH",
    usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    rpc: "https://mainnet.unichain.org",
    explorer: "https://uniscan.xyz",
  },
  {
    id: 59144,
    domain: 11,
    name: "Linea",
    symbol: "ETH",
    usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
    rpc: "https://rpc.linea.build",
    explorer: "https://lineascan.build",
  },
  {
    id: 146,
    domain: 13,
    name: "Sonic",
    symbol: "S",
    usdc: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
    rpc: "https://rpc.soniclabs.com",
    explorer: "https://sonicscan.org",
  },
  {
    id: 143,
    domain: 15,
    name: "Monad",
    symbol: "MON",
    usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    rpc: "https://rpc3.monad.xyz",
    explorer: "https://monadvision.com",
  },
  {
    id: 999,
    domain: 19,
    name: "HyperEVM",
    symbol: "HYPE",
    usdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
    rpc: "https://rpc.hyperliquid.xyz/evm",
    explorer: "https://hyperevmscan.io",
  },
  {
    id: 57073,
    domain: 21,
    name: "Ink",
    symbol: "ETH",
    usdc: "0x2D270e6886d130D724215A266106e6832161EAEd",
    rpc: "https://ink.drpc.org",
    explorer: "https://explorer.inkonchain.com",
  },
  {
    id: 25,
    domain: 32,
    name: "Cronos",
    symbol: "CRO",
    usdc: "0x3D7F2C478aAfdB65542BCB44bCeeC05849999d2D",
    rpc: "https://cronos.drpc.org",
    explorer: "https://cronoscan.com",
  },
  {
    id: 196,
    domain: 37,
    name: "X Layer",
    symbol: "OKB",
    usdc: "0xB6CEceAB302E2E4948951eE7843FC24E92933061",
    rpc: "https://rpc.xlayer.tech",
    explorer: "https://xlayerscan.com",
  },
];

const TESTNET_CCTP_CHAINS: CctpChain[] = [
  {
    id: 84532,
    domain: 6,
    name: "Base Sepolia",
    symbol: "ETH",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
  },
];

export function cctpChains(mode: Mode) {
  return mode === "mainnet" ? MAINNET_CCTP_CHAINS : TESTNET_CCTP_CHAINS;
}

export function cctpChain(mode: Mode, chainId?: number) {
  const fallback = mode === "mainnet" ? 8453 : 84532;
  return cctpChains(mode).find((chain) => chain.id === (chainId ?? fallback));
}

export function isCctpUsdc(mode: Mode, chainId: number, currency: string) {
  const chain = cctpChain(mode, chainId);
  return !!chain && chain.usdc.toLowerCase() === currency.toLowerCase();
}

export function viemCctpChain(config: CctpChain): Chain {
  return defineChain({
    id: config.id,
    name: config.name,
    nativeCurrency: {
      name: config.symbol,
      symbol: config.symbol,
      decimals: 18,
    },
    rpcUrls: { default: { http: [config.rpc] } },
    blockExplorers: {
      default: { name: `${config.name} Explorer`, url: config.explorer },
    },
  });
}
