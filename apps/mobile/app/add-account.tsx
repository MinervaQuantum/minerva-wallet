import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { addWatchOnlyAccount, createAccount, importAccountFromKit, setActiveAccount } from "@/lib/accounts";
import { getUnlockedWalletPasscode } from "@/lib/pqDevWallet";
import { colors } from "@minerva/ui-tokens";

type Mode = "create" | "import" | "watch";

const MODES: { id: Mode; title: string; detail: string }[] = [
  { id: "create", title: "New account", detail: "Generate a fresh ML-DSA-65 key and a new 0x address." },
  { id: "import", title: "Import Recovery Kit", detail: "Add an existing Minerva Account from its exported kit." },
  { id: "watch", title: "Watch address", detail: "Follow any 0x address without a key. Read-only." },
];

export default function AddAccount() {
  const snapshot = useAccountSnapshot();
  const [mode, setMode] = useState<Mode>("create");
  const [label, setLabel] = useState("");
  const [kit, setKit] = useState("");
  const [kitPasscode, setKitPasscode] = useState("");
  const [watchAddress, setWatchAddress] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const sessionPasscode = getUnlockedWalletPasscode();
  const needsPasscode = mode !== "watch" && !sessionPasscode;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const walletPasscode = sessionPasscode ?? passcode;
      let created;
      if (mode === "create") {
        created = await createAccount({ label, passcode: walletPasscode, chainId: snapshot.chainId });
      } else if (mode === "import") {
        created = await importAccountFromKit({
          encoded: kit,
          kitPasscode: kitPasscode || undefined,
          label,
          walletPasscode,
          chainId: snapshot.chainId,
        });
      } else {
        created = await addWatchOnlyAccount(watchAddress, label);
      }
      await setActiveAccount(created.id, snapshot.chainId);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the account");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    (mode === "create" || (mode === "import" && kit.trim().length > 0) || (mode === "watch" && watchAddress.trim().length > 0)) &&
    (!needsPasscode || passcode.length >= 8);

  return (
    <PageContainer>
      <PageHeader title="Add account" showBack centerTitle />
      <View className="gap-4">
        <View className="gap-2">
          {MODES.map((m) => (
            <Pressable key={m.id} onPress={() => setMode(m.id)}>
              <Card className={mode === m.id ? "border-mv-line-strong" : undefined}>
                <Text variant="body-lg" weight="semibold">
                  {m.title}
                </Text>
                <Text variant="caption" muted className="mt-0.5">
                  {m.detail}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>

        <Input label="Name (optional)" placeholder={mode === "watch" ? "e.g. Treasury" : "e.g. Savings"} value={label} onChangeText={setLabel} />

        {mode === "import" ? (
          <View className="gap-3">
            <View className="gap-1.5">
              <Text variant="label" muted>
                Recovery Kit JSON
              </Text>
              <TextInput
                multiline
                value={kit}
                onChangeText={setKit}
                placeholder="Paste the exported kit"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-[120px] px-4 py-3 bg-mv-ink rounded-md border border-mv-line text-mv-bone"
                style={{ textAlignVertical: "top", fontFamily: "JetBrainsMono", fontSize: 12 }}
              />
            </View>
            <Input label="Kit passcode (encrypted kits)" value={kitPasscode} onChangeText={setKitPasscode} secureTextEntry autoCapitalize="none" />
          </View>
        ) : null}

        {mode === "watch" ? (
          <Input label="Address" placeholder="0x…" value={watchAddress} onChangeText={setWatchAddress} autoCapitalize="none" autoCorrect={false} />
        ) : null}

        {needsPasscode ? (
          <Input label="Wallet passcode" value={passcode} onChangeText={setPasscode} secureTextEntry autoCapitalize="none" />
        ) : null}

        {mode === "import" ? (
          <WarningCard
            severity="info"
            title="Imported accounts keep their address"
            detail="The kit's key is re-encrypted under this wallet's passcode. Keep the original kit; it still restores the account anywhere."
          />
        ) : null}
        {mode === "watch" ? (
          <WarningCard severity="info" title="Read-only" detail="A watch-only account cannot send, sign or connect to apps. Switch to a key-backed account for that." />
        ) : null}

        {error ? <WarningCard severity="warning" title="Could not add account" detail={error} /> : null}

        <Button size="block" onPress={submit} disabled={!canSubmit}>
          {busy ? "Adding…" : mode === "create" ? "Create account" : mode === "import" ? "Import account" : "Add watch-only"}
        </Button>
      </View>
    </PageContainer>
  );
}
