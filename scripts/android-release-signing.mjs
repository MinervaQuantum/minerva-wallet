// Adds a release signing config to the Expo-generated android/app/build.gradle, reading the
// keystore from gradle.properties (MINERVA_UPLOAD_*). Idempotent.
import fs from "node:fs";
const file = process.argv[2];
let s = fs.readFileSync(file, "utf8");
if (!s.includes("MINERVA_UPLOAD_STORE_FILE")) {
  s = s.replace(/signingConfigs \{\n\s*debug \{/, `signingConfigs {
        release {
            if (project.hasProperty('MINERVA_UPLOAD_STORE_FILE')) {
                storeFile file(MINERVA_UPLOAD_STORE_FILE)
                storePassword MINERVA_UPLOAD_STORE_PASSWORD
                keyAlias MINERVA_UPLOAD_KEY_ALIAS
                keyPassword MINERVA_UPLOAD_KEY_PASSWORD
            }
        }
        debug {`);
  s = s.replace(/release \{\n(\s*)\/\/ Caution! In production, you need to generate your own keystore file\.\n\s*\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n\s*signingConfig signingConfigs\.debug/, (m, indent) => `release {\n${indent}signingConfig signingConfigs.release`);
  if (!s.includes("signingConfig signingConfigs.release")) {
    s = s.replace(/(buildTypes \{[\s\S]*?release \{[^}]*?)signingConfig signingConfigs\.debug/, "$1signingConfig signingConfigs.release");
  }
  fs.writeFileSync(file, s);
}
console.log(s.includes("signingConfig signingConfigs.release") ? "release signing configured" : "WARNING: release signing block not applied");
