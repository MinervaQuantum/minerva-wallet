import type { Hex } from "@minerva/core";
import {
  EXTENSION_ACCOUNTS_STORAGE_KEY,
  EXTENSION_WALLET_STORAGE_KEY,
  addExtensionAccount,
  createExtensionWalletProfile,
  listExtensionAccounts,
  loadExtensionAccounts,
  readExtensionActivity,
  setActiveExtensionAccount,
  unlockExtensionWalletProfile,
  wipeExtensionWallet,
  type ExtensionAccountsRegistry,
} from "../lib/extensionWalletVault";
import {
  readExtensionWalletSnapshot,
  requestExtensionFaucet,
  sendExtensionMrv,
} from "../lib/extensionWalletRuntime";

declare const process: {
  env: Record<string, string | undefined>;
  stderr: { write(message: string): void };
  exit(code?: number): never;
};

const storage = new Map<string, unknown>();

function installChromeStorageShim() {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get(key: string | string[] | Record<string, unknown> | null, callback: (items: Record<string, unknown>) => void) {
          if (typeof key === "string") {
            callback({ [key]: storage.get(key) });
            return;
          }
          if (Array.isArray(key)) {
            callback(Object.fromEntries(key.map((item) => [item, storage.get(item)])));
            return;
          }
          if (key && typeof key === "object") {
            callback(Object.fromEntries(Object.keys(key).map((item) => [item, storage.get(item) ?? key[item]])));
            return;
          }
          callback(Object.fromEntries(storage.entries()));
        },
        set(items: Record<string, unknown>) {
          for (const [key, value] of Object.entries(items)) storage.set(key, value);
          return Promise.resolve();
        },
        remove(key: string | string[]) {
          for (const item of Array.isArray(key) ? key : [key]) storage.delete(item);
          return Promise.resolve();
        },
      },
    },
  };
}

function env(name: string, fallback: string) {
  return process.env[name] ?? fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertAcceptance(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assertAcceptance(globalThis.crypto?.getRandomValues, "Web Crypto getRandomValues is unavailable.");
  installChromeStorageShim();

  const passcode = env("MINERVA_EXTENSION_ACCEPTANCE_PASSCODE", "test-passcode-123");
  const recipient = env("MINERVA_EXTENSION_ACCEPTANCE_TARGET", "0x000000000000000000000000000000000000dEaD") as Hex;
  const amount = env("MINERVA_EXTENSION_ACCEPTANCE_AMOUNT_MRV", "0.001");

  let firstProfile = await createExtensionWalletProfile(passcode);
  let { snapshot: firstSnapshot } = await readExtensionWalletSnapshot(firstProfile, passcode);
  storage.set("minerva:connections", { "https://bridge.example": { origin: "https://bridge.example" } });
  storage.set("minerva:provider-pending.v1", { stale: { requestId: "stale" } });
  storage.set("minerva:provider-responses.v1", { stale: { response: { result: [] } } });
  storage.set("minerva:provider-diagnostics.v1", [{ event: "test" }]);
  await wipeExtensionWallet();
  assertAcceptance(!storage.has(EXTENSION_ACCOUNTS_STORAGE_KEY), "Wipe did not remove the account registry.");
  assertAcceptance(!storage.has(EXTENSION_WALLET_STORAGE_KEY), "Wipe did not remove the legacy wallet record.");
  assertAcceptance(!storage.has("minerva:connections"), "Wipe did not remove connected-site approvals.");
  assertAcceptance(!storage.has("minerva:provider-pending.v1"), "Wipe did not remove pending provider requests.");
  assertAcceptance(!storage.has("minerva:provider-responses.v1"), "Wipe did not remove provider responses.");
  assertAcceptance(!storage.has("minerva:provider-diagnostics.v1"), "Wipe did not remove provider diagnostics.");

  let profile = await createExtensionWalletProfile(passcode);
  let { profile: savedProfile, snapshot } = await readExtensionWalletSnapshot(profile, passcode);
  profile = savedProfile;

  assertAcceptance(snapshot.address.startsWith("0x"), "Extension did not derive a 0x Minerva Account address.");
  assertAcceptance(snapshot.chainId === 77138, `Expected Minerva Testnet chain 77138, got ${snapshot.chainId}.`);
  assertAcceptance(
    snapshot.address.toLowerCase() !== firstSnapshot.address.toLowerCase(),
    "Creating after explicit wipe reused the previous Minerva Account address.",
  );

  const reopenedProfile = await unlockExtensionWalletProfile(passcode);
  const { snapshot: reopenedSnapshot } = await readExtensionWalletSnapshot(reopenedProfile, passcode);
  assertAcceptance(
    reopenedSnapshot.address.toLowerCase() === snapshot.address.toLowerCase(),
    "Unlocking an existing encrypted profile changed the Minerva Account address.",
  );

  // Single-record layout → account registry migration (offline, no network).
  const registry = storage.get(EXTENSION_ACCOUNTS_STORAGE_KEY) as ExtensionAccountsRegistry;
  assertAcceptance(registry?.accounts.length === 1, "Registry does not hold exactly one account after create.");
  storage.delete(EXTENSION_ACCOUNTS_STORAGE_KEY);
  storage.set(EXTENSION_WALLET_STORAGE_KEY, registry.accounts[0].record);
  const migrated = await loadExtensionAccounts();
  assertAcceptance(migrated?.accounts.length === 1 && migrated.accounts[0].label === "Account 1", "Legacy record did not migrate to Account 1.");
  assertAcceptance(!storage.has(EXTENSION_WALLET_STORAGE_KEY), "Migration left the legacy record behind.");
  const migratedAccounts = await listExtensionAccounts();
  assertAcceptance(
    migratedAccounts[0]?.address?.toLowerCase() === snapshot.address.toLowerCase(),
    "Migrated account does not resolve to the original Minerva Account address.",
  );

  // Second account shares the passcode, gets its own address, and the first can be re-selected.
  const { account: secondAccount } = await addExtensionAccount(passcode);
  const twoAccounts = await listExtensionAccounts();
  assertAcceptance(twoAccounts.length === 2 && secondAccount.active, "Adding an account did not create an active second account.");
  assertAcceptance(
    secondAccount.address?.toLowerCase() !== snapshot.address.toLowerCase(),
    "Second account reused the first account's address.",
  );
  await setActiveExtensionAccount(migratedAccounts[0].id);
  const reselected = await unlockExtensionWalletProfile(passcode);
  assertAcceptance(
    reselected.deploymentPublicKey.toLowerCase() === profile.deploymentPublicKey.toLowerCase(),
    "Switching back did not make the first account active.",
  );
  profile = reselected;

  const storedRecord = JSON.stringify(storage.get(EXTENSION_ACCOUNTS_STORAGE_KEY));
  assertAcceptance(!storedRecord.includes('"privateKey"'), "Encrypted wallet record exposes privateKey in plaintext.");
  assertAcceptance(!storedRecord.includes('"currentKey"'), "Encrypted wallet record exposes currentKey in plaintext.");
  assertAcceptance(!storedRecord.includes('"deploymentKey"'), "Encrypted wallet record exposes deploymentKey in plaintext.");

  const faucetReceipt = await requestExtensionFaucet(profile, passcode);

  for (let attempt = 0; attempt < 30; attempt++) {
    ({ profile: savedProfile, snapshot } = await readExtensionWalletSnapshot(profile, passcode));
    profile = savedProfile;
    if (snapshot.deployed && snapshot.balanceWei > 0n) break;
    await sleep(1000);
  }

  assertAcceptance(snapshot.deployed, "Faucet did not deploy the extension Minerva Account.");
  assertAcceptance(snapshot.balanceWei > 0n, "Faucet did not fund the extension Minerva Account.");

  const sendReceipt = await sendExtensionMrv(profile, passcode, { recipient, amount });
  assertAcceptance(sendReceipt.status === "success", "Extension PQ send did not succeed.");
  assertAcceptance(sendReceipt.transactionHash?.startsWith("0x"), "Extension PQ send did not return a tx hash.");

  const activity = await readExtensionActivity();
  assertAcceptance(activity.some((item) => item.hash === faucetReceipt.hash), "Faucet activity was not recorded.");
  assertAcceptance(activity.some((item) => item.hash === sendReceipt.transactionHash), "Send activity was not recorded.");

  ({ snapshot } = await readExtensionWalletSnapshot(profile, passcode));

  console.log(`[minerva-extension-acceptance] account ${snapshot.address}`);
  console.log(`[minerva-extension-acceptance] chain ${snapshot.chainName} (${snapshot.chainId})`);
  console.log(`[minerva-extension-acceptance] balance ${snapshot.balanceLabel}`);
  console.log(`[minerva-extension-acceptance] deployment ${snapshot.deploymentLabel} · ${snapshot.readinessLabel}`);
  console.log(`[minerva-extension-acceptance] faucet tx ${faucetReceipt.hash}`);
  console.log(`[minerva-extension-acceptance] pq transfer tx ${sendReceipt.transactionHash}`);
  console.log("[minerva-extension-acceptance] encrypted vault check ok");
  console.log("[minerva-extension-acceptance] ok");
}

main().catch((error) => {
  process.stderr.write(
    `[minerva-extension-acceptance] ${
      error instanceof Error ? error.message : "extension acceptance failed"
    }\n`,
  );
  process.exit(1);
});
