import { network } from "../src/lib/chains";
import { rpc, standardFee } from "../src/lib/cctp";
import { erc20Abi } from "viem";
async function main() {
  for (const mode of ["testnet", "mainnet"] as const) {
    for (const side of ["base", "arc"] as const) {
      const config = network(mode, side);
      const client = rpc(mode, side);
      try {
        const [id, messenger, transmitter, decimals, fee] = await Promise.all([
          client.getChainId(),
          client.getCode({ address: config.messenger }),
          client.getCode({ address: config.transmitter }),
          client.readContract({
            address: config.usdc,
            abi: erc20Abi,
            functionName: "decimals",
          }),
          standardFee(mode, side, 1_000_000n),
        ]);
        if (
          id !== config.chain.id ||
          !messenger ||
          messenger === "0x" ||
          !transmitter ||
          transmitter === "0x" ||
          decimals !== 6
        )
          throw new Error(
            "Network configuration does not match deployed contracts.",
          );
        console.log(
          `PASS ${config.chain.name}: chain ${id}; CCTP contracts deployed; USDC decimals ${decimals}; standard fee for 1 USDC = ${fee} micro-USDC`,
        );
      } catch (error) {
        console.log(
          `UNVERIFIED ${config.chain.name}: ${(error as { shortMessage?: string }).shortMessage || (error as Error).message}`,
        );
        process.exitCode = 1;
      }
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
