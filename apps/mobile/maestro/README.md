# Maestro flows

End-to-end UI flows for the mobile app, runnable on an Android emulator or device with
[Maestro](https://maestro.mobile.dev) installed:

```sh
cd apps/mobile
EXPO_PUBLIC_MINERVA_CHAIN_ID=77137 pnpm android      # or a release APK installed on the device
maestro test maestro/
```

Flows use accessibility labels and visible text only, so they run against release builds.

| Flow | Covers |
|---|---|
| `01-onboarding.yaml` | welcome, passcode, key generation, address shown, recovery education |
| `02-receive-and-send.yaml` | receive screen, send form validation, transaction review opens |
| `03-security-center.yaml` | security tab rows, key rotation and device keys screens, recovery rehearsal entry |
| `04-update-and-about.yaml` | about screen, version row, update check result |

The flows are a smoke layer; the protocol behaviour (rotation, device keys, recovery) is verified by
the acceptance scripts under `scripts/` and in the network repository.
