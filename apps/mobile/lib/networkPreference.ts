import AsyncStorage from "@react-native-async-storage/async-storage";
import { MINERVA_DEVNET_CHAIN_ID, MINERVA_TESTNET_CHAIN_ID, getChainDefinition, listChains, type MinervaChainDefinition } from "@minerva/evm";

const STORAGE_KEY = "minerva.wallet.network.v1";

/** The networks every build ships with. Custom networks are added at runtime (see lib/networks.ts). */
export const SELECTABLE_CHAINS = [
  { id: MINERVA_DEVNET_CHAIN_ID, name: "Minerva Devnet" },
  { id: MINERVA_TESTNET_CHAIN_ID, name: "Minerva Testnet" },
] as const;

export type SelectableChainId = number;

/** Every registered network the user may switch to; unlaunched built-ins are listed but flagged. */
export function selectableChains(): MinervaChainDefinition[] {
  return listChains();
}

function isSelectable(value: number): value is SelectableChainId {
  return getChainDefinition(value) !== undefined;
}

/** Returns the user's persisted chain override, or undefined to fall back to env. */
export async function getSelectedChainId(): Promise<SelectableChainId | undefined> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && isSelectable(parsed) ? parsed : undefined;
}

export async function setSelectedChainId(chainId: SelectableChainId): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, String(chainId));
}

export function chainName(chainId: number): string {
  return getChainDefinition(chainId)?.name ?? `Chain ${chainId}`;
}
