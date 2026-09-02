import { createPublicClient, createWalletClient, http, parseUnits, toHex, keccak256, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const erc20Abi = [{ type: "event", name: "Transfer", inputs: [
  { indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "value", type: "uint256" }
]}] as const;
const settlementAbi = [{ type: "function", name: "settlePayment", stateMutability: "nonpayable", inputs: [
  { name: "paymentId", type: "bytes32" }, { name: "receiver", type: "address" }, { name: "amount", type: "uint256" }, { name: "feeBps", type: "uint16" }
], outputs: [] }] as const;

function config() {
  const chainId = Number(process.env.BASE_CHAIN_ID ?? 84532);
  return { chain: chainId === 8453 ? base : baseSepolia, rpc: process.env.BASE_RPC_URL!, usdc: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`, contract: process.env.INBOX_GOALIE_PAYMENT_CONTRACT_ADDRESS as `0x${string}` };
}

export async function verifyUsdcDeposit(txHash: `0x${string}`, expectedAmountUsdc: string) {
  const c = config();
  const client = createPublicClient({ chain: c.chain, transport: http(c.rpc) });
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return false;
  const expected = parseUnits(expectedAmountUsdc, 6);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== c.usdc.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Transfer" && decoded.args.to.toLowerCase() === c.contract.toLowerCase() && decoded.args.value >= expected) return true;
    } catch {}
  }
  return false;
}

export async function settlePayment(requestId: string, receiver: `0x${string}`, amountUsdc: string, feeBps: number) {
  const c = config();
  const key = process.env.SETTLEMENT_OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("SETTLEMENT_OPERATOR_PRIVATE_KEY is required");
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: c.chain, transport: http(c.rpc) });
  const publicClient = createPublicClient({ chain: c.chain, transport: http(c.rpc) });
  const paymentId = keccak256(toHex(requestId));
  const hash = await wallet.writeContract({ address: c.contract, abi: settlementAbi, functionName: "settlePayment", args: [paymentId, receiver, parseUnits(amountUsdc, 6), feeBps] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Settlement transaction failed: ${hash}`);
  return hash;
}

export function platformFeeUsdc(amountUsdc: string, feeBps: number) {
  return (Number(amountUsdc) * feeBps / 10_000).toFixed(6);
}
