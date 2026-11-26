# Minerva Wallet Privacy Policy

Last updated: November 17, 2026. Applies to Minerva Wallet 0.2.1 and later.

Minerva Wallet is a self-custody wallet for the Minerva network. This policy
explains what data the wallet handles, where that data is stored, when it leaves
your device, and what the publisher never collects.

It covers the Minerva Wallet browser extension and the Minerva Wallet mobile and
desktop apps. Where the extension differs, the section says so.

## Summary

- Keys and passcodes never leave your device. Account keys are generated locally
  and stored encrypted under your passcode.
- No analytics, telemetry, tracking or advertising SDKs are included in any
  Minerva Wallet app.
- The wallet talks to the network through RPC and indexer endpoints. Those
  servers receive your public account address, your transactions and, like any
  web server, your IP address. The default endpoints are operated by the Minerva
  project and keep standard access logs for 14 days.
- User data is never sold, never used for advertising or profiling, and never
  used for creditworthiness or lending decisions.

## Data the wallet handles

Minerva Wallet handles the following data to do its job:

- Public account addresses, public keys and account labels you choose.
- MRV balances, token balances and the list of tokens you track.
- Transaction requests, signed transactions, transaction hashes and local
  transaction history.
- Connection permissions for websites you approve, keyed by site origin.
- Pending approval requests and their results while a request is open.
- The encrypted keystore holding your account keys.
- Settings: selected network, auto-lock duration, fee preferences and
  notification preferences.

In the Chrome Web Store data categories this is "Financial and payment
information" (addresses, balances, transactions) and "Authentication
information" (the passcode and the encrypted keystore it protects). The wallet
handles both on your device; it does not transmit either to the publisher.

## Data the wallet does not collect

Minerva Wallet does not collect, store or transmit:

- Names, email addresses, phone numbers or government identifiers.
- Health information, personal communications or location data.
- Browsing history, page content, clicks, keystrokes or any website activity.
- Advertising identifiers or device fingerprints.

The browser extension's content script only announces the wallet provider to
the page and relays requests the page explicitly makes to the wallet. It does
not read page content, cookies or form data.

## Where data is stored

Browser extension:

- `chrome.storage.local` holds the encrypted keystore, a plaintext preview of
  each account (chain id, address, public key, key version, label), tracked
  tokens, site connection permissions, pending requests, recent responses,
  local activity history and settings.
- `chrome.storage.session` holds the unlock session. It lives in memory only,
  is never written to disk and is cleared when the browser exits or when the
  auto-lock timer fires.

Mobile and desktop apps store the same wallet state in the platform's app
storage, using the secure key store where the platform provides one.

Private keys exist in plaintext only in memory while the wallet is unlocked and
signing. Minerva Wallet never stores private keys or passcodes unencrypted.

## Network requests

The wallet makes only the requests needed to operate:

- Minerva RPC endpoints, by default `https://testnet.minervachain.org/rpc`, to
  read balances, blocks, account state and receipts and to submit signed
  transactions.
- The Minerva indexer, by default under `https://testnet.minervachain.org/`, to
  discover tokens held by an address and to list activity.
- The testnet faucet, only when you press Faucet.
- Websites you connect to, only after you approve the connection, and only the
  data described under "Connected websites".

Servers receiving these requests see your public account address, the signed
transaction payload, the transaction hash and your IP address. Every public
blockchain transaction is permanently visible on the network and in explorers.

The default RPC, indexer and faucet are operated by the Minerva project behind
Cloudflare. They keep ordinary web server access logs (IP address, request path,
time, user agent) for operational troubleshooting and abuse prevention. Logs
rotate daily and are deleted after 14 days. They are not combined with other
data, not used to identify users and not shared except as described under
"Data sharing". Cloudflare processes requests in transit under its own privacy
policy. You can point the wallet at an RPC endpoint you operate yourself in the
network settings.

The wallet does not send any data to a publisher analytics server, because
there is none. This version does not use WalletConnect or any third-party relay.

## Connected websites

When a website asks to connect, the wallet shows an approval screen naming the
site and the accounts it would see. An approved site can read the addresses you
granted and can ask you to sign messages or transactions. Every signing or
transaction request is shown to you for review before anything is signed. Sites
never receive private keys, your passcode or your other accounts.

You can revoke any site, per account, at any time from Options in the extension
or from Settings in the apps. Revoking a site also notifies open tabs of that
site that the account is disconnected.

## Browser extension permissions

- `storage`: holds the encrypted keystore, settings, tracked tokens, site
  permissions, pending requests and local activity history on your device.
- `scripting`: registers one content script in the page's main world that
  exposes the standard wallet provider (EIP-1193 and EIP-6963) so websites can
  find the wallet. It never reads or changes page content.
- `alarms`: runs the auto-lock timer so the wallet locks after the time you
  choose even when the popup is closed.
- Host permissions on `http://*/*` and `https://*/*`: decentralised
  applications can live on any domain, so the provider script must be available
  on every page. It only announces the provider and relays requests the page
  makes to the wallet. The same host access lets the wallet find the open tabs
  of a site you have connected, so it can tell them when an account is
  disconnected; the wallet requests no separate `tabs` permission.

No permission is used for any purpose beyond providing the wallet and website
connection features. No code is loaded from remote servers.

## Data sharing

Minerva Wallet does not sell user data and does not transfer it to third parties
except as required to perform an action you request: sending a signed
transaction to the network, querying an RPC or indexer for your balances, or
handing an approved website the account address you granted.

The publisher may disclose server log data when required by law or to respond
to a security incident. Data is never used or transferred for advertising,
creditworthiness assessment or lending.

## Security

Account keys are ML-DSA-65 key pairs generated on your device and encrypted
under your passcode. The wallet never displays private keys and never provides
them to websites. Recovery Kits you export are your responsibility to store
safely. No software wallet removes all risk; keep your device, browser profile,
passcode and recovery materials secure.

## Your controls

- Revoke individual site connections from Options or Settings.
- Change the auto-lock duration or lock the wallet manually.
- Hide, rename or remove accounts.
- Wipe all wallet data from the wallet UI, which deletes the encrypted
  keystore, accounts, activity history, site permissions and settings from
  local storage.
- Uninstall the extension or app, which removes all its local data.

Because the publisher operates no user-account backend, there is no server-side
account to delete. Transactions already published to the blockchain cannot be
removed.

## Children

Minerva Wallet is not directed to children and does not knowingly collect data
from anyone.

## Changes to this policy

Material changes are reflected in this document and in the release notes of the
wallet version that introduces them. The "Last updated" date and the applicable
version are shown at the top.

## Contact

Privacy or security questions: through the project site at
https://minervachain.org. The wallet's source code and release notes are
published with each version at https://testnet.minervachain.org/downloads/.
