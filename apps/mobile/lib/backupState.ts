import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_PREFIX = "minerva.wallet.backup.v1";

function key(chainId: number): string {
  return `${STORAGE_PREFIX}.${chainId}`;
}

export interface BackupState {
  backedUp: boolean;
  /** ISO timestamp of the last successful encrypted backup export. */
  lastBackupAt?: string;
}

/** Records that the user successfully exported an encrypted Recovery Kit for
 *  this chain. The only state stored is a timestamp — never key material. */
export async function markBackedUp(chainId: number): Promise<void> {
  await AsyncStorage.setItem(key(chainId), new Date().toISOString());
}

export async function getBackupState(chainId: number): Promise<BackupState> {
  const raw = await AsyncStorage.getItem(key(chainId));
  if (!raw) return { backedUp: false };
  return { backedUp: true, lastBackupAt: raw };
}

export async function clearBackupState(chainId: number): Promise<void> {
  await AsyncStorage.removeItem(key(chainId));
}

const REHEARSAL_PREFIX = "minerva.wallet.backup-rehearsal.v1";

/** Records a successful recovery rehearsal (decrypt + sign check of the Recovery Kit). */
export async function markRehearsed(chainId: number): Promise<void> {
  await AsyncStorage.setItem(`${REHEARSAL_PREFIX}.${chainId}`, new Date().toISOString());
}

export async function getRehearsalState(chainId: number): Promise<{ lastRehearsalAt?: string }> {
  const raw = await AsyncStorage.getItem(`${REHEARSAL_PREFIX}.${chainId}`);
  return raw ? { lastRehearsalAt: raw } : {};
}

