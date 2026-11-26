import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Button } from "@/components/Button";
import { WarningCard } from "@/components/WarningCard";
import {
  checkForNewActivity,
  getNotificationSettings,
  getPermissionState,
  notify,
  requestPermission,
  setNotificationSettings,
  type NotificationSettings,
  type PermissionState,
} from "@/lib/notifications";

function Toggle({ label, detail, value, onChange, last }: { label: string; detail: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <Pressable onPress={() => onChange(!value)}>
      <Row label={label} detail={detail} value={value ? "On" : "Off"} showChevron={false} last={last} />
    </Pressable>
  );
}

export default function NotificationSettingsScreen() {
  const [settings, setSettings] = useState<NotificationSettings>({ enabled: false, incoming: true, confirmations: true, security: true });
  const [permission, setPermission] = useState<PermissionState>("undetermined");
  const [note, setNote] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getNotificationSettings().then(setSettings);
    getPermissionState().then(setPermission);
  }, []);

  const update = async (patch: Partial<NotificationSettings>) => {
    if (patch.enabled && permission !== "granted") {
      const next = await requestPermission();
      setPermission(next);
      if (next !== "granted") {
        setNote(next === "unsupported" ? "Notifications are only available in the native mobile apps." : "Permission was not granted. Enable it in system settings.");
        return;
      }
    }
    setSettings(await setNotificationSettings(patch));
  };

  const test = async () => {
    setBusy(true);
    setNote(undefined);
    const ok = await notify("Minerva Wallet", "Notifications are working on this device.");
    setNote(ok ? "Test notification sent." : "Could not send a notification on this platform.");
    setBusy(false);
  };

  const pollNow = async () => {
    setBusy(true);
    setNote(undefined);
    const raised = await checkForNewActivity({ silentFirstRun: false }).catch(() => 0);
    setNote(raised > 0 ? `${raised} new notification${raised === 1 ? "" : "s"}.` : "Nothing new since the last check.");
    setBusy(false);
  };

  return (
    <PageContainer>
      <PageHeader title="Notifications" showBack centerTitle />
      <View className="gap-5">
        <Text variant="body" muted>
          Notifications are generated on this device from the public indexer. No server holds your address
          or a push token.
        </Text>

        <Card>
          <Toggle label="Enable notifications" detail="Polls the indexer in the background (about every 15 minutes) and on app open." value={settings.enabled} onChange={(v) => update({ enabled: v })} />
          <Toggle label="Incoming transfers" detail="MRV received by the active account." value={settings.incoming} onChange={(v) => update({ incoming: v })} />
          <Toggle label="Confirmations" detail="Pending transactions confirmed, failed or dropped." value={settings.confirmations} onChange={(v) => update({ confirmations: v })} />
          <Toggle label="Security reminders" detail="Recovery Kit rehearsal overdue (90 days)." value={settings.security} onChange={(v) => update({ security: v })} last />
        </Card>

        <Card>
          <Row label="System permission" value={permission} showChevron={false} last />
          <View className="flex-row gap-2 mt-4">
            <Button variant="secondary" className="flex-1 px-2" disabled={busy || permission === "unsupported"} onPress={test}>
              Send test
            </Button>
            <Button variant="secondary" className="flex-1 px-2" disabled={busy || !settings.enabled} onPress={pollNow}>
              Check now
            </Button>
          </View>
        </Card>

        {note ? <WarningCard severity="info" title={note} /> : null}
        {permission === "denied" ? (
          <WarningCard severity="review" title="Permission denied" detail="Allow notifications for Minerva Wallet in the system settings, then enable them here." />
        ) : null}
      </View>
    </PageContainer>
  );
}
