import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import {
  addCustomNetwork,
  builtInRpcOverride,
  checkNetworkHealth,
  listNetworks,
  probeNetwork,
  removeCustomNetwork,
  setBuiltInRpcOverride,
  type NetworkHealth,
} from "@/lib/networks";
import { onWalletChange } from "@/lib/walletEvents";
import type { MinervaChainDefinition } from "@minerva/evm";

/** Network list with health, RPC overrides for built-ins, and custom network entry. */
export default function Networks() {
  const snapshot = useAccountSnapshot();
  const [networks, setNetworks] = useState<MinervaChainDefinition[]>(() => listNetworks());
  const [health, setHealth] = useState<Record<number, NetworkHealth>>({});
  const [editing, setEditing] = useState<number | undefined>();
  const [rpcDraft, setRpcDraft] = useState("");
  const [overrides, setOverrides] = useState<Record<number, string | undefined>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", rpcUrl: "", chainId: "", symbol: "", explorerUrl: "", indexerUrl: "", minerva: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();

  const reload = useCallback(async () => {
    const list = listNetworks();
    setNetworks(list);
    const entries = await Promise.all(list.filter((n) => n.builtIn).map(async (n) => [n.chainId, await builtInRpcOverride(n.chainId)] as const));
    setOverrides(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => onWalletChange(() => void reload()), [reload]);

  useEffect(() => {
    let cancelled = false;
    networks.forEach((network) => {
      void checkNetworkHealth(network).then((result) => {
        if (!cancelled) setHealth((current) => ({ ...current, [network.chainId]: result }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [networks]);

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      await action();
      if (done) setNote(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network change failed");
    } finally {
      setBusy(false);
    }
  };

  const detectChainId = () =>
    run(async () => {
      const probe = await probeNetwork(form.rpcUrl.trim());
      setForm((f) => ({ ...f, chainId: String(probe.chainId) }));
    }, "Chain id detected");

  const submitNew = () =>
    run(async () => {
      const chainId = Number(form.chainId);
      await addCustomNetwork({
        chainId,
        name: form.name.trim() || `Chain ${chainId}`,
        rpcUrl: form.rpcUrl.trim(),
        nativeCurrency: form.symbol.trim() ? { symbol: form.symbol.trim(), name: form.symbol.trim() } : undefined,
        explorerUrl: form.explorerUrl.trim() || undefined,
        indexerUrl: form.indexerUrl.trim() || undefined,
        minerva: form.minerva,
      });
      setAdding(false);
      setForm({ name: "", rpcUrl: "", chainId: "", symbol: "", explorerUrl: "", indexerUrl: "", minerva: false });
    }, "Network added");

  return (
    <PageContainer>
      <PageHeader title="Networks" showBack centerTitle />
      <View className="gap-5">
        {error ? <WarningCard severity="warning" title="Network change failed" detail={error} /> : null}
        {note ? <WarningCard severity="info" title={note} /> : null}

        <View className="gap-3">
          {networks.map((network) => {
            const active = network.chainId === snapshot.chainId;
            const h = health[network.chainId];
            const status = !network.launched ? "Not launched" : !h ? "Checking…" : h.ok ? `Block ${h.blockNumber} · ${h.latencyMs} ms` : `Unreachable: ${h.error}`;
            const isEditing = editing === network.chainId;
            return (
              <Card key={network.chainId} className={active ? "border-mv-line-strong" : undefined}>
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center gap-2">
                      <Text variant="body-lg" weight="semibold">
                        {network.name}
                      </Text>
                      {active ? <Badge label="Active" /> : null}
                      {!network.builtIn ? <Badge label="Custom" /> : null}
                      {network.minerva ? <Badge label="PQ" /> : null}
                    </View>
                    <Text variant="caption" muted className="mt-0.5">
                      Chain {network.chainId} · {network.nativeCurrency.symbol} · {status}
                    </Text>
                    <Text variant="caption" muted className="mt-0.5" numberOfLines={1}>
                      {network.rpcUrl}
                      {overrides[network.chainId] ? " (override)" : ""}
                    </Text>
                  </View>
                  <Pressable
                    disabled={active || !network.launched || busy}
                    onPress={() => run(() => snapshot.setChain(network.chainId))}
                    className={`h-9 rounded-pill border px-3 items-center justify-center ${active || !network.launched ? "border-mv-line opacity-50" : "border-mv-line-strong"}`}
                  >
                    <Text variant="caption" weight="medium">
                      {active ? "In use" : network.launched ? "Switch" : "Reserved"}
                    </Text>
                  </Pressable>
                </View>

                {isEditing ? (
                  <View className="gap-3 mt-4">
                    <Input label="RPC URL" value={rpcDraft} onChangeText={setRpcDraft} autoCapitalize="none" autoCorrect={false} />
                    <View className="flex-row gap-2">
                      <Button variant="secondary" className="flex-1 px-2" disabled={busy} onPress={() => setEditing(undefined)}>
                        Cancel
                      </Button>
                      {overrides[network.chainId] ? (
                        <Button
                          variant="secondary"
                          className="flex-1 px-2"
                          disabled={busy}
                          onPress={() =>
                            run(async () => {
                              await setBuiltInRpcOverride(network.chainId, undefined);
                              setEditing(undefined);
                            }, "Default RPC restored")
                          }
                        >
                          Reset
                        </Button>
                      ) : null}
                      <Button
                        className="flex-1 px-2"
                        disabled={busy || rpcDraft.trim().length === 0}
                        onPress={() =>
                          run(async () => {
                            await setBuiltInRpcOverride(network.chainId, rpcDraft.trim());
                            setEditing(undefined);
                          }, "RPC saved")
                        }
                      >
                        Save
                      </Button>
                    </View>
                  </View>
                ) : (
                  <View className="flex-row gap-2 mt-3">
                    {network.builtIn ? (
                      <Button
                        variant="secondary"
                        className="flex-1 px-2"
                        disabled={busy}
                        onPress={() => {
                          setEditing(network.chainId);
                          setRpcDraft(network.rpcUrl);
                        }}
                      >
                        Edit RPC
                      </Button>
                    ) : (
                      <Button variant="secondary" className="flex-1 px-2" disabled={busy || active} onPress={() => run(() => removeCustomNetwork(network.chainId), "Network removed")}>
                        Remove
                      </Button>
                    )}
                  </View>
                )}
              </Card>
            );
          })}
        </View>

        {adding ? (
          <Card>
            <Text variant="label" muted className="mb-3">
              Add network
            </Text>
            <View className="gap-3">
              <Input label="RPC URL" placeholder="https://…" value={form.rpcUrl} onChangeText={(v) => setForm((f) => ({ ...f, rpcUrl: v }))} autoCapitalize="none" autoCorrect={false} />
              <View className="flex-row gap-2 items-end">
                <View className="flex-1">
                  <Input label="Chain id" placeholder="e.g. 77140" value={form.chainId} onChangeText={(v) => setForm((f) => ({ ...f, chainId: v }))} keyboardType="number-pad" />
                </View>
                <Button variant="secondary" className="px-4" disabled={busy || form.rpcUrl.trim().length === 0} onPress={detectChainId}>
                  Detect
                </Button>
              </View>
              <Input label="Name" placeholder="My Minerva node" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
              <Input label="Currency symbol" placeholder="MRV" value={form.symbol} onChangeText={(v) => setForm((f) => ({ ...f, symbol: v }))} autoCapitalize="characters" />
              <Input label="Explorer URL (optional)" value={form.explorerUrl} onChangeText={(v) => setForm((f) => ({ ...f, explorerUrl: v }))} autoCapitalize="none" autoCorrect={false} />
              <Input label="Indexer URL (optional)" value={form.indexerUrl} onChangeText={(v) => setForm((f) => ({ ...f, indexerUrl: v }))} autoCapitalize="none" autoCorrect={false} />
              <Pressable onPress={() => setForm((f) => ({ ...f, minerva: !f.minerva }))}>
                <Row
                  label="Minerva PQ protocol"
                  detail="Enable for networks running the Minerva account protocol (PQ transactions, faucet, relayer)."
                  value={form.minerva ? "Yes" : "No"}
                  showChevron={false}
                  last
                />
              </Pressable>
              <View className="flex-row gap-2">
                <Button variant="secondary" className="flex-1" disabled={busy} onPress={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" disabled={busy || !form.rpcUrl.trim() || !/^\d+$/.test(form.chainId)} onPress={submitNew}>
                  {busy ? "Checking…" : "Add"}
                </Button>
              </View>
            </View>
          </Card>
        ) : (
          <Button size="block" variant="secondary" onPress={() => setAdding(true)}>
            Add custom network
          </Button>
        )}

        <WarningCard
          severity="info"
          title="Mainnet is reserved"
          detail="Chain id 77139 is announced but not serving blocks. It becomes switchable the moment a public RPC answers."
        />
      </View>
    </PageContainer>
  );
}
