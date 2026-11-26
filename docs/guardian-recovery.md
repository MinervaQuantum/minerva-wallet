# Guardian recovery: design and the deployment constraint

Status: specified, not implemented. The wallet's Guardians screen says so and points to the
Recovery Kit, which is the shipped recovery path.

## What it is

A recovery policy stored in the account contract: a set of guardian key commitments (ML-DSA-65
public-key hashes, which may belong to other Minerva accounts) and a threshold. A quorum of
guardian signatures over `(account, newPQPublicKey, expectedNonce, chainId, domain)` lets the
account rotate to a new Control Key without the current key. The rotation ends in the same
registry write as `rotatePQKey`: new commitment, incremented policy version, same address, so the
node rule that rejects rotated-out keys applies unchanged.

Proposed contract surface on `MinervaAccount`:

| Function | Signed by | Effect |
|---|---|---|
| `setRecoveryPolicy(bytes32[] guardians, uint8 threshold, uint64 delay, uint256 expectedNonce, bytes signature)` | current Control Key | stores the policy; emits `RecoveryPolicySet` |
| `proposeRecovery(bytes newPQPublicKey, bytes[] guardianSignatures)` | threshold of guardians | records a pending rotation with `executeAfter = now + delay`; emits `RecoveryProposed` |
| `cancelRecovery(uint256 expectedNonce, bytes signature)` | current Control Key | cancels a pending proposal (the owner still holds the key) |
| `executeRecovery()` | anyone | after the delay, performs the rotation and writes the registry |

The delay gives the current key holder a window to cancel a hostile recovery. Guardian
signatures use the account context `MINERVA_ACCOUNT_V1` with a `RECOVER` operation tag, so they
cannot be replayed as transactions or other account messages.

## Why it is not shipped yet

`MinervaAccount` bytecode is part of the account creation code embedded in the genesis factory and
in the node, the SDK and the wallet. Changing the contract changes every CREATE2-derived address,
so the change can only ship with a new genesis (a testnet relaunch) and a coordinated release of
the node, SDK and wallet. The 2026-10-23 relaunch already carried one such change. Guardian
recovery should therefore be bundled with the next planned genesis change rather than deployed on
its own, and it needs the account control registry layout review and the Foundry scope tests
extended to the recovery path before that.

## Wallet work that does not wait for the contract

- Guardian list management as local, signed metadata (labels, commitments) so the policy can be
  submitted the moment the contract exists.
- A recovery rehearsal that exercises the Recovery Kit end to end on the devnet (shipped).
- Notification signals for "Recovery Kit never rehearsed" and "Control Key never rotated" (shipped).
