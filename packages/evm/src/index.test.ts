import { verifyMLDSA65 } from "@minerva/pq-crypto";
import type { Hex } from "@minerva/core";
import {
  buildTransactionReview,
  UNLIMITED_APPROVAL_WEI,
  deriveMinervaPQAccountAddress,
  defaultMinervaFaucetUrl,
  defaultMinervaIndexerUrl,
  defaultMinervaPQRelayerUrl,
  defaultMinervaRpcUrl,
  generateMLDSA65KeyPair,
  hashMinervaPQTxV1,
  minervaDevnet,
  minervaTestnet,
  MINERVA_DEVNET_CHAIN_ID,
  MINERVA_PQ_TX_CONTEXT,
  MINERVA_PQ_TX_TYPE_HEX,
  MINERVA_TESTNET_CHAIN_ID,
  MINERVA_TESTNET_EXPLORER_URL,
  MINERVA_TESTNET_FAUCET_URL,
  MINERVA_TESTNET_INDEXER_URL,
  MINERVA_TESTNET_PQ_RELAYER_URL,
  MINERVA_TESTNET_RPC_URL,
  serializeMinervaPQTxV1,
  signMinervaPQTxV1,
  explorerAddressUrl,
  explorerProofUrl,
  submitMinervaDevPQRawTransaction,
} from "./index";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrows(fn: () => unknown, message: string) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

const seed = new Uint8Array(32);
seed.fill(0x51);
const keypair = generateMLDSA65KeyPair(seed);

const unsigned = {
  chainId: MINERVA_DEVNET_CHAIN_ID,
  nonce: 4n,
  gasTipCap: 1n,
  gasFeeCap: 10n,
  gas: 50_000n,
  factorySalt: "0x0000000000000000000000000000000000000000000000000000000000000042" as Hex,
  to: "0x000000000000000000000000000000000000dEaD" as Hex,
  value: 123n,
  data: "0x010203" as Hex,
  accessList: [
    {
      address: "0x0000000000000000000000000000000000000100" as Hex,
      storageKeys: ["0x0000000000000000000000000000000000000000000000000000000000000001" as Hex],
    },
  ],
  pqPublicKey: keypair.publicKey,
};

const signed = signMinervaPQTxV1({ ...unsigned, pqPrivateKey: keypair.privateKey });
const account = deriveMinervaPQAccountAddress(keypair.publicKey, unsigned.factorySalt);

expect(signed.transaction.account === account, "account must be derived from the public key and salt");
expect(signed.signingHash === hashMinervaPQTxV1(unsigned), "signing hash must match the unsigned tx");
expect(signed.rawTransaction.startsWith(MINERVA_PQ_TX_TYPE_HEX), "raw tx must use Minerva typed transaction 0x04");
expect(
  signed.rawTransaction === serializeMinervaPQTxV1(signed.transaction),
  "raw tx must serialize the signed envelope deterministically",
);
expect(
  verifyMLDSA65(signed.signature, signed.signingHash, keypair.publicKey, { context: MINERVA_PQ_TX_CONTEXT }),
  "signature must verify against the MinervaPQTxV1 hash",
);
expect(
  hashMinervaPQTxV1({ ...unsigned, chainId: 77138 }) !== signed.signingHash,
  "chain ID must be domain separated into the signing hash",
);
expect(defaultMinervaRpcUrl(MINERVA_TESTNET_CHAIN_ID) === MINERVA_TESTNET_RPC_URL, "testnet RPC default must be live public RPC");
expect(
  defaultMinervaFaucetUrl(MINERVA_TESTNET_CHAIN_ID) === MINERVA_TESTNET_FAUCET_URL,
  "testnet faucet default must share the live public origin",
);
expect(
  defaultMinervaPQRelayerUrl(MINERVA_TESTNET_CHAIN_ID) === MINERVA_TESTNET_PQ_RELAYER_URL,
  "testnet PQ relayer default must share the live public origin",
);
{
  const expectedHash = `0x${"12".repeat(32)}` as Hex;
  const originalFetch = globalThis.fetch;
  let rpcSubmitSeen = false;
  let relayerSeen = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/pq-dev/send-raw")) relayerSeen = true;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url === MINERVA_TESTNET_RPC_URL && body.method === "minerva_sendRawPQTransaction") {
      rpcSubmitSeen = true;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: expectedHash }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    const receipt = await submitMinervaDevPQRawTransaction("0x04", { chainId: MINERVA_TESTNET_CHAIN_ID });
    expect(receipt.transactionHash === expectedHash, "public testnet PQ submit must return RPC transaction hash");
    expect(receipt.status === "pending", "public testnet RPC submit must return pending receipt status");
    expect(rpcSubmitSeen, "public testnet PQ submit must call minerva_sendRawPQTransaction");
    expect(!relayerSeen, "public testnet PQ submit must not call /pq-dev/send-raw before RPC");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
expect(
  defaultMinervaIndexerUrl(MINERVA_TESTNET_CHAIN_ID) === MINERVA_TESTNET_INDEXER_URL,
  "testnet indexer default must route through Explorer Lite",
);
expect(
  (MINERVA_TESTNET_EXPLORER_URL ? minervaTestnet.blockExplorers?.default.url : minervaTestnet.blockExplorers) ===
    (MINERVA_TESTNET_EXPLORER_URL || undefined),
  "testnet explorer must point at the public explorer when one is configured",
);
expect(
  explorerAddressUrl(account, MINERVA_TESTNET_CHAIN_ID) === `${MINERVA_TESTNET_EXPLORER_URL}/address/${account}`,
  "address explorer links must use the public explorer",
);
expect(
  explorerProofUrl(`pq-accounts/${account}`, MINERVA_TESTNET_CHAIN_ID) ===
    `${MINERVA_TESTNET_EXPLORER_URL}/proofs/pq-accounts/${account}`,
  "proof explorer links must use the public explorer proofs path",
);
expect(
  minervaDevnet.blockExplorers?.default.url === "http://127.0.0.1:18547",
  "devnet explorer must remain local",
);
expectThrows(
  () => signMinervaPQTxV1({ ...unsigned, pqPublicKey: "0x1234", pqPrivateKey: keypair.privateKey }),
  "invalid ML-DSA public keys must be rejected before serialization",
);
expectThrows(
  () =>
    signMinervaPQTxV1({
      ...unsigned,
      account: "0x1234567890123456789012345678901234567890",
      pqPrivateKey: keypair.privateKey,
    }),
  "mismatched account binding must be rejected before serialization",
);

console.log("[minerva-evm] MinervaPQTxV1 encoder ok");

// ---- transaction review model
{
  const target = "0x1111111111111111111111111111111111111111" as Hex;
  const sim = { willSucceed: true, maxFeeWei: 21_000n * 2_000_000_000n, senderBalanceBeforeWei: 10n ** 18n };
  const burn = buildTransactionReview({ target: "0x000000000000000000000000000000000000dEaD" as Hex, valueWei: 1n, nativeSymbol: "MRV", simulation: sim, targetHasCode: false });
  if (!burn.warnings.some((w) => w.id === "burn-address")) throw new Error("burn address must warn");
  const poisoned = buildTransactionReview({
    target: "0x1111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1111" as Hex,
    valueWei: 1n,
    nativeSymbol: "MRV",
    simulation: sim,
    targetHasCode: false,
    contacts: [{ label: "Alice", address: target }],
  });
  if (!poisoned.warnings.some((w) => w.id === "address-poisoning" && w.severity === "critical")) throw new Error("look-alike recipient must be flagged");
  const system = buildTransactionReview({ target: "0x0000000000000000000000000000000000000203" as Hex, valueWei: 1n, nativeSymbol: "MRV", simulation: sim, targetHasCode: true });
  if (!system.warnings.some((w) => w.id === "system-contract")) throw new Error("system contract recipient must be flagged");
  const tokenSend = buildTransactionReview({
    target: "0x2222222222222222222222222222222222222222" as Hex,
    valueWei: 0n,
    data: ("0xa9059cbb" + target.slice(2).padStart(64, "0") + (10n ** 18n).toString(16).padStart(64, "0")) as Hex,
    nativeSymbol: "MRV",
    simulation: sim,
    targetHasCode: true,
    token: { symbol: "MTT", decimals: 18 },
    knownAddresses: ["0x2222222222222222222222222222222222222222" as Hex],
  });
  if (!tokenSend.action.startsWith("Send 1 MTT") || !tokenSend.balanceChanges.some((c) => c.kind === "token" && c.label === "−1 MTT")) {
    throw new Error(`token transfer review wrong: ${tokenSend.action} ${JSON.stringify(tokenSend.balanceChanges.map((c) => c.label))}`);
  }
  const plain = buildTransactionReview({ target, valueWei: 10n ** 17n, nativeSymbol: "MRV", simulation: sim, targetHasCode: false });
  if (plain.simulation.state !== "ok" || plain.approval || plain.contractCall || plain.unknownContract) throw new Error("plain transfer review wrong");
  if (plain.balanceChanges.length !== 2 || plain.balanceChanges[0]?.deltaWei !== -(10n ** 17n) || plain.balanceChanges[1]?.kind !== "fee") throw new Error("balance changes wrong");
  if (plain.warnings.length !== 0 || !plain.disclaimer.includes("not a guarantee")) throw new Error("plain transfer should carry no warnings");

  const spender = "0x1111111111111111111111111111111111111111";
  const approve = `0x095ea7b3${spender.slice(2).padStart(64, "0")}${UNLIMITED_APPROVAL_WEI.toString(16).padStart(64, "0")}` as Hex;
  const approval = buildTransactionReview({ target, valueWei: 0n, data: approve, nativeSymbol: "MRV", simulation: sim, targetHasCode: true });
  if (!approval.approval?.unlimited || approval.approval.spender.toLowerCase() !== spender) throw new Error("unlimited approval not decoded");
  if (!approval.warnings.some((w) => w.id === "unlimited-approval") || !approval.warnings.some((w) => w.id === "unknown-contract")) throw new Error("approval warnings missing");
  if (!approval.action.startsWith("Approve unlimited")) throw new Error(`approval action: ${approval.action}`);

  const known = buildTransactionReview({ target, valueWei: 0n, data: "0xdeadbeef", nativeSymbol: "MRV", simulation: sim, targetHasCode: true, knownAddresses: [target] });
  if (known.unknownContract || !known.warnings.some((w) => w.id === "contract-call")) throw new Error("known contract call wrong");

  const reverts = buildTransactionReview({ target, valueWei: 1n, nativeSymbol: "MRV", simulation: { ...sim, willSucceed: false, revertReason: "nope" } });
  if (reverts.simulation.state !== "reverts" || !reverts.warnings.some((w) => w.severity === "critical")) throw new Error("revert not flagged");

  const poor = buildTransactionReview({ target, valueWei: 10n ** 19n, nativeSymbol: "MRV", simulation: sim });
  if (!poor.warnings.some((w) => w.id === "insufficient-funds")) throw new Error("insufficient funds not flagged");

  const unavailable = buildTransactionReview({ target, valueWei: 1n, nativeSymbol: "MRV", simulationError: "rpc down" });
  if (unavailable.simulation.state !== "unavailable" || !unavailable.warnings.some((w) => w.id === "simulation-unavailable")) throw new Error("unavailable not flagged");

  const skipped = buildTransactionReview({ target, valueWei: 1n, nativeSymbol: "MRV", requestingApp: { name: "dapp.example", verified: false } });
  if (skipped.simulation.state !== "skipped" || !skipped.warnings.some((w) => w.id === "unverified-app") || !skipped.requestingApp.startsWith("dapp.example")) throw new Error("skipped/unverified wrong");
  console.log("[minerva-evm] transaction review ok");
}

