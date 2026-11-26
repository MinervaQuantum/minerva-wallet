# Minerva Wallet

Post-quantum (ML-DSA-65) smart-account wallet for the Minerva network: mobile (Expo), browser
extension (Plasmo) and desktop (Tauri) share the same packages. Brand assets come from the
Minerva graphics set (symbol, horizontal lockup, token mark) and live in `apps/mobile/assets/`,
`apps/extension/assets/` and `apps/desktop/src-tauri/icons/`.

Minerva is a Minerva Network wallet with EVM-compatible `0x` smart-account addresses and PQ-native validation.

The product direction is defined by the Minerva Wallet UX master prompt and the 0x Smart Account Address Model:

- Every user receives a normal EVM-compatible `0x` address on Minerva Network.
- That address represents an EVM smart account, not a legacy EOA.
- Quantum readiness lives in smart account validation logic, not in a new address format.
- The public account identity stays stable through recovery, key rotation, and security upgrades.
- The wallet must be honest about legacy, hybrid, PQ-ready, PQ-native, and external dependency boundaries.

## Checkout

The apps link `@minerva/sdk`, `@minerva/pq-native-tx` and `@minerva/chain-config` from the
network repository by relative path, so clone it beside this one as `network/`:

```sh
git clone https://github.com/MinervaQuantum/minerva-network network
git clone https://github.com/MinervaQuantum/minerva-wallet wallet
cd network && pnpm install && pnpm --filter "./packages/**" run build
cd ../wallet && pnpm install
```

## Repository Layout

This is a pnpm + Turborepo monorepo:

```
apps/
├── mobile/        Expo + React Native + TypeScript (primary product)
├── desktop/       Tauri v2 shell — macOS / Windows / Ubuntu (wraps the mobile web export)
└── extension/     Plasmo + React + TypeScript (browser dapp surface)

packages/
├── contracts/     Foundry / Solidity smart account contracts
├── core/          @minerva/core         — account model, security states, warnings
├── keystore/      @minerva/keystore     — platform key-vault seam (mobile/desktop/web)
├── ui-tokens/     @minerva/ui-tokens    — design tokens (colors, spacing, typography, badges)
├── wallet-policy/ @minerva/wallet-policy — dapp permissions, session keys, warning rules
└── evm/           @minerva/evm          — viem helpers, chain config, AA seam

docs/              UX documentation (see below)
```

## Getting Started

Prerequisites:

- Node.js ≥ 20
- pnpm ≥ 10
- Foundry (`forge`) for the contracts package

Install workspace dependencies:

```sh
pnpm install
```

Run the mobile app:

```sh
pnpm dev:mobile
```

Run the browser extension:

```sh
pnpm dev:extension
```

Run the desktop app (needs Rust + Linux webkit2gtk deps — see
[`apps/desktop/README.md`](apps/desktop/README.md)):

```sh
pnpm --filter @minerva/desktop dev
```

Type-check everything:

```sh
pnpm typecheck
```

Build / test contracts:

```sh
pnpm forge:build
pnpm forge:test
```

## Brand

The wallet apps share the **Minerva Network** brand: dark `mv-black` (`#06071a`) background, `mv-bone` (`#e1e5fb`) text, hairline `mv-line` dividers, Space Grotesk display / Inter body / JetBrains Mono labels. Tokens mirror the Minerva Network website `apps/web/app/globals.css` `@theme` block. See [`docs/visual-specs.md`](docs/visual-specs.md) for the full palette and component table.

## 0.2.1 (2026-11-17)

- Extension: the `tabs` permission is no longer requested. Nothing needed it: messaging and opening
  tabs never required it, and reading a connected tab's origin is covered by the host permissions.
  The Chrome Web Store rejected 0.2.0 for requesting it unused.
- Extension: the transaction review now shows every recipient-risk warning (zero and burn addresses,
  system contracts, self-sends, look-alike addresses, value to a contract); critical ones must be
  acknowledged before "Sign and send" enables. Previously only approval warnings were rendered.
- Extension: activity entries for RPC-submitted transactions were recorded as failed because the
  submit path returns "pending" before a receipt exists. They are now recorded as pending and
  settled from the receipt on the next activity read.
- SDK scripts: `packages/sdk/scripts/fund-test-account.mts` sends test MRV and MTT from the treasury
  to an address (demos, screenshots).

## 0.2.0 (2026-11-08)

Parity work against MetaMask and Phantom, all platforms unless noted.

- **Accounts.** One keyring, many accounts: create additional ML-DSA-65 accounts, import a
  Recovery Kit as an extra account, add watch-only addresses, rename, hide, reorder and remove.
  Profiles are chain-agnostic (the same key is the same address on every Minerva network); the
  legacy per-chain record migrates into the primary slot on first launch. Extension: account
  switcher in the popup header, per-account site grants.
- **Tokens.** ERC-20 balances on Home and in the popup, add by contract address, hide/remove,
  automatic discovery through the public indexer (`/address/<addr>/assets`), token sends as
  `executePQ` calls carrying `transfer()` calldata. The testnet ships MTT
  (`0x411F287585f9aeaCfA1A03A229662e89B2e5B6f1`) as a default token.
- **Collectibles (mobile).** ERC-721 / ERC-1155 gallery with metadata, add collection by
  address, indexer discovery, send. MTC (`0xa3cb144C854317C247611dF08B8970792e521956`) is the
  default testnet collection.
- **Dapp connectivity (mobile).** In-app browser with an injected EIP-1193 / EIP-6963 provider,
  connection and signing review screens with the same ML-DSA message proofs as the extension,
  per-site sessions, and WalletConnect v2 (Reown WalletKit) when
  `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` is set at build time.
- **Transaction management.** Fee editor on review (slow / normal / fast / custom gwei), a
  pending queue on Home with speed-up and cancel by native-nonce replacement, and receipts that
  record the envelope nonce and fee caps.
- **Review safety.** Recipient risk checks (zero and burn addresses, Minerva system contracts,
  self-sends, address-poisoning look-alikes against contacts and recent recipients, value to a
  contract without calldata), decoded token and NFT balance changes, explicit acknowledgement
  for critical warnings.
- **Networks.** Custom RPC networks (probe, add, remove), RPC override for built-ins, live
  health per network, mainnet 77139 listed as reserved until it answers.
- **Notifications (mobile).** Local notifications for incoming MRV, confirmations and overdue
  Recovery Kit rehearsals, from an indexer poll in the background (expo-background-fetch) and on
  foreground. No push server.
- **Extension polish.** Per-site permission management with revoke per account, auto-lock
  (1/5/15/60 minutes or never) backed by `chrome.storage.session` and `chrome.alarms`, portfolio
  view.

Not device-tested in this iteration: WebView, WalletConnect, notifications and background fetch
were verified by typecheck, the web export and offline unit checks only.

## 0.1.3 (2026-11-07)

- In-app update check: the apps read the signed release manifest
  `https://testnet.minervachain.org/downloads/latest.json` (written by `scripts/publish-wallets.sh`)
  and show a notice on Home, in About and in the extension header when a newer version exists.
  Nothing is downloaded or installed automatically.
- Activity from the public indexer (`https://testnet.minervachain.org/api/indexer`) instead of
  RPC-only reads.
- Transaction review names known calls (ERC-20 transfer/approve, Minerva account functions) and
  flags unrecognised selectors.
- Notification signals for an available update and a Recovery Kit that was never rehearsed.
- Address book export and import as JSON (labels and addresses only).
- Bridge screens state that the bridge is not deployed on this testnet.
- Maestro UI flows under `apps/mobile/maestro/` (see its README).
- Guardian recovery design and the deployment constraint: `docs/guardian-recovery.md`.

## Current Build Status

**Minerva testnet (2026-10-23).** Version 0.2.1 of all three wallets targets the relaunched Minerva
testnet (chain 77138, genesis `0x364c9c46...af38`, `https://testnet.minervachain.org`) by default:
ML-DSA-65 control keys, `MinervaPQTxV1` native transactions, key rotation, device keys with
scopes, recovery rehearsal and the transaction review model. It is the first release built from
the Minerva-only sources (`@minerva/*` packages, `minerva_*` RPC namespace, metadata-free
system-contract bytecode); 0.1.0 and 0.1.1 derive account addresses for the previous chain and
cannot be used. The Chrome extension is on the Chrome Web Store:
`https://chromewebstore.google.com/detail/minerva-wallet/iegidkffkmhmbmdhckcgdcphjkakjjno` (published 2026-11-19).
Published artifacts: `https://testnet.minervachain.org/downloads/0.2.1/` (`SHA256SUMS` signed with
ML-DSA-65; verify with `pnpm --filter @minerva/pq-native-tx release:pq verify wallet-release.pub SHA256SUMS SHA256SUMS.mldsa65.json`
from `../network`). Artifacts come from `scripts/release-wallets.sh`
(`pnpm release:wallets`) and are published by `scripts/publish-wallets.sh`: Chrome and Firefox extension zips, the static web export, Tauri desktop
bundles for the building OS, and a signed Android APK when a JDK, the Android SDK and
`MINERVA_ANDROID_KEYSTORE` are available. `.github/workflows/release.yml` produces the macOS and
Windows desktop bundles; there is no iOS build without an Apple Developer account.

The text below describes the earlier Minerva devnet/testnet slice and still applies to the
screens and flows it lists.


This slice ships a UI-first foundation plus Minerva Devnet/Testnet integration. The mobile wallet can read MRV balance/deployment/readiness state from a running Minerva Network node, request faucet MRV, deploy the Minerva Account through the PQ submitter, sign `executeMessage(...)` locally with ML-DSA-65, and relay a real `executePQ` transfer as `MinervaPQTxV1`.

What's real:

- Monorepo structure, type-checked shared packages.
- All 17 mobile screens from the SWallet adaptation brief, navigable via Expo Router.
- Browser extension popup and options shell, with a stub EIP-1193 provider.
- Foundry contracts compile and tests pass at `packages/contracts/`.
- Minerva chain config: Devnet `77137`, Testnet `77138`, MRV gas coin, RPC gateway, faucet, and PQ raw transaction submitter.
- Live mobile reads for MRV balance, deployment state, readiness, and `PQ Native` status.
- Wallet-owned devnet ML-DSA key generation, secure native storage, account deployment, and PQ transfer relay.

What's mocked:

- Production backup/recovery for PQ keys
- Activity indexing
- Dapp connections
- Recovery / rotation transitions
- Bundler / paymaster flows outside Minerva Devnet

Run the Minerva devnet stack first:

```sh
cd ../MinervaNetwork
pnpm devnet:start
pnpm rpc:start
pnpm faucet:start
pnpm pq-relayer:start
```

Then run the mobile app with `apps/mobile/.env.example` values.

For Minerva Testnet, use the testnet env template:

```sh
cp apps/mobile/.env.testnet.example apps/mobile/.env
pnpm dev:mobile
```

The shared defaults are:

```text
EXPO_PUBLIC_MINERVA_CHAIN_ID=77138
EXPO_PUBLIC_MINERVA_RPC_URL=https://testnet.minervachain.org/rpc
EXPO_PUBLIC_MINERVA_FAUCET_URL=https://testnet.minervachain.org
EXPO_PUBLIC_MINERVA_PQ_RELAYER_URL=https://testnet.minervachain.org
```

These are also the built-in defaults: with no `EXPO_PUBLIC_*` variables the apps talk to the
Minerva testnet (chain 77138). The local devnet (77137) needs an explicit `EXPO_PUBLIC_MINERVA_CHAIN_ID`.

Run the wallet acceptance flow against testnet with:

```sh
pnpm mobile:testnet-acceptance
```

Run the browser-extension standalone wallet acceptance flow against testnet with:

```sh
pnpm extension:testnet-acceptance
```

To create a wallet-owned PQ treasury vault profile for Minerva testnet faucet custody, run the wallet CLI against the testnet PQ relayer:

```sh
EXPO_PUBLIC_MINERVA_CHAIN_ID=77138 pnpm wallet:pq-vault:generate
```

Add `-- --deploy` after the script command to deploy the Minerva Account immediately. The JSON output contains `env.MINERVA_FAUCET_TREASURY_VAULT`; put that address into the Minerva Network service environment, for example `../MinervaNetwork/.env.testnet.local` in a sibling checkout. Store the JSON privately because it includes the ML-DSA private key that controls the vault.

Each screen with multiple states exposes a "State: …" cycle button at the bottom so design review can flip through the States / Warnings / Edge cases listed in the brief.

## UX Documentation

- [Product Brief](docs/product-brief.md)
- [UX Map](docs/ux-map.md)
- [UX Architecture](docs/ux-architecture.md)
- [User Flows](docs/user-flows.md)
- [MVP Flow Specification](docs/mvp-flow-spec.md)
- [Low-Fidelity Wireframes](docs/low-fidelity-wireframes.md)
- [SWallet UI Adaptation](docs/swallet-ui-adaptation.md)
- [Screen Requirements](docs/screen-requirements.md)
- [UX Acceptance Criteria](docs/ux-acceptance-criteria.md)
- [Copy Library](docs/copy-library.md)
- [Security State System](docs/security-state-system.md)
- [Data Model](docs/data-model.md)
- [Risk and Warning System](docs/risk-warning-system.md)
- [Implementation Plan](docs/implementation-plan.md)

## Contracts

Smart account scaffolding lives in `packages/contracts/`.

- [Contract Architecture](docs/contract-architecture.md)
