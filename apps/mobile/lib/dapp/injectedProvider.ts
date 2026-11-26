/**
 * The EIP-1193 provider injected into every page of the in-app dapp browser.
 *
 * Runs before page content loads (WebView `injectedJavaScriptBeforeContentLoaded`). It announces
 * itself through EIP-6963, exposes `window.minerva`, and claims `window.ethereum` when nothing else
 * has. Requests are posted to React Native as JSON through `window.ReactNativeWebView.postMessage`;
 * React Native answers with `webViewRef.injectJavaScript(providerResponseScript(...))`.
 *
 * Page → RN messages: { source: "minerva-provider", kind: "request", id, method, params, origin, title, favicon }
 *                    { source: "minerva-provider", kind: "page-meta", origin, title, favicon }
 * RN → page: window.__minervaProvider.respond({ id, result } | { id, error: { code, message, data } })
 *            window.__minervaProvider.emit(event, payload)
 */
import { MINERVA_PROVIDER_ICON } from "./providerIcon";

export const PROVIDER_MESSAGE_SOURCE = "minerva-provider";
export const PROVIDER_UUID = "13f84186-d9f0-4a60-bb4f-a65d243c1f91";
export const PROVIDER_NAME = "Minerva Wallet";
export const PROVIDER_RDNS = "org.minervachain.wallet";

export interface PageRequestMessage {
  source: typeof PROVIDER_MESSAGE_SOURCE;
  kind: "request";
  id: string;
  method: string;
  params: unknown[];
  origin: string;
  title?: string;
  favicon?: string;
}

export interface PageMetaMessage {
  source: typeof PROVIDER_MESSAGE_SOURCE;
  kind: "page-meta";
  origin: string;
  title?: string;
  favicon?: string;
}

export type PageMessage = PageRequestMessage | PageMetaMessage;

export function parsePageMessage(raw: string): PageMessage | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<PageMessage>;
    if (!parsed || parsed.source !== PROVIDER_MESSAGE_SOURCE) return undefined;
    if (parsed.kind === "request") {
      if (typeof parsed.id !== "string" || typeof parsed.method !== "string" || typeof parsed.origin !== "string") return undefined;
      return {
        source: PROVIDER_MESSAGE_SOURCE,
        kind: "request",
        id: parsed.id,
        method: parsed.method,
        params: Array.isArray(parsed.params) ? parsed.params : [],
        origin: parsed.origin,
        title: typeof parsed.title === "string" ? parsed.title : undefined,
        favicon: typeof parsed.favicon === "string" ? parsed.favicon : undefined,
      };
    }
    if (parsed.kind === "page-meta" && typeof parsed.origin === "string") {
      return {
        source: PROVIDER_MESSAGE_SOURCE,
        kind: "page-meta",
        origin: parsed.origin,
        title: typeof parsed.title === "string" ? parsed.title : undefined,
        favicon: typeof parsed.favicon === "string" ? parsed.favicon : undefined,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface ProviderResponsePayload {
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Script that delivers a response to a pending page request. */
export function providerResponseScript(payload: ProviderResponsePayload): string {
  return `(function(){try{window.__minervaProvider&&window.__minervaProvider.respond(${safeJson(payload)});}catch(e){}})();true;`;
}

/** Script that emits a provider event (accountsChanged, chainChanged, connect, disconnect) into the page. */
export function providerEventScript(event: string, payload: unknown): string {
  return `(function(){try{window.__minervaProvider&&window.__minervaProvider.emit(${safeJson(event)},${safeJson(payload)});}catch(e){}})();true;`;
}

function safeJson(value: unknown): string {
  // U+2028/2029 are legal in JSON but historically broke JS string literals; `<` guards `</script>`.
  return JSON.stringify(value === undefined ? null : value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/</g, "\\u003c");
}

export interface InjectedProviderOptions {
  chainId: number;
  /** Accounts already connected for this origin, so eth_accounts is correct before the first round trip. */
  accounts: string[];
}

export function buildInjectedProviderScript(options: InjectedProviderOptions): string {
  const chainIdHex = `0x${options.chainId.toString(16)}`;
  return `(function () {
  if (window.__minervaProvider) return;
  var CHAIN_ID_HEX = ${safeJson(chainIdHex)};
  var NETWORK_VERSION = ${safeJson(String(options.chainId))};
  var SOURCE = ${safeJson(PROVIDER_MESSAGE_SOURCE)};
  var pending = {};
  var listeners = [];
  var state = { accounts: ${safeJson(options.accounts.map((a) => a.toLowerCase()))}, connected: false };

  function post(message) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    } catch (e) {}
  }
  function nextId() {
    return "mv-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2);
  }
  function rpcError(code, message, data) {
    var error = new Error(message);
    error.code = code;
    if (data !== undefined) error.data = data;
    return error;
  }
  function normalizeParams(params) {
    if (Array.isArray(params)) return params;
    if (params === undefined || params === null) return [];
    return [params];
  }
  function findFavicon() {
    try {
      var links = document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute("href");
        if (href) return new URL(href, location.href).toString();
      }
    } catch (e) {}
    return location.origin + "/favicon.ico";
  }
  function emit(event) {
    var args = Array.prototype.slice.call(arguments, 1);
    var snapshot = listeners.slice();
    for (var i = 0; i < snapshot.length; i++) {
      if (snapshot[i].event !== event) continue;
      try {
        snapshot[i].listener.apply(null, args);
      } catch (e) {
        setTimeout(function () { throw e; }, 0);
      }
    }
  }
  function sameAccounts(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (String(a[i]).toLowerCase() !== String(b[i]).toLowerCase()) return false;
    return true;
  }
  function setAccounts(accounts, announce) {
    var next = (accounts || []).filter(function (a) { return typeof a === "string" && a.indexOf("0x") === 0; }).map(function (a) { return a.toLowerCase(); });
    var changed = !sameAccounts(state.accounts, next);
    state.accounts = next;
    provider.selectedAddress = next[0] || null;
    provider._state.accounts = next;
    if (next.length > 0) {
      var wasConnected = state.connected;
      state.connected = true;
      provider._state.isConnected = true;
      if (!wasConnected && announce) emit("connect", { chainId: provider.chainId });
    }
    if (changed && announce) emit("accountsChanged", next.slice());
  }
  function setDisconnected(announce) {
    var had = state.accounts.length > 0;
    state.accounts = [];
    state.connected = false;
    provider.selectedAddress = null;
    provider._state.accounts = [];
    provider._state.isConnected = false;
    if (had && announce) emit("accountsChanged", []);
    if (announce) emit("disconnect", rpcError(4900, "Minerva Wallet disconnected."));
  }
  function setChain(chainIdHex, announce) {
    var normalized = String(chainIdHex);
    var changed = normalized !== provider.chainId;
    provider.chainId = normalized;
    provider.networkVersion = String(parseInt(normalized, 16));
    if (changed && announce) emit("chainChanged", normalized);
  }

  function request(args) {
    if (!args || typeof args !== "object" || typeof args.method !== "string") {
      return Promise.reject(rpcError(-32600, "Invalid request: expected { method, params }."));
    }
    var method = args.method;
    var params = normalizeParams(args.params);
    return new Promise(function (resolve, reject) {
      var id = nextId();
      pending[id] = { resolve: resolve, reject: reject, method: method };
      post({ source: SOURCE, kind: "request", id: id, method: method, params: params, origin: location.origin, title: document.title, favicon: findFavicon() });
    });
  }

  function respond(payload) {
    if (!payload || typeof payload.id !== "string") return;
    var entry = pending[payload.id];
    if (!entry) return;
    delete pending[payload.id];
    if (payload.error) {
      entry.reject(rpcError(payload.error.code, payload.error.message, payload.error.data));
      return;
    }
    var result = payload.result;
    if (entry.method === "eth_accounts" || entry.method === "eth_requestAccounts") {
      setAccounts(Array.isArray(result) ? result : [], true);
    } else if (entry.method === "wallet_requestPermissions") {
      var accounts = [];
      try {
        for (var i = 0; i < result.length; i++) {
          var caveats = result[i].caveats || [];
          for (var j = 0; j < caveats.length; j++) {
            if (caveats[j].type === "restrictReturnedAccounts") accounts = caveats[j].value || [];
          }
        }
      } catch (e) {}
      setAccounts(accounts, true);
    } else if (entry.method === "wallet_revokePermissions") {
      setDisconnected(true);
    }
    entry.resolve(result);
  }

  function handleEvent(event, payload) {
    if (event === "accountsChanged") {
      if (!payload || payload.length === 0) setDisconnected(true);
      else setAccounts(payload, true);
      return;
    }
    if (event === "chainChanged") {
      setChain(payload, true);
      return;
    }
    emit(event, payload);
  }

  function jsonRpcResponse(payload, result) {
    return { id: payload.id, jsonrpc: payload.jsonrpc || "2.0", result: result };
  }
  function jsonRpcErrorResponse(payload, error) {
    return { id: payload.id, jsonrpc: payload.jsonrpc || "2.0", error: { code: error.code, message: error.message } };
  }

  var provider = {
    isMinerva: true,
    isMinervaWallet: true,
    chainId: CHAIN_ID_HEX,
    networkVersion: NETWORK_VERSION,
    selectedAddress: state.accounts[0] || null,
    _state: { accounts: state.accounts.slice(), initialized: true, isConnected: state.accounts.length > 0, isUnlocked: true },
    request: request,
    isConnected: function () { return true; },
    enable: function () { return request({ method: "eth_requestAccounts" }); },
    send: function (methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === "string") {
        return request({ method: methodOrPayload, params: typeof paramsOrCallback === "function" ? [] : paramsOrCallback });
      }
      var payload = methodOrPayload;
      var callback = typeof paramsOrCallback === "function" ? paramsOrCallback : undefined;
      var promise = request({ method: payload.method, params: payload.params });
      if (!callback) return promise.then(function (result) { return jsonRpcResponse(payload, result); });
      promise.then(function (result) { callback(null, jsonRpcResponse(payload, result)); }).catch(function (error) { callback(error, jsonRpcErrorResponse(payload, error)); });
      return undefined;
    },
    sendAsync: function (payload, callback) {
      request({ method: payload.method, params: payload.params })
        .then(function (result) { callback(null, jsonRpcResponse(payload, result)); })
        .catch(function (error) { callback(error, jsonRpcErrorResponse(payload, error)); });
    },
    on: function (event, listener) { listeners.push({ event: event, listener: listener }); return provider; },
    addListener: function (event, listener) { listeners.push({ event: event, listener: listener }); return provider; },
    once: function (event, listener) {
      var wrapped = function () { provider.removeListener(event, wrapped); listener.apply(null, arguments); };
      listeners.push({ event: event, listener: wrapped });
      return provider;
    },
    removeListener: function (event, listener) {
      for (var i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i].event === event && listeners[i].listener === listener) listeners.splice(i, 1);
      }
      return provider;
    },
    off: function (event, listener) { return provider.removeListener(event, listener); },
    removeAllListeners: function (event) {
      if (!event) { listeners.splice(0, listeners.length); return provider; }
      for (var i = listeners.length - 1; i >= 0; i--) if (listeners[i].event === event) listeners.splice(i, 1);
      return provider;
    }
  };
  state.connected = state.accounts.length > 0;

  var info = Object.freeze({
    uuid: ${safeJson(PROVIDER_UUID)},
    name: ${safeJson(PROVIDER_NAME)},
    icon: ${safeJson(MINERVA_PROVIDER_ICON)},
    rdns: ${safeJson(PROVIDER_RDNS)}
  });
  function announce() {
    try {
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: info, provider: provider }) }));
    } catch (e) {}
  }

  Object.defineProperty(window, "__minervaProvider", { value: { respond: respond, emit: handleEvent, provider: provider }, writable: false, configurable: false });
  try {
    Object.defineProperty(window, "minerva", { value: provider, writable: false, configurable: false });
  } catch (e) {}
  if (!("ethereum" in window)) {
    try {
      Object.defineProperty(window, "ethereum", { value: provider, writable: false, configurable: false });
    } catch (e) {
      try { window.ethereum = provider; } catch (e2) {}
    }
  }
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  var sendMeta = function () { post({ source: SOURCE, kind: "page-meta", origin: location.origin, title: document.title, favicon: findFavicon() }); };
  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(sendMeta, 0);
  else window.addEventListener("DOMContentLoaded", sendMeta);
  window.addEventListener("load", sendMeta);
})();
true;`;
}
