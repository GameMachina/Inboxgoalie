import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { createPublicClient, encodeAbiParameters, http, isAddress } from "viem";
import { base, baseSepolia } from "viem/chains";

const DEFAULT_BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function compileContract() {
  const contractPath = path.resolve("contracts/InboxGoaliePayments.sol");
  const source = fs.readFileSync(contractPath, "utf8");
  const input = {
    language: "Solidity",
    sources: { "InboxGoaliePayments.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((e: any) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e: any) => e.formattedMessage).join("\n"));

  const artifact = output.contracts?.["InboxGoaliePayments.sol"]?.InboxGoaliePayments;
  const object = artifact?.evm?.bytecode?.object;
  if (!object) throw new Error("Compiler did not produce InboxGoaliePayments bytecode");
  return { abi: artifact.abi, bytecode: `0x${object}` as `0x${string}` };
}

async function main() {
  const appId = required("PRIVY_APP_ID");
  const appSecret = required("PRIVY_APP_SECRET");
  const walletId = required("PRIVY_OPERATOR_WALLET_ID");
  const operatorAddress = required("PRIVY_OPERATOR_WALLET_ADDRESS") as `0x${string}`;
  const treasury = required("INBOX_GOALIE_TREASURY_ADDRESS") as `0x${string}`;

  if (!isAddress(operatorAddress)) throw new Error("Invalid PRIVY_OPERATOR_WALLET_ADDRESS");
  if (!isAddress(treasury)) throw new Error("Invalid INBOX_GOALIE_TREASURY_ADDRESS");

  const chainId = Number(process.env.BASE_CHAIN_ID ?? 84532);
  if (![84532, 8453].includes(chainId)) throw new Error("Only Base Sepolia (84532) and Base mainnet (8453) are supported");
  const chain = chainId === 8453 ? base : baseSepolia;
  const rpcUrl = process.env.BASE_RPC_URL ?? (chainId === 8453 ? "https://mainnet.base.org" : "https://sepolia.base.org");
  const usdc = (process.env.USDC_CONTRACT_ADDRESS || (chainId === 84532 ? DEFAULT_BASE_SEPOLIA_USDC : "")) as `0x${string}`;
  if (!isAddress(usdc)) throw new Error("USDC_CONTRACT_ADDRESS is required and must be valid");

  const { bytecode } = compileContract();
  const constructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [usdc, treasury, operatorAddress],
  );
  const deploymentData = `${bytecode}${constructorArgs.slice(2)}` as `0x${string}`;

  const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const transaction: Record<string, unknown> = { data: deploymentData, value: "0x0" };
  if ((process.env.PRIVY_SPONSOR_GAS ?? "false").toLowerCase() === "true") transaction.sponsor = true;

  console.log(`Deploying InboxGoaliePayments to ${chain.name} from ${operatorAddress}`);
  console.log(`USDC: ${usdc}`);
  console.log(`Treasury: ${treasury}`);
  console.log(`Operator: ${operatorAddress}`);

  const response = await fetch(`https://api.privy.io/v1/wallets/${walletId}/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "privy-app-id": appId,
    },
    body: JSON.stringify({
      method: "eth_sendTransaction",
      caip2: `eip155:${chainId}`,
      chain_type: "ethereum",
      reference_id: `inbox-goalie-deploy-${chainId}`,
      params: { transaction },
    }),
  });

  const body: any = await response.json();
  if (!response.ok) throw new Error(`Privy deployment request failed (${response.status}): ${JSON.stringify(body)}`);
  const txHash = body?.data?.hash as `0x${string}` | undefined;
  if (!txHash) throw new Error(`Privy did not return a transaction hash: ${JSON.stringify(body)}`);

  console.log(`Deployment transaction: ${txHash}`);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Contract deployment failed: ${txHash}`);
  }

  console.log(`InboxGoaliePayments deployed: ${receipt.contractAddress}`);
  console.log(`INBOX_GOALIE_PAYMENT_CONTRACT_ADDRESS=${receipt.contractAddress}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
