import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, ExternalLink, Link2, Lock, MoreHorizontal, RotateCw, Trash2, Unplug, X } from "lucide-react-native";
import { colors } from "@minerva/ui-tokens";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Sheet } from "@/components/Sheet";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { copyText } from "@/lib/clipboard";
import { addBookmark, hostOf, isBookmarked, normalizeBrowserUrl, removeBookmark, SUGGESTED_LINKS } from "@/lib/dapp/bookmarks";
import { useBookmarks, useDappSessions } from "@/lib/dapp/useDappSessions";
import { toProviderError, PROVIDER_ERROR_CODES } from "@/lib/dapp/errors";
import { buildInjectedProviderScript, parsePageMessage, providerEventScript, providerResponseScript } from "@/lib/dapp/injectedProvider";
import { chainIdToHex, handleProviderRequest } from "@/lib/dapp/providerHandler";
import { normalizeOrigin, removeDappSession, sessionAccountsFor } from "@/lib/dapp/sessions";
import { clearPublishedDappWalletContext, publishDappWalletContext, type DappWalletContext } from "@/lib/dapp/walletContext";
import { isWalletConnectUri } from "@/lib/dapp/walletconnect";

interface NavState {
  url?: string;
  title?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return undefined;
  }
}

function ToolbarButton({ Icon, onPress, disabled, label, active }: { Icon: typeof ArrowLeft; onPress: () => void; disabled?: boolean; label: string; active?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} className="w-11 h-11 items-center justify-center rounded-pill">
      <Icon size={20} color={disabled ? colors.line : active ? colors.text : colors.textMuted} />
    </Pressable>
  );
}

/**
 * In-app dapp browser. Injects the Minerva EIP-1193/EIP-6963 provider into every page and routes
 * requests through `handleProviderRequest`, so connecting, signing and sending go through the same
 * review screens as WalletConnect. Native only: the web/desktop build points users at the extension.
 */
export default function DappBrowser() {
  const params = useLocalSearchParams<{ url?: string }>();
  const snapshot = useAccountSnapshot();
  const { sessions } = useDappSessions();
  const { bookmarks } = useBookmarks();
  const webViewRef = useRef<WebView>(null);

  const initialUrl = useMemo(() => (params.url ? normalizeBrowserUrl(params.url) : undefined), [params.url]);
  const [source, setSource] = useState<string | undefined>(initialUrl);
  const [address, setAddress] = useState(initialUrl ?? "");
  const [editing, setEditing] = useState(false);
  const [nav, setNav] = useState<NavState>({ url: initialUrl, canGoBack: false, canGoForward: false, loading: false });
  const [pageMeta, setPageMeta] = useState<{ origin: string; title?: string; favicon?: string } | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [inputError, setInputError] = useState<string | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const currentOrigin = originOf(nav.url ?? source);
  const session = useMemo(() => (currentOrigin ? sessions.find((s) => s.origin === normalizeOrigin(currentOrigin)) : undefined), [currentOrigin, sessions]);
  const connectedAccounts = useMemo(() => sessionAccountsFor(session, snapshot.activeAddress), [session, snapshot.activeAddress]);
  const connected = connectedAccounts.length > 0;

  // Wallet context handed to the provider handler; kept in a ref so message handlers see the latest.
  const walletContext = useMemo<DappWalletContext>(
    () => ({
      chainId: snapshot.chainId,
      rpcUrl: snapshot.rpcUrl ?? "",
      activeAddress: snapshot.activeAddress,
      walletStatus: snapshot.walletStatus as DappWalletContext["walletStatus"],
      isWatchOnly: snapshot.isWatchOnly,
      setChain: snapshot.setChain,
    }),
    [snapshot.activeAddress, snapshot.chainId, snapshot.isWatchOnly, snapshot.rpcUrl, snapshot.setChain, snapshot.walletStatus],
  );
  const contextRef = useRef(walletContext);
  contextRef.current = walletContext;
  const navRef = useRef(nav);
  navRef.current = nav;
  const pageMetaRef = useRef(pageMeta);
  pageMetaRef.current = pageMeta;

  useEffect(() => {
    publishDappWalletContext(walletContext);
    return () => clearPublishedDappWalletContext();
  }, [walletContext]);

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(script);
  }, []);

  // Push account / chain changes into the page.
  const lastEmitted = useRef<{ accounts: string; chainId?: number }>({ accounts: "" });
  useEffect(() => {
    const accountsKey = connectedAccounts.join(",");
    if (lastEmitted.current.accounts !== accountsKey) {
      if (connectedAccounts.length > 0 || lastEmitted.current.accounts !== "") inject(providerEventScript("accountsChanged", connectedAccounts));
      lastEmitted.current.accounts = accountsKey;
    }
    if (lastEmitted.current.chainId !== snapshot.chainId) {
      inject(providerEventScript("chainChanged", chainIdToHex(snapshot.chainId)));
      lastEmitted.current.chainId = snapshot.chainId;
    }
  }, [connectedAccounts, inject, snapshot.chainId]);

  useEffect(() => {
    const url = nav.url ?? source;
    if (!url) {
      setBookmarked(false);
      return;
    }
    isBookmarked(url).then(setBookmarked).catch(() => setBookmarked(false));
  }, [nav.url, source, bookmarks]);

  const injectedScript = useMemo(() => buildInjectedProviderScript({ chainId: snapshot.chainId, accounts: [] }), [snapshot.chainId]);

  const go = useCallback((input: string) => {
    const url = normalizeBrowserUrl(input);
    if (!url) {
      setInputError("Enter an https address, for example testnet.minervachain.org.");
      return;
    }
    setInputError(undefined);
    setLoadError(undefined);
    setEditing(false);
    setAddress(url);
    setPageMeta(undefined);
    setSource(url);
    setNav((prev) => ({ ...prev, url, loading: true }));
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parsePageMessage(event.nativeEvent.data);
      if (!message) return;
      const pageOrigin = normalizeOrigin(message.origin);
      const trustedOrigin = originOf(navRef.current.url ?? event.nativeEvent.url);
      if (message.kind === "page-meta") {
        if (!trustedOrigin || pageOrigin === normalizeOrigin(trustedOrigin)) setPageMeta({ origin: pageOrigin, title: message.title, favicon: message.favicon });
        return;
      }
      const respond = (payload: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) =>
        inject(providerResponseScript({ id: message.id, ...payload }));

      if (trustedOrigin && pageOrigin !== normalizeOrigin(trustedOrigin)) {
        respond({ error: { code: PROVIDER_ERROR_CODES.unauthorized, message: "Request origin does not match the page being viewed." } });
        return;
      }
      const meta = {
        origin: pageOrigin,
        name: message.title?.trim() || pageMetaRef.current?.title?.trim() || undefined,
        iconUrl: message.favicon ?? pageMetaRef.current?.favicon,
        source: "browser" as const,
      };
      handleProviderRequest(contextRef.current, meta, message.method, message.params)
        .then((result) => respond({ result }))
        .catch((error) => {
          const providerError = toProviderError(error);
          respond({ error: { code: providerError.code, message: providerError.message, data: providerError.data } });
        });
    },
    [inject],
  );

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setNav({ url: state.url, title: state.title, canGoBack: state.canGoBack, canGoForward: state.canGoForward, loading: state.loading });
    if (state.url && !state.loading) setAddress(state.url);
  }, []);

  const onLoadEnd = useCallback(() => {
    setNav((prev) => ({ ...prev, loading: false }));
    // New documents start from the baked-in script; re-announce live state.
    if (connectedAccounts.length > 0) inject(providerEventScript("accountsChanged", connectedAccounts));
    inject(providerEventScript("chainChanged", chainIdToHex(snapshot.chainId)));
  }, [connectedAccounts, inject, snapshot.chainId]);

  const onShouldStartLoadWithRequest = useCallback(
    (request: { url: string }) => {
      const url = request.url;
      if (url.startsWith("https://") || url === "about:blank" || url.startsWith("about:srcdoc")) return true;
      if (url.startsWith("http://")) {
        go(`https://${url.slice(7)}`);
        return false;
      }
      if (isWalletConnectUri(url)) {
        router.push({ pathname: "/walletconnect-pair" as never, params: { uri: url } });
        return false;
      }
      if (/^(mailto|tel|sms):/i.test(url)) {
        void Linking.openURL(url).catch(() => undefined);
        return false;
      }
      setLoadError(`Blocked navigation to a non-https address (${url.split(":")[0]}:). Only https sites can be opened here.`);
      return false;
    },
    [go],
  );

  const toggleBookmark = async () => {
    const url = nav.url ?? source;
    if (!url) return;
    if (bookmarked) await removeBookmark(url);
    else await addBookmark(url, pageMeta?.title || nav.title || hostOf(url));
    setBookmarked(!bookmarked);
  };

  const disconnectSite = async () => {
    if (!currentOrigin) return;
    await removeDappSession(currentOrigin);
    setMenuOpen(false);
  };

  const closeBrowser = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/apps");
  };

  if (Platform.OS === "web") {
    return (
      <PageContainer>
        <PageHeader title="Dapp browser" showBack centerTitle />
        <View className="gap-5">
          <WarningCard
            severity="info"
            title="Available in the mobile app"
            detail="The in-app dapp browser runs on iOS and Android. On desktop and web, connect to dapps with the Minerva browser extension, which exposes the same EIP-6963 provider."
          />
          <Button variant="secondary" onPress={closeBrowser}>
            Back to Apps
          </Button>
        </View>
      </PageContainer>
    );
  }

  const showStartPage = !source;

  return (
    <PageContainer scrollable={false}>
      {/* URL bar */}
      <View className="flex-row items-center gap-2 py-2">
        <Pressable onPress={closeBrowser} accessibilityLabel="Close browser" className="w-10 h-10 items-center justify-center -ml-2">
          <X size={22} color={colors.text} />
        </Pressable>
        <View className="flex-1 flex-row items-center h-12 px-3 bg-mv-ink rounded-pill border border-mv-line">
          <Lock size={14} color={currentOrigin?.startsWith("https://") ? colors.text : colors.textMuted} />
          <TextInput
            className="flex-1 ml-2 text-body text-mv-bone"
            value={editing ? address : nav.url && !editing ? hostOf(nav.url) : address}
            onChangeText={setAddress}
            onFocus={() => {
              setEditing(true);
              setAddress(nav.url ?? source ?? "");
            }}
            onBlur={() => setEditing(false)}
            onSubmitEditing={() => go(address)}
            placeholder="Search or enter an https address"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectTextOnFocus
          />
          {nav.loading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        </View>
        {connected ? <Badge label="Connected" color="positive" /> : null}
      </View>

      {inputError ? (
        <View className="mb-2">
          <WarningCard severity="warning" title="Address not recognised" detail={inputError} />
        </View>
      ) : null}
      {loadError ? (
        <View className="mb-2">
          <WarningCard severity="warning" title="Could not load" detail={loadError} />
        </View>
      ) : null}

      {/* Content */}
      <View className="flex-1 overflow-hidden rounded-lg border border-mv-line bg-mv-ink">
        {showStartPage ? (
          <View className="flex-1 p-4 gap-5">
            <Card>
              <Text variant="label" muted className="mb-2">
                Suggested
              </Text>
              {SUGGESTED_LINKS.map((link, index) => (
                <Row key={link.url} label={link.title} detail={link.detail} onPress={() => go(link.url)} last={index === SUGGESTED_LINKS.length - 1} />
              ))}
            </Card>
            {bookmarks.length > 0 ? (
              <Card>
                <Text variant="label" muted className="mb-2">
                  Bookmarks
                </Text>
                {bookmarks.map((bookmark, index) => (
                  <Row
                    key={bookmark.url}
                    label={bookmark.title}
                    detail={hostOf(bookmark.url)}
                    onPress={() => go(bookmark.url)}
                    trailing={
                      <Pressable onPress={() => void removeBookmark(bookmark.url)} accessibilityLabel={`Remove bookmark ${bookmark.title}`} className="w-8 h-8 items-center justify-center">
                        <Trash2 size={16} color={colors.textMuted} />
                      </Pressable>
                    }
                    last={index === bookmarks.length - 1}
                  />
                ))}
              </Card>
            ) : null}
            <Card>
              <Input label="Open a site" placeholder="https://" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" onSubmitEditing={() => go(address)} />
              <View className="mt-4">
                <Button size="block" onPress={() => go(address)}>
                  Open
                </Button>
              </View>
            </Card>
            <Text variant="caption" muted>
              Sites you open see a Minerva Wallet provider (EIP-6963). They cannot access your address until you approve a connection, and every
              signature or transaction is reviewed here first.
            </Text>
          </View>
        ) : (
          <WebView
            ref={webViewRef}
            source={{ uri: source! }}
            originWhitelist={["https://*", "about:*"]}
            injectedJavaScriptBeforeContentLoaded={injectedScript}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly
            onMessage={onMessage}
            onNavigationStateChange={onNavigationStateChange}
            onLoadStart={() => {
              setLoadError(undefined);
              setNav((prev) => ({ ...prev, loading: true }));
            }}
            onLoadEnd={onLoadEnd}
            onError={(event) => setLoadError(event.nativeEvent.description || "The page could not be loaded.")}
            onHttpError={(event) => {
              if (event.nativeEvent.statusCode >= 500) setLoadError(`The site returned HTTP ${event.nativeEvent.statusCode}.`);
            }}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            javaScriptEnabled
            domStorageEnabled
            allowsBackForwardNavigationGestures
            allowsInlineMediaPlayback
            setSupportMultipleWindows={false}
            pullToRefreshEnabled
            style={{ flex: 1, backgroundColor: colors.ink }}
          />
        )}
      </View>

      {/* Toolbar */}
      <View className="flex-row items-center justify-between py-2">
        <ToolbarButton Icon={ArrowLeft} label="Back" onPress={() => webViewRef.current?.goBack()} disabled={!nav.canGoBack} />
        <ToolbarButton Icon={ArrowRight} label="Forward" onPress={() => webViewRef.current?.goForward()} disabled={!nav.canGoForward} />
        <ToolbarButton Icon={RotateCw} label="Reload" onPress={() => webViewRef.current?.reload()} disabled={showStartPage} />
        <ToolbarButton Icon={bookmarked ? BookmarkCheck : Bookmark} label={bookmarked ? "Remove bookmark" : "Add bookmark"} onPress={() => void toggleBookmark()} disabled={showStartPage} active={bookmarked} />
        <ToolbarButton Icon={MoreHorizontal} label="More" onPress={() => setMenuOpen(true)} />
      </View>

      <Sheet visible={menuOpen} onDismiss={() => setMenuOpen(false)}>
        <View className="gap-1">
          <Text variant="title" weight="semibold" className="mb-1">
            {pageMeta?.title || nav.title || (currentOrigin ? hostOf(currentOrigin) : "Browser")}
          </Text>
          {currentOrigin ? (
            <Text variant="caption" muted className="mb-3">
              {currentOrigin}
              {connected ? ` · connected as ${connectedAccounts[0]?.slice(0, 6)}…${connectedAccounts[0]?.slice(-4)}` : " · not connected"}
            </Text>
          ) : null}
          {connected ? (
            <Row label="Disconnect this site" detail="Revokes eth_accounts for this origin" onPress={() => void disconnectSite()} trailing={<Unplug size={18} color={colors.textMuted} />} showChevron={false} />
          ) : null}
          {nav.url ?? source ? (
            <>
              <Row
                label="Copy link"
                onPress={() => {
                  void copyText(nav.url ?? source ?? "", "Link");
                  setMenuOpen(false);
                }}
                trailing={<Link2 size={18} color={colors.textMuted} />}
                showChevron={false}
              />
              <Row
                label="Open in system browser"
                onPress={() => {
                  void Linking.openURL(nav.url ?? source ?? "").catch(() => undefined);
                  setMenuOpen(false);
                }}
                trailing={<ExternalLink size={18} color={colors.textMuted} />}
                showChevron={false}
              />
            </>
          ) : null}
          <Row
            label="Network"
            value={snapshot.chainName}
            detail={snapshot.activeAccount?.label ? `Active account: ${snapshot.activeAccount.label}` : undefined}
            showChevron={false}
            last
          />
          <View className="mt-4">
            <Button size="block" variant="secondary" onPress={() => setMenuOpen(false)}>
              Close
            </Button>
          </View>
        </View>
      </Sheet>
    </PageContainer>
  );
}
