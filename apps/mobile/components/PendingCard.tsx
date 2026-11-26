import { useState } from "react";
import { View } from "react-native";
import type { Hex } from "@minerva/core";
import { Card } from "@/components/Card";
import { Text } from "@/components/Text";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { WarningCard } from "@/components/WarningCard";
import type { PendingTransaction } from "@/lib/pendingTransactions";
import { formatActivityTimestamp } from "@/lib/walletActivity";

interface Props {
  items: PendingTransaction[];
  canManage: boolean;
  onSpeedUp: (hash: Hex) => Promise<unknown>;
  onCancel: (hash: Hex) => Promise<unknown>;
}

function stateLabel(state: PendingTransaction["state"]): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "success":
      return "Confirmed";
    case "failed":
      return "Failed";
    case "dropped":
      return "Dropped";
    case "replaced":
      return "Replaced";
  }
}

/** Pending queue with speed-up and cancel. Replacement envelopes reuse the native nonce. */
export function PendingCard({ items, canManage, onSpeedUp, onCancel }: Props) {
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  if (items.length === 0) return null;

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <View className="gap-3">
      <Text variant="label" muted>
        Pending
      </Text>
      {error ? <WarningCard severity="review" title="Could not replace transaction" detail={error} /> : null}
      {items.map((item) => (
        <Card key={item.hash}>
          <View className="flex-row items-center justify-between">
            <Text variant="body" weight="medium" className="flex-1 pr-2" numberOfLines={1}>
              {item.title}
            </Text>
            <Badge label={stateLabel(item.state)} />
          </View>
          <Text variant="caption" muted className="mt-1">
            {item.hash.slice(0, 10)}…{item.hash.slice(-6)} · nonce {item.nativeTransactionNonce} · {formatActivityTimestamp(item.submittedAt)}
            {item.kind !== "transfer" ? ` · ${item.kind}` : ""}
          </Text>
          {item.state === "pending" && canManage ? (
            <View className="flex-row gap-2 mt-3">
              <Button
                variant="secondary"
                className="flex-1 px-2"
                disabled={busy !== undefined}
                onPress={() => run(`up-${item.hash}`, () => onSpeedUp(item.hash))}
              >
                {busy === `up-${item.hash}` ? "Speeding up…" : "Speed up"}
              </Button>
              <Button
                variant="secondary"
                className="flex-1 px-2"
                disabled={busy !== undefined || item.kind === "cancel"}
                onPress={() => run(`cancel-${item.hash}`, () => onCancel(item.hash))}
              >
                {busy === `cancel-${item.hash}` ? "Cancelling…" : "Cancel"}
              </Button>
            </View>
          ) : null}
        </Card>
      ))}
    </View>
  );
}
