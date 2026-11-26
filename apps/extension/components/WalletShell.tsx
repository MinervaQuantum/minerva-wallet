import { useEffect, useMemo, useState, type ReactNode } from "react";
import { UpdateNotice } from "./UpdateNotice";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Copy,
  Droplet,
  Eye,
  EyeOff,
  Import,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import { chainConfig, formatTokenUnits, type SupportedChainId } from "@minerva/evm";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { Row } from "./Row";
import { WarningCard } from "./WarningCard";
import { QrCode } from "./QrCode";
import { useExtensionWallet, type ExtensionWalletState } from "../lib/useExtensionWallet";
import { copyText } from "../lib/clipboard";
import type { ExtensionAccountSummary } from "../lib/extensionWalletVault";
import type { TrackedTokenBalance } from "../lib/extensionTokens";

const SYSTEM_ADDRESSES = [
  { label: "ML-DSA-65 precompile", value: "0x0000000000000000000000000000000000000100" },
  { label: "SecurityModeRegistry", value: "0x0000000000000000000000000000000000000201" },
  { label: "AccountReadinessRegistry", value: "0x0000000000000000000000000000000000000202" },
  { label: "MinervaAccountFactory", value: "0x0000000000000000000000000000000000000203" },
];

type View =
  | "home"
  | "send"
  | "receive"
  | "activity"
  | "recovery"
  | "security"
  | "bridge"
  | "accounts"
  | "add-account"
  | "import-account"
  | "tokens";

const NATIVE_ASSET = "native";

function shorten(addr?: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function explorerBase(chainId?: number): string | null {
  try {
    return chainId ? chainConfig(chainId as SupportedChainId).blockExplorers?.default.url ?? null : null;
  } catch {
    return null;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-mono uppercase tracking-[0.18em] text-mv-mist">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full h-11 rounded-lg bg-mv-panel border border-mv-line px-3 text-sm text-mv-bone placeholder:text-mv-mist focus:border-mv-line-strong outline-none";

const iconButtonClass = "p-1.5 rounded-md text-mv-mist hover:text-mv-bone hover:bg-mv-panel disabled:opacity-30";

function Unlock({
  mode,
  onCreate,
  onUnlock,
  onRestore,
  busy,
  accounts,
}: {
  mode: "no-wallet" | "locked";
  onCreate: (p: string) => void;
  onUnlock: (p: string) => void;
  onRestore: (encoded: string, p: string) => void;
  busy: boolean;
  accounts: ExtensionAccountSummary[];
}) {
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [kit, setKit] = useState("");
  const [tab, setTab] = useState<"primary" | "restore">("primary");
  const creating = mode === "no-wallet";
  const active = accounts.find((a) => a.active);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xl font-semibold text-mv-bone">Minerva Wallet</div>
        <div className="text-sm text-mv-mist mt-1">
          {creating
            ? "Create a Minerva Account — a PQ-native Minerva smart account with a normal 0x address."
            : "Unlock your Minerva Account. The passcode stays in memory only."}
        </div>
        {!creating && active ? (
          <div className="mt-2 text-xs text-mv-mist">
            {accounts.length} account{accounts.length === 1 ? "" : "s"} · active: {active.label} ({shorten(active.address)})
          </div>
        ) : null}
      </div>

      {tab === "primary" ? (
        <div className="space-y-3">
          <Field label="Passcode">
            <input
              className={inputClass}
              type="password"
              autoFocus
              value={passcode}
              placeholder="At least 8 characters"
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && passcode.length >= 8 && (!creating || passcode === confirm)) {
                  creating ? onCreate(passcode) : onUnlock(passcode);
                }
              }}
            />
          </Field>
          {creating ? (
            <Field label="Confirm passcode">
              <input
                className={inputClass}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          ) : null}
          <Button
            size="block"
            disabled={busy || passcode.length < 8 || (creating && passcode !== confirm)}
            onClick={() => (creating ? onCreate(passcode) : onUnlock(passcode))}
          >
            {busy ? "Working…" : creating ? "Create Minerva Account" : "Unlock"}
          </Button>
          <Button variant="tertiary" size="block" disabled={busy} onClick={() => setTab("restore")}>
            Restore from Recovery Kit
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Recovery Kit JSON">
            <textarea
              className={`${inputClass} h-28 py-2 font-mono text-xs`}
              value={kit}
              placeholder="Paste the exported Recovery Kit"
              onChange={(e) => setKit(e.target.value)}
            />
          </Field>
          <Field label="Kit passcode">
            <input
              className={inputClass}
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          </Field>
          {!creating ? (
            <div className="text-xs text-mv-mist">
              The kit is added as another account and must use the wallet passcode. For a kit with a different
              passcode, unlock first and use Add account → Import.
            </div>
          ) : null}
          <Button
            size="block"
            disabled={busy || !kit || passcode.length < 8}
            onClick={() => onRestore(kit, passcode)}
          >
            {busy ? "Restoring…" : creating ? "Restore wallet" : "Add account from kit"}
          </Button>
          <Button variant="tertiary" size="block" disabled={busy} onClick={() => setTab("primary")}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}

/** Header account switcher: a sheet listing visible accounts plus add / import / manage. */
function AccountSwitcher({
  w,
  onClose,
  onNavigate,
}: {
  w: ExtensionWalletState;
  onClose: () => void;
  onNavigate: (view: View) => void;
}) {
  const visible = w.accounts.filter((a) => !a.hidden || a.active);
  const hiddenCount = w.accounts.length - visible.length;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-mv-black/95">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <span className="text-base font-semibold text-mv-bone">Accounts</span>
        <button className={iconButtonClass} onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 space-y-2">
        {visible.map((a) => (
          <button
            key={a.id}
            disabled={w.busy}
            onClick={async () => {
              await w.switchAccount(a.id);
              onClose();
            }}
            className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left hover:border-mv-line-strong disabled:opacity-50 ${
              a.active ? "border-mv-line-strong bg-mv-panel" : "border-mv-line bg-mv-black"
            }`}
          >
            <span className="min-w-0">
              <span className="block text-sm text-mv-bone truncate">{a.label}</span>
              <span className="block text-xs font-mono text-mv-mist">{shorten(a.address)}</span>
            </span>
            {a.active ? <Check size={16} className="text-mv-bone shrink-0" /> : null}
          </button>
        ))}
        {hiddenCount > 0 ? (
          <div className="text-xs text-mv-mist px-1">
            {hiddenCount} hidden account{hiddenCount === 1 ? "" : "s"} — show them under Manage.
          </div>
        ) : null}
      </div>
      <div className="px-5 py-4 space-y-2 border-t border-mv-line">
        <Button
          size="block"
          variant="secondary"
          disabled={w.busy}
          onClick={() => {
            onNavigate("add-account");
            onClose();
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Plus size={14} /> Create account
          </span>
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="tertiary"
            disabled={w.busy}
            onClick={() => {
              onNavigate("import-account");
              onClose();
            }}
          >
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Import size={13} /> Import kit
            </span>
          </Button>
          <Button
            variant="tertiary"
            onClick={() => {
              onNavigate("accounts");
              onClose();
            }}
          >
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Settings2 size={13} /> Manage
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ManageAccounts({ w }: { w: ExtensionWalletState }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commitRename = async (id: string) => {
    if (draft.trim()) await w.renameAccount(id, draft);
    setEditing(null);
  };

  return (
    <div className="space-y-2">
      {w.accounts.map((a, index) => (
        <Card key={a.id} className="!p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              {editing === a.id ? (
                <input
                  className={`${inputClass} !h-9`}
                  autoFocus
                  value={draft}
                  maxLength={40}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void commitRename(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(a.id);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button
                  className="flex items-center gap-1.5 text-sm text-mv-bone hover:underline text-left"
                  onClick={() => {
                    setDraft(a.label);
                    setEditing(a.id);
                  }}
                  title="Rename"
                >
                  <span className="truncate">{a.label}</span>
                  <Pencil size={12} className="text-mv-mist shrink-0" />
                </button>
              )}
              <div className="mt-0.5 flex items-center gap-2 text-xs font-mono text-mv-mist">
                <span>{shorten(a.address)}</span>
                {a.active ? <Badge label="Active" color="positive" /> : null}
                {a.hidden ? <Badge label="Hidden" color="neutral" /> : null}
              </div>
            </div>
            <div className="flex items-center shrink-0">
              <button
                className={iconButtonClass}
                title="Move up"
                disabled={w.busy || index === 0}
                onClick={() => void w.moveAccount(a.id, -1)}
              >
                <ChevronUp size={15} />
              </button>
              <button
                className={iconButtonClass}
                title="Move down"
                disabled={w.busy || index === w.accounts.length - 1}
                onClick={() => void w.moveAccount(a.id, 1)}
              >
                <ChevronDown size={15} />
              </button>
              <button
                className={iconButtonClass}
                title={a.hidden ? "Show" : "Hide"}
                disabled={w.busy}
                onClick={() => void w.setAccountHidden(a.id, !a.hidden)}
              >
                {a.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <button
                className={`${iconButtonClass} hover:text-crit`}
                title="Remove from this browser"
                disabled={w.busy || w.accounts.length <= 1}
                onClick={() => {
                  if (
                    confirm(
                      `Remove "${a.label}" (${shorten(a.address)}) from this browser? Without its Recovery Kit the ML-DSA key cannot be recovered.`,
                    )
                  ) {
                    void w.removeAccount(a.id);
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </Card>
      ))}
      <WarningCard
        severity="info"
        title="One passcode for every account"
        detail="Each account is its own ML-DSA key and Minerva Account address, encrypted with the shared wallet passcode. Export a Recovery Kit for each account you care about."
      />
    </div>
  );
}

function TokenRow({
  token,
  trailing,
}: {
  token: TrackedTokenBalance;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-mv-line last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-mv-bone truncate">
          {token.symbol}
          <span className="ml-2 text-xs text-mv-mist truncate">{token.name}</span>
        </div>
        <div className="text-xs font-mono text-mv-mist">{shorten(token.address)}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-sm text-mv-bone text-right" title={token.error}>
          {token.error ? "—" : formatTokenUnits(token.balance, token.decimals)}
        </div>
        {trailing}
      </div>
    </div>
  );
}

export function WalletShell() {
  const w = useExtensionWallet();
  const [view, setView] = useState<View>("home");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<string>(NATIVE_ASSET);
  const [kitText, setKitText] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [importKit, setImportKit] = useState("");
  const [importPasscode, setImportPasscode] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const explorer = useMemo(() => explorerBase(w.snapshot?.chainId), [w.snapshot?.chainId]);
  const visibleTokens = useMemo(() => w.tokens.filter((t) => !t.hidden), [w.tokens]);
  const selectedToken = useMemo(
    () => (asset === NATIVE_ASSET ? null : w.tokens.find((t) => t.address.toLowerCase() === asset.toLowerCase()) ?? null),
    [asset, w.tokens],
  );

  // Leaving the unlocked state resets navigation so a relock never shows stale views.
  useEffect(() => {
    if (w.status !== "unlocked") {
      setView("home");
      setSwitcherOpen(false);
      setKitText(null);
    }
  }, [w.status]);

  // Switching accounts drops a kit preview from the previous account.
  useEffect(() => {
    setKitText(null);
  }, [w.activeAccount?.id]);

  const copy = async (text: string) => {
    if (!(await copyText(text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (w.status === "loading") {
    return <div className="p-6 text-sm text-mv-mist">Loading Minerva Wallet…</div>;
  }

  if (w.status === "no-wallet" || w.status === "locked") {
    return (
      <div className="p-5">
        {w.error ? (
          <div className="mb-4">
            <WarningCard severity="warning" title="Could not continue" detail={w.error} />
          </div>
        ) : null}
        <Unlock
          mode={w.status}
          busy={w.busy}
          accounts={w.accounts}
          onCreate={w.createWallet}
          onUnlock={w.unlock}
          onRestore={w.restore}
        />
      </div>
    );
  }

  const snap = w.snapshot;
  const active = w.activeAccount;

  const nav: { view: View; label: string; Icon: typeof ArrowUpRight }[] = [
    { view: "send", label: "Send", Icon: ArrowUpRight },
    { view: "receive", label: "Receive", Icon: ArrowDownLeft },
    { view: "security", label: "Security", Icon: ShieldCheck },
    { view: "recovery", label: "Recovery", Icon: KeyRound },
  ];

  const sendDisabled = w.busy || !recipient || !amount || (asset !== NATIVE_ASSET && !selectedToken);

  return (
    <div className="relative p-5 space-y-4">
      {switcherOpen ? (
        <AccountSwitcher w={w} onClose={() => setSwitcherOpen(false)} onNavigate={setView} />
      ) : null}
      <UpdateNotice />
      <header className="flex items-center justify-between gap-2">
        <button
          className="min-w-0 flex items-center gap-2 rounded-lg border border-mv-line bg-mv-panel px-2.5 py-1.5 text-left hover:border-mv-line-strong"
          onClick={() => setSwitcherOpen(true)}
          title="Switch account"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-mv-bone truncate">{active?.label ?? "Minerva Wallet"}</span>
            <span className="block text-[11px] font-mono text-mv-mist">
              {shorten(snap?.address ?? active?.address)} · {snap?.chainName ?? "Minerva Network"}
            </span>
          </span>
          <ChevronDown size={14} className="text-mv-mist shrink-0" />
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="text-mv-mist hover:text-mv-bone disabled:opacity-40"
            title="Refresh"
            disabled={w.busy}
            onClick={() => w.refresh()}
          >
            <RefreshCw size={16} className={w.busy ? "animate-spin" : ""} />
          </button>
          <button className="text-mv-mist hover:text-mv-bone text-xs" onClick={() => void w.lock()}>
            Lock
          </button>
        </div>
      </header>

      {w.error ? <WarningCard severity="warning" title="Action failed" detail={w.error} /> : null}
      {notice ? (
        <div className="flex items-start justify-between gap-2">
          <WarningCard severity="info" title={notice} />
          <button className={iconButtonClass} onClick={() => setNotice(null)} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      ) : null}

      {view === "home" ? (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-[0.18em] text-mv-mist">
                Minerva Account
              </span>
              <Badge label={snap?.readinessLabel ?? "PQ Native"} />
            </div>
            <div className="mt-2 text-2xl font-semibold text-mv-bone">
              {snap?.balanceLabel ?? "— MRV"}
            </div>
            <button
              className="mt-1 inline-flex items-center gap-1.5 text-sm text-mv-mist hover:text-mv-bone"
              onClick={() => snap && copy(snap.address)}
            >
              {shorten(snap?.address ?? active?.address)} <Copy size={13} />
            </button>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-mv-mist">
              <span>Block #{snap?.latestBlock ?? "—"}</span>
              <span>·</span>
              <span>{snap?.deploymentLabel ?? "Undeployed"}</span>
            </div>
          </Card>

          {snap && !snap.deployed ? (
            <WarningCard
              severity="info"
              title="Account not deployed yet"
              detail="The 0x address is reserved. Fund it from the faucet, then a send will deploy it."
            />
          ) : null}

          <div className="grid grid-cols-4 gap-2">
            {nav.map(({ view: v, label, Icon }) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="flex flex-col items-center gap-1.5 rounded-lg bg-mv-panel border border-mv-line py-3 text-mv-bone hover:border-mv-line-strong"
              >
                <Icon size={18} />
                <span className="text-[11px]">{label}</span>
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono uppercase tracking-[0.18em] text-mv-mist">Assets</span>
              <button
                className="inline-flex items-center gap-1 text-xs text-mv-mist hover:text-mv-bone"
                onClick={() => setView("tokens")}
              >
                <Coins size={12} /> Manage tokens
              </button>
            </div>
            <Card className="!py-1">
              <div className="flex items-center justify-between gap-3 py-2.5 border-b border-mv-line last:border-b-0">
                <div>
                  <div className="text-sm text-mv-bone">
                    MRV <span className="ml-2 text-xs text-mv-mist">Minerva</span>
                  </div>
                  <div className="text-xs font-mono text-mv-mist">native</div>
                </div>
                <div className="text-sm text-mv-bone">{snap ? snap.balanceLabel.replace(/ MRV$/, "") : "—"}</div>
              </div>
              {visibleTokens.map((t) => (
                <TokenRow key={t.address} token={t} />
              ))}
              {visibleTokens.length === 0 ? (
                <div className="py-2.5 text-xs text-mv-mist">
                  No tokens tracked yet. Add one by address or discover tokens from the indexer.
                </div>
              ) : null}
            </Card>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" disabled={w.busy} onClick={() => w.faucet()}>
              <span className="inline-flex items-center gap-1.5">
                <Droplet size={14} /> Faucet
              </span>
            </Button>
            <Button variant="secondary" onClick={() => setView("activity")}>
              <span className="inline-flex items-center gap-1.5">
                <Clock size={14} /> Activity
              </span>
            </Button>
            <Button variant="secondary" onClick={() => setView("bridge")}>
              <span className="inline-flex items-center gap-1.5">
                <Waypoints size={14} /> Bridge
              </span>
            </Button>
          </div>
        </div>
      ) : null}

      {view === "send" ? (
        <div className="space-y-3">
          <ViewTitle title="Send" onBack={() => setView("home")} />
          <Field label="Asset">
            <select className={inputClass} value={asset} onChange={(e) => setAsset(e.target.value)}>
              <option value={NATIVE_ASSET}>MRV — {snap ? snap.balanceLabel : "native"}</option>
              {visibleTokens.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol} — {formatTokenUnits(t.balance, t.decimals)} ({shorten(t.address)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Recipient 0x address">
            <input
              className={inputClass}
              value={recipient}
              placeholder="0x…"
              onChange={(e) => setRecipient(e.target.value)}
            />
          </Field>
          <Field label={`Amount (${selectedToken?.symbol ?? "MRV"})`}>
            <input
              className={inputClass}
              value={amount}
              inputMode="decimal"
              placeholder="0.0"
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Row label="From" detail={active?.label} value={shorten(snap?.address)} />
          {selectedToken ? <Row label="Token contract" value={shorten(selectedToken.address)} /> : null}
          <Row label="Network" value={snap?.chainName ?? "Minerva Network"} last />
          <Button
            size="block"
            disabled={sendDisabled}
            onClick={async () => {
              if (selectedToken) {
                await w.sendToken({ token: selectedToken, recipient, amount });
              } else {
                await w.send({ recipient, amount });
              }
              setRecipient("");
              setAmount("");
              setView("activity");
            }}
          >
            {w.busy ? "Submitting PQ transaction…" : "Sign & send"}
          </Button>
          <div className="text-xs text-mv-mist">
            {selectedToken
              ? "An ERC-20 transfer call signed locally with your ML-DSA key and executed by your Minerva Account."
              : "Signed locally with your ML-DSA key and submitted as a Minerva PQ transaction. If the account is undeployed it is deployed first."}
          </div>
        </div>
      ) : null}

      {view === "tokens" ? (
        <div className="space-y-3">
          <ViewTitle title="Tokens" onBack={() => setView("home")} />
          <Field label="Add token by contract address">
            <div className="flex gap-2">
              <input
                className={inputClass}
                value={tokenAddress}
                placeholder="0x…"
                onChange={(e) => setTokenAddress(e.target.value)}
              />
              <Button
                variant="secondary"
                className="!px-4 !h-11 shrink-0"
                disabled={w.busy || !tokenAddress}
                onClick={async () => {
                  await w.addToken(tokenAddress);
                  setTokenAddress("");
                }}
              >
                <Plus size={14} />
              </Button>
            </div>
          </Field>
          <Button
            size="block"
            variant="secondary"
            disabled={w.busy}
            onClick={async () => {
              const added = await w.discoverTokens();
              setNotice(added > 0 ? `Discovered ${added} new token${added === 1 ? "" : "s"}.` : "No new tokens found by the indexer.");
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Search size={14} /> {w.busy ? "Discovering…" : "Discover tokens from indexer"}
            </span>
          </Button>
          <Card className="!py-1">
            {w.tokens.length === 0 ? (
              <div className="py-2.5 text-xs text-mv-mist">No tokens tracked on this network.</div>
            ) : null}
            {w.tokens.map((t) => (
              <TokenRow
                key={t.address}
                token={t}
                trailing={
                  <>
                    <button
                      className={iconButtonClass}
                      title={t.hidden ? "Show" : "Hide"}
                      disabled={w.busy}
                      onClick={() => void w.setTokenHidden(t.address, !t.hidden)}
                    >
                      {t.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      className={`${iconButtonClass} hover:text-crit`}
                      title="Remove"
                      disabled={w.busy}
                      onClick={() => void w.removeToken(t.address)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                }
              />
            ))}
          </Card>
          <div className="text-xs text-mv-mist">
            Metadata and balances are read from the Minerva RPC. Discovery asks the public indexer which ERC-20
            contracts have ever moved tokens to or from this account.
          </div>
        </div>
      ) : null}

      {view === "accounts" ? (
        <div className="space-y-3">
          <ViewTitle title="Manage accounts" onBack={() => setView("home")} />
          <ManageAccounts w={w} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={w.busy} onClick={() => setView("add-account")}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} /> Create
              </span>
            </Button>
            <Button variant="secondary" disabled={w.busy} onClick={() => setView("import-account")}>
              <span className="inline-flex items-center gap-1.5">
                <Import size={14} /> Import kit
              </span>
            </Button>
          </div>
        </div>
      ) : null}

      {view === "add-account" ? (
        <div className="space-y-3">
          <ViewTitle title="Create account" onBack={() => setView("accounts")} />
          <Field label="Name (optional)">
            <input
              className={inputClass}
              value={newLabel}
              maxLength={40}
              placeholder={`Account ${w.accounts.length + 1}`}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </Field>
          <Button
            size="block"
            disabled={w.busy}
            onClick={async () => {
              await w.addAccount(newLabel || undefined);
              setNewLabel("");
              setView("home");
            }}
          >
            {w.busy ? "Generating ML-DSA key…" : "Create account"}
          </Button>
          <WarningCard
            severity="info"
            title="A fresh post-quantum key"
            detail="A new ML-DSA-65 key pair and Minerva Account address are generated and encrypted with your wallet passcode. The account becomes active right away."
          />
        </div>
      ) : null}

      {view === "import-account" ? (
        <div className="space-y-3">
          <ViewTitle title="Import Recovery Kit" onBack={() => setView("accounts")} />
          <Field label="Recovery Kit JSON">
            <textarea
              className={`${inputClass} h-28 py-2 font-mono text-xs`}
              value={importKit}
              placeholder="Paste the exported Recovery Kit"
              onChange={(e) => setImportKit(e.target.value)}
            />
          </Field>
          <Field label="Kit passcode">
            <input
              className={inputClass}
              type="password"
              value={importPasscode}
              placeholder="Passcode the kit was exported with"
              onChange={(e) => setImportPasscode(e.target.value)}
            />
          </Field>
          <Field label="Name (optional)">
            <input
              className={inputClass}
              value={newLabel}
              maxLength={40}
              placeholder={`Account ${w.accounts.length + 1}`}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </Field>
          <Button
            size="block"
            disabled={w.busy || !importKit || importPasscode.length < 8}
            onClick={async () => {
              await w.importAccount(importKit, importPasscode, newLabel || undefined);
              setImportKit("");
              setImportPasscode("");
              setNewLabel("");
              setView("home");
            }}
          >
            {w.busy ? "Importing…" : "Import as new account"}
          </Button>
          <div className="text-xs text-mv-mist">
            The kit is decrypted with its own passcode and re-encrypted with this wallet's passcode. A kit for an
            account that already exists here just switches to it.
          </div>
        </div>
      ) : null}

      {view === "receive" ? (
        <div className="space-y-3">
          <ViewTitle title="Receive" onBack={() => setView("home")} />
          <div className="text-xs text-mv-mist">{active?.label}</div>
          <div className="flex justify-center py-2">
            <QrCode value={snap?.address ?? active?.address ?? ""} size={196} />
          </div>
          <button
            className="w-full text-center text-sm text-mv-bone break-all"
            onClick={() => (snap?.address ?? active?.address) && copy(snap?.address ?? active?.address ?? "")}
          >
            {snap?.address ?? active?.address}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => (snap?.address ?? active?.address) && copy(snap?.address ?? active?.address ?? "")}>
              {copied ? "Copied" : "Copy address"}
            </Button>
            <Button variant="secondary" disabled={w.busy} onClick={() => w.faucet()}>
              Faucet MRV
            </Button>
          </div>
          <WarningCard
            severity="info"
            title="This is your Minerva Account address"
            detail="A normal 0x address on Minerva Network, controlled by your post-quantum ML-DSA key."
          />
        </div>
      ) : null}

      {view === "activity" ? (
        <div className="space-y-2">
          <ViewTitle title="Activity" onBack={() => setView("home")} />
          <div className="text-xs text-mv-mist">{active?.label} · {shorten(snap?.address ?? active?.address)}</div>
          {w.activity.length === 0 ? (
            <div className="text-sm text-mv-mist py-6 text-center">No activity yet.</div>
          ) : (
            w.activity.map((a) => (
              <Card key={a.id} className="!p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-mv-bone">{a.title}</span>
                  <Badge
                    label={a.status}
                    color={
                      a.status === "success"
                        ? "positive"
                        : a.status === "failed"
                          ? "warning"
                          : "neutral"
                    }
                  />
                </div>
                <div className="text-xs text-mv-mist mt-1">{a.detail}</div>
                {a.hash && explorer ? (
                  <a
                    className="text-xs text-mv-bone underline mt-1 inline-block"
                    href={`${explorer}/tx/${a.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on explorer
                  </a>
                ) : null}
              </Card>
            ))
          )}
        </div>
      ) : null}

      {view === "security" ? (
        <div className="space-y-2">
          <ViewTitle title="Security" onBack={() => setView("home")} />
          <Card>
            <Row label="Security mode" value={snap?.readinessLabel ?? "PQ Native"} />
            <Row label="Chain ID" value={String(snap?.chainId ?? active?.chainId ?? "—")} />
            <Row label="Network" value={snap?.chainName ?? "Minerva Network"} />
            <Row label="Deployment" value={snap?.deploymentLabel ?? "Undeployed"} />
            <Row
              label="Auto-lock"
              detail="Change it under Settings"
              value={w.autoLockMinutes === 0 ? "Never" : `${w.autoLockMinutes} min`}
              last
            />
          </Card>
          <div className="text-xs font-mono uppercase tracking-[0.18em] text-mv-mist pt-1">
            Verified system contracts
          </div>
          <Card>
            {SYSTEM_ADDRESSES.map((s, i) => (
              <Row
                key={s.value}
                label={s.label}
                detail={s.value}
                value="✓"
                last={i === SYSTEM_ADDRESSES.length - 1}
              />
            ))}
          </Card>
          <WarningCard
            severity="info"
            title="Post-quantum native"
            detail="Every signing path uses ML-DSA-65. No legacy ECDSA fallback is active on this account."
          />
        </div>
      ) : null}

      {view === "recovery" ? (
        <div className="space-y-3">
          <ViewTitle title="Recovery" onBack={() => setView("home")} />
          <Card>
            <Row label="Account" value={active?.label ?? "—"} />
            <Row label="Key version" value={active ? `v${active.keyVersion}` : "—"} />
            <Row
              label="Recovery Kit"
              detail="Passcode-encrypted backup of this account's ML-DSA profile"
              last
            />
          </Card>
          <Button
            size="block"
            variant="secondary"
            disabled={w.busy}
            onClick={async () => setKitText(await w.exportKit(active?.id))}
          >
            Export Recovery Kit
          </Button>
          {kitText ? (
            <div className="space-y-2">
              <textarea
                readOnly
                className={`${inputClass} h-28 py-2 font-mono text-[10px]`}
                value={kitText}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => copy(kitText)}>
                  {copied ? "Copied" : "Copy kit"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const blob = new Blob([kitText], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    const slug = (active?.label ?? "account").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                    a.download = `minerva-recovery-kit-${slug || "account"}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download
                </Button>
              </div>
            </div>
          ) : null}
          <Button size="block" variant="secondary" disabled={w.busy} onClick={() => w.rotate()}>
            {w.busy ? "Rotating…" : "Rotate PQ key"}
          </Button>
          <WarningCard
            severity="warning"
            title="Rotation keeps your address"
            detail="Only the ML-DSA key behind the account changes. The 0x address stays the same."
          />
          <Button
            size="block"
            variant="danger"
            disabled={w.busy}
            onClick={() => {
              if (
                confirm(
                  `Wipe all ${w.accounts.length} account${w.accounts.length === 1 ? "" : "s"}, tracked tokens and connected-site approvals from the browser? This cannot be undone without Recovery Kits.`,
                )
              ) {
                w.wipe();
              }
            }}
          >
            Wipe wallet
          </Button>
        </div>
      ) : null}

      {view === "bridge" ? (
        <div className="space-y-3">
          <ViewTitle title="Bridge" onBack={() => setView("home")} />
          <Badge label="Coming soon" color="neutral" />
          <div className="text-sm text-mv-mist">
            A Minerva↔external bridge is not available yet. This wallet only shows real on-chain
            capability — no routes, fees, amounts, or finalization status are simulated.
          </div>
          <Card>
            <Row label="Bridge service" value="Not available" />
            <Row label="Routes / fees" value="None shown" last />
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ViewTitle({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-lg font-semibold text-mv-bone">{title}</span>
      <button className="text-xs text-mv-mist hover:text-mv-bone" onClick={onBack}>
        Back
      </button>
    </div>
  );
}
