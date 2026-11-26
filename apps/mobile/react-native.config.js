// react-native-worklets@0.5.2 is present only for its Babel plugin, which
// babel-preset-expo (SDK 52) resolves for the web/desktop bundle. Its Android
// native module targets a newer React Native + the new architecture and fails
// `assertMinimalReactNativeVersionTask` on RN 0.76.5. reanimated 3.16 ships its
// own worklets runtime, so the standalone native module is not needed — exclude
// it from native autolinking so the Android APK can build.
//
// `expo` ships its own react-native.config.js, but under pnpm's isolated node_modules the
// autolinker cannot always load it and falls back to scanning the module, where it derives the
// Java package from the Gradle namespace ("expo.core") while the class lives in "expo.modules".
// State the import explicitly so PackageList.java always compiles.
//
// @walletconnect/react-native-compat ships a TurboModule whose Gradle codegen points at a `src/`
// directory that is missing from the published package, so `RNWalletConnectModuleSpec` is never
// generated and `compileReleaseKotlin` fails under the new architecture (2.17.x through 2.26.0).
// The JS shim only uses that module for the app name/id and `isAppInstalled`, and falls back to
// expo-application when it is not linked, so the native side is excluded on both platforms.
module.exports = {
  dependencies: {
    "react-native-worklets": {
      platforms: { android: null, ios: null },
    },
    "@walletconnect/react-native-compat": {
      platforms: { android: null, ios: null },
    },
    expo: {
      platforms: {
        android: {
          packageImportPath: "import expo.modules.ExpoModulesPackage;",
          packageInstance: "new ExpoModulesPackage()",
        },
      },
    },
  },
};
