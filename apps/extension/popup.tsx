import "./style.css";
import { AppWindow, Code2, Settings } from "lucide-react";
import { WalletShell } from "./components/WalletShell";

/** The popup is the compact standalone Minerva Wallet: it holds its own
 *  encrypted ML-DSA vault (chrome.storage.local), unlocks in memory only, and
 *  signs Minerva PQ transactions itself. Full management (connected apps,
 *  developer mode) lives on the options page. */
function openOptions(page: string) {
  const url = chrome.runtime.getURL(`options.html?page=${page}`);
  chrome.tabs?.create?.({ url });
}

export default function Popup() {
  return (
    <div className="w-[380px] min-h-[520px] bg-mv-black text-mv-bone font-sans">
      <WalletShell />
      <div className="flex items-center justify-between px-5 py-3 border-t border-mv-line">
        <button
          className="inline-flex items-center gap-1.5 text-xs text-mv-mist hover:text-mv-bone"
          onClick={() => openOptions("connected-apps")}
        >
          <AppWindow size={13} /> Connected apps
        </button>
        <button
          className="inline-flex items-center gap-1.5 text-xs text-mv-mist hover:text-mv-bone"
          onClick={() => openOptions("settings")}
        >
          <Settings size={13} /> Settings
        </button>
        <button
          className="inline-flex items-center gap-1.5 text-xs text-mv-mist hover:text-mv-bone"
          onClick={() => openOptions("developer-mode")}
        >
          <Code2 size={13} /> Developer
        </button>
      </div>
    </div>
  );
}
