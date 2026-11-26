import { MINERVA_TESTNET_CHAIN_ID, supportedChainId } from "@minerva/evm";

const INLINE_PUBLIC_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_MINERVA_ACCOUNT_ADDRESS: process.env.EXPO_PUBLIC_MINERVA_ACCOUNT_ADDRESS,
  EXPO_PUBLIC_MINERVA_CHAIN_ID: process.env.EXPO_PUBLIC_MINERVA_CHAIN_ID,
  EXPO_PUBLIC_MINERVA_RPC_URL: process.env.EXPO_PUBLIC_MINERVA_RPC_URL,
  EXPO_PUBLIC_MINERVA_FAUCET_URL: process.env.EXPO_PUBLIC_MINERVA_FAUCET_URL,
  EXPO_PUBLIC_MINERVA_PQ_RELAYER_URL: process.env.EXPO_PUBLIC_MINERVA_PQ_RELAYER_URL,
  EXPO_PUBLIC_MINERVA_INDEXER_URL: process.env.EXPO_PUBLIC_MINERVA_INDEXER_URL,
  EXPO_PUBLIC_MINERVA_WALLET_VERSION: process.env.EXPO_PUBLIC_MINERVA_WALLET_VERSION,
  EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID,
};

export function readPublicEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return INLINE_PUBLIC_ENV[name] ?? proc?.env?.[name];
}

export function configuredMinervaChainId() {
  return supportedChainId(readPublicEnv("EXPO_PUBLIC_MINERVA_CHAIN_ID") ?? MINERVA_TESTNET_CHAIN_ID);
}
