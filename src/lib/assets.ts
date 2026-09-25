import {
  createPublicClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  type Address,
} from "viem";
import { network } from "./chains";

export interface AssetSnapshot {
  arcUsdc: string;
  arcEurc?: string;
  baseUsdc: string;
  baseNative: string;
}

const EURC_ARC_TESTNET = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

export async function readAssetSnapshot(
  address: Address,
  mode: "testnet" | "mainnet",
): Promise<AssetSnapshot> {
  const arc = network(mode, "arc");
  const base = network(mode, "base");
  const arcClient = createPublicClient({ chain: arc.chain, transport: http() });
  const baseClient = createPublicClient({
    chain: base.chain,
    transport: http(),
  });
  const [arcUsdc, baseUsdc, baseNative, arcEurc] = await Promise.allSettled([
    arcClient.readContract({
      address: arc.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    baseClient.readContract({
      address: base.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    baseClient.getBalance({ address }),
    mode === "testnet"
      ? arcClient.readContract({
          address: EURC_ARC_TESTNET,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        })
      : Promise.resolve(undefined),
  ]);
  return {
    arcUsdc:
      arcUsdc.status === "fulfilled" ? formatUnits(arcUsdc.value, 6) : "0",
    baseUsdc:
      baseUsdc.status === "fulfilled" ? formatUnits(baseUsdc.value, 6) : "0",
    baseNative:
      baseNative.status === "fulfilled" ? formatEther(baseNative.value) : "0",
    arcEurc:
      arcEurc.status === "fulfilled" && arcEurc.value !== undefined
        ? formatUnits(arcEurc.value, 6)
        : undefined,
  };
}
