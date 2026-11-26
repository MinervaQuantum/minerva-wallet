/**
 * Web/desktop entry: no-op. Browsers (and the Tauri shell) already provide TextEncoder, crypto,
 * URL, atob/btoa; the native compat shim would only drag native-only modules into the web bundle.
 */
export {};
