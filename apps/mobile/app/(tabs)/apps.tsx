import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Compass, Globe, Link2, Trash2 } from "lucide-react-native";
import { colors } from "@minerva/ui-tokens";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { WarningCard } from "@/components/WarningCard";
import { ConnectedSiteRow } from "@/components/dapp/ConnectedSiteRow";
import { hostOf, removeBookmark, SUGGESTED_LINKS } from "@/lib/dapp/bookmarks";
import { removeDappSession } from "@/lib/dapp/sessions";
import { useBookmarks, useDappSessions, useWalletConnect } from "@/lib/dapp/useDappSessions";
import { disconnectWalletConnectSession, walletConnectChainNames } from "@/lib/dapp/walletconnect";

function openBrowser(url?: string) {
  router.push(url ? { pathname: "/dapp-browser" as never, params: { url } } : ("/dapp-browser" as never));
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * Apps tab: the in-app dapp browser, bookmarks, connected sites (browser sessions) and
 * WalletConnect sessions. Desktop dapps are served by the browser extension.
 */
export default function Apps() {
  const { sessions } = useDappSessions();
  const { bookmarks } = useBookmarks();
  const wc = useWalletConnect(true);

  return (
    <PageContainer>
      <PageHeader title="Apps" />

      <View className="gap-5">
        <Card hero>
          <View className="flex-row items-center gap-3">
            <View className="w-12 h-12 rounded-pill bg-mv-ink border border-mv-line items-center justify-center">
              <Compass size={22} color={colors.text} />
            </View>
            <View className="flex-1">
              <Text variant="title" weight="semibold">
                Dapp browser
              </Text>
              <Text variant="caption" muted>
                Open Minerva dapps with your wallet connected
              </Text>
            </View>
          </View>
          <Text variant="body" muted className="mt-4">
            Sites see a Minerva Wallet provider (EIP-1193 and EIP-6963). Connections, signatures and transactions are reviewed on this device
            before anything is shared or sent.
          </Text>
          <View className="mt-4">
            <Button size="block" onPress={() => openBrowser()}>
              Open browser
            </Button>
          </View>
        </Card>

        <Card>
          <Text variant="label" muted className="mb-2">
            {bookmarks.length > 0 ? "Bookmarks" : "Suggested"}
          </Text>
          {bookmarks.length > 0
            ? bookmarks.map((bookmark, index) => (
                <Row
                  key={bookmark.url}
                  label={bookmark.title}
                  detail={hostOf(bookmark.url)}
                  onPress={() => openBrowser(bookmark.url)}
                  trailing={
                    <Pressable onPress={() => void removeBookmark(bookmark.url)} accessibilityLabel={`Remove bookmark ${bookmark.title}`} className="w-8 h-8 items-center justify-center">
                      <Trash2 size={16} color={colors.textMuted} />
                    </Pressable>
                  }
                  last={index === bookmarks.length - 1}
                />
              ))
            : SUGGESTED_LINKS.map((link, index) => (
                <Row key={link.url} label={link.title} detail={link.detail} onPress={() => openBrowser(link.url)} last={index === SUGGESTED_LINKS.length - 1} />
              ))}
        </Card>

        <Card>
          <View className="flex-row items-center justify-between mb-2">
            <Text variant="label" muted>
              Connected sites
            </Text>
            <Badge label={String(sessions.length)} color="neutral" />
          </View>
          {sessions.length === 0 ? (
            <View className="flex-row items-center gap-3 py-2">
              <Globe size={18} color={colors.textMuted} />
              <Text variant="body" muted className="flex-1">
                No sites are connected. Approve a connection in the browser and it appears here.
              </Text>
            </View>
          ) : (
            sessions.map((session, index) => (
              <ConnectedSiteRow
                key={session.origin}
                name={session.name}
                origin={session.origin}
                iconUrl={session.iconUrl}
                source="browser"
                detail={`${session.accounts.length} account${session.accounts.length === 1 ? "" : "s"} · last used ${relativeTime(session.lastUsedAt)}`}
                onPress={() => openBrowser(session.origin)}
                onDisconnect={() => void removeDappSession(session.origin)}
                last={index === sessions.length - 1}
              />
            ))
          )}
        </Card>

        <Card>
          <View className="flex-row items-center justify-between mb-2">
            <Text variant="label" muted>
              WalletConnect
            </Text>
            <Badge
              label={!wc.configured ? "not configured" : wc.status === "ready" ? "ready" : wc.status === "error" ? "error" : wc.status}
              color={!wc.configured ? "neutral" : wc.status === "ready" ? "positive" : wc.status === "error" ? "warning" : "review"}
            />
          </View>
          {!wc.configured ? (
            <Text variant="body" muted>
              WalletConnect is not configured in this build. Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID to pair with desktop dapps from this phone.
            </Text>
          ) : (
            <>
              {wc.status === "error" && wc.error ? <WarningCard severity="warning" title="WalletConnect could not start" detail={wc.error} /> : null}
              {wc.sessions.length === 0 ? (
                <View className="flex-row items-center gap-3 py-2">
                  <Link2 size={18} color={colors.textMuted} />
                  <Text variant="body" muted className="flex-1">
                    No active WalletConnect sessions.
                  </Text>
                </View>
              ) : (
                wc.sessions.map((session, index) => (
                  <ConnectedSiteRow
                    key={session.topic}
                    name={session.name}
                    origin={session.url || "walletconnect"}
                    iconUrl={session.iconUrl}
                    source="walletconnect"
                    detail={walletConnectChainNames(session.chainIds) || undefined}
                    onDisconnect={() => void disconnectWalletConnectSession(session.topic).catch(() => undefined)}
                    last={index === wc.sessions.length - 1}
                  />
                ))
              )}
              <View className="mt-4">
                <Button size="block" variant="secondary" onPress={() => router.push("/walletconnect-pair" as never)}>
                  Scan or paste a WalletConnect code
                </Button>
              </View>
            </>
          )}
        </Card>

        <WarningCard
          severity="info"
          title="Desktop dapps"
          detail="On a computer, the Minerva browser extension provides the wallet to dapps directly (EIP-6963). Use WalletConnect here to approve desktop requests from your phone instead."
        />
      </View>
    </PageContainer>
  );
}
