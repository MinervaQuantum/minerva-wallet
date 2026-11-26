/**
 * Native entry: loads the WalletConnect React Native polyfills (TextEncoder, crypto.getRandomValues,
 * URL, Buffer, atob/btoa, NetInfo/Application globals). It must run before any other module, so it is
 * the first import of app/_layout.tsx. The `.web.ts` sibling is empty: the web/desktop export already
 * has these globals and must not pull native-only modules into the bundle.
 */
import "@walletconnect/react-native-compat";

export {};
