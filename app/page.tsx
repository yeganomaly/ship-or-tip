"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Clock3, Copy, ExternalLink, LoaderCircle, Rocket, Unplug, Wallet } from "lucide-react";
import { Asset, BASE_FEE, Horizon, Memo, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const EXPLORER_URL = "https://stellar.expert/explorer/testnet/tx";
const BUILDER_ADDRESS = "GA2PHFIXHVIAGCI4WJVZSN7CS7KT52HRB25CG6IWR4QHKWLTOYUFJNAP";
const WALLETCONNECT_PROJECT_ID = "5d413ae328f966338156302b02894580";
const STELLAR_CHAIN = "stellar:testnet";

const builds = [
  { id: "ship-or-tip", title: "Ship or Tip", builder: "yeganomaly", pitch: "A place to publicly commit to a build and let early believers fund the follow-through.", problem: "Too many good ideas die in drafts. New builders need accountability, early validation, and a little support to keep shipping.", shipping: "A Stellar Testnet dApp where builders publish a commitment and supporters tip the ideas they want to see shipped.", deadline: "Sep 7, 2026", status: "building", days: 6, tipped: 42, backers: 12, recipient: BUILDER_ADDRESS },
  { id: "agent-field-notes", title: "Agent Field Notes", builder: "noa", pitch: "An open research log for experiments run by autonomous agents.", problem: "Useful agent experiments disappear inside private chats and terminal logs, making it hard for other builders to learn from them.", shipping: "A public field notebook for short agent experiments, prompts, outcomes, and reproducible build notes.", deadline: "Sep 12, 2026", status: "building", days: 11, tipped: 18, backers: 7, recipient: BUILDER_ADDRESS },
  { id: "tiny-tool-club", title: "Tiny Tool Club", builder: "mira", pitch: "One weird, useful micro-tool shipped every week for a month.", problem: "Small useful tool ideas are often abandoned because they feel too tiny to become full products.", shipping: "A four-week shipping club where every weekly micro-tool gets a public deadline, demo, and supporter feedback.", deadline: "Sep 20, 2026", status: "idea", days: 19, tipped: 9, backers: 4, recipient: BUILDER_ADDRESS },
];

type TxState = { kind: "idle" } | { kind: "sending" } | { kind: "success"; hash: string; amount: string } | { kind: "error"; message: string };
type StellarSession = { namespaces: { stellar?: { accounts?: string[]; methods?: string[] } } };
type WalletProvider = {
  session?: StellarSession;
  connect: (options: object) => Promise<StellarSession | undefined>;
  disconnect: () => Promise<void>;
  on: (event: string, listener: () => void) => void;
  request: (request: { method: string; params: object }, chain: string) => Promise<unknown>;
};
type WalletModal = { open: () => Promise<void>; close: () => Promise<void> };
const shortAddress = (address: string) => address ? `${address.slice(0, 5)}…${address.slice(-4)}` : "";

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("user declined") || lower.includes("rejected")) return "The request was cancelled in Freighter.";
  if (lower.includes("proposal expired") || lower.includes("timeout")) return "The connection request expired. Open Freighter and try again.";
  if (lower.includes("unsupported chain") || lower.includes("switch to")) return "Switch Freighter to Stellar Testnet and try again.";
  if (lower.includes("not found")) return "This Testnet account is not funded yet. Fund it with Friendbot and try again.";
  if (lower.includes("balance") || lower.includes("underfunded")) return "Your spendable XLM balance is too low for this tip.";
  return message || "Something went wrong. Please try again.";
}

export default function Home() {
  const [view, setView] = useState<"home" | "detail">("home");
  const [selectedBuildId, setSelectedBuildId] = useState(builds[0].id);
  const [publicKey, setPublicKey] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [amount, setAmount] = useState("1");
  const [tx, setTx] = useState<TxState>({ kind: "idle" });
  const providerRef = useRef<WalletProvider | null>(null);
  const modalRef = useRef<WalletModal | null>(null);
  const selectedBuild = builds.find((build) => build.id === selectedBuildId) ?? builds[0];
  const formattedBalance = useMemo(() => balance === null ? "—" : Number(balance).toFixed(5), [balance]);

  async function refreshBalance(address: string) {
    const server = new Horizon.Server(HORIZON_URL);
    const account = await server.loadAccount(address);
    const native = account.balances.find((item) => item.asset_type === "native");
    setBalance(native?.balance ?? "0");
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ UniversalProvider }, { createAppKit }, { mainnet }] = await Promise.all([
        import("@walletconnect/universal-provider"),
        import("@reown/appkit/core"),
        import("@reown/appkit/networks"),
      ]);
      const provider = await UniversalProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: {
          name: "Ship or Tip",
          description: "Back public build commitments with Testnet XLM.",
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.svg`],
        },
      });
      const modal = createAppKit({
        projectId: WALLETCONNECT_PROJECT_ID,
        networks: [mainnet],
        universalProvider: provider as never,
        manualWCControl: true,
      });
      if (!active) return;
      providerRef.current = provider as WalletProvider;
      modalRef.current = modal as WalletModal;

      const restoreAccount = async () => {
        const account = provider.session?.namespaces.stellar?.accounts?.[0];
        if (!account) return;
        const address = account.split(":")[2];
        if (!address) return;
        setPublicKey(address);
        await refreshBalance(address);
      };
      provider.on("session_delete", () => { setPublicKey(""); setBalance(null); setTx({ kind: "idle" }); });
      provider.on("session_expire", () => { setPublicKey(""); setBalance(null); setTx({ kind: "idle" }); });
      await restoreAccount();
    })().catch((error) => toast.error(friendlyError(error)));
    return () => { active = false; };
  }, []);

  async function connectWallet() {
    setWalletBusy(true);
    try {
      const provider = providerRef.current;
      const modal = modalRef.current;
      if (!provider || !modal) throw new Error("WalletConnect is still loading. Try again in a moment.");
      await modal.open();
      const session = await provider.connect({
        namespaces: {
          stellar: {
            methods: ["stellar_signXDR"],
            chains: [STELLAR_CHAIN],
            events: ["accountsChanged"],
          },
        },
      });
      if (!session) throw new Error("Connection failed.");
      const methods = session.namespaces.stellar?.methods ?? [];
      if (!methods.includes("stellar_signXDR")) throw new Error("The selected wallet cannot sign Stellar transactions.");
      const account = session.namespaces.stellar?.accounts?.[0];
      const address = account?.split(":")[2];
      if (!address) throw new Error("Freighter did not return a Stellar account.");
      await modal.close();
      setPublicKey(address);
      await refreshBalance(address);
      toast.success("Freighter Mobile connected on Stellar Testnet");
    } catch (error) { toast.error(friendlyError(error)); }
    finally { await modalRef.current?.close(); setWalletBusy(false); }
  }

  async function disconnectWallet() {
    await providerRef.current?.disconnect().catch(() => undefined);
    setPublicKey(""); setBalance(null); setTx({ kind: "idle" });
    toast.info("Wallet disconnected from this session");
  }

  async function sendTip() {
    if (!publicKey) { await connectWallet(); return; }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setTx({ kind: "error", message: "Enter an amount greater than 0 XLM." }); return; }
    if (numericAmount > 1000) { setTx({ kind: "error", message: "Keep Testnet tips at or below 1,000 XLM." }); return; }
    setTx({ kind: "sending" });
    try {
      const server = new Horizon.Server(HORIZON_URL);
      const sourceAccount = await server.loadAccount(publicKey);
      const transaction = new TransactionBuilder(sourceAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: selectedBuild.recipient, asset: Asset.native(), amount: numericAmount.toFixed(7) }))
        .addMemo(Memo.text("Ship or Tip")).setTimeout(180).build();
      const provider = providerRef.current;
      if (!provider?.session) throw new Error("Connect Freighter Mobile before sending a tip.");
      const signed = await provider.request(
        { method: "stellar_signXDR", params: { xdr: transaction.toXDR() } },
        STELLAR_CHAIN,
      ) as { signedXDR?: string };
      if (!signed.signedXDR) throw new Error("The transaction was not signed.");
      const signedTransaction = TransactionBuilder.fromXDR(signed.signedXDR, Networks.TESTNET);
      const result = await server.submitTransaction(signedTransaction);
      setTx({ kind: "success", hash: result.hash, amount: numericAmount.toString() });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await refreshBalance(publicKey);
      toast.success("Tip confirmed on Stellar Testnet");
    } catch (error) {
      const message = friendlyError(error); setTx({ kind: "error", message }); toast.error(message);
    }
  }

  async function copyReceipt() {
    if (tx.kind !== "success") return;
    await navigator.clipboard.writeText(`I backed ${selectedBuild.title} with ${tx.amount} XLM on Stellar Testnet.\n${EXPLORER_URL}/${tx.hash}`);
    toast.success("Receipt copied");
  }

  return (
    <main className="site-shell">
      <Toaster position="bottom-right" />
      <header className="site-header">
        <button className="brand" onClick={() => setView("home")} type="button"><span className="brand-mark"><Rocket /></span><span>ship or tip</span></button>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button className={view === "home" ? "nav-active" : ""} onClick={() => setView("home")} type="button">Explore</button>
          <button type="button" onClick={() => toast.info("Build creation unlocks in the next belt.")}>How it works</button>
        </nav>
        {publicKey ? <div className="wallet-connected"><span><i />{shortAddress(publicKey)}</span><span className="wallet-balance">{formattedBalance} XLM</span><Button variant="ghost" size="icon-sm" aria-label="Disconnect wallet" onClick={disconnectWallet}><Unplug /></Button></div>
          : <Button className="electric-button" onClick={connectWallet} disabled={walletBusy}>{walletBusy ? <LoaderCircle className="animate-spin" /> : <Wallet />}Connect wallet</Button>}
      </header>

      {view === "home" ? <div className="page-wrap">
        <section className="hero">
          <div className="hero-copy"><h1>good ideas die in drafts.</h1><p className="hero-lead">Back the ones you want to see shipped. Small tips, public deadlines, and a reason to keep building.</p>
            <div className="hero-actions"><Button className="electric-button" size="lg" onClick={() => document.getElementById("builds")?.scrollIntoView({ behavior: "smooth" })}>Explore builds <ArrowUpRight /></Button><span>Powered by Stellar Testnet</span></div></div>
          <div className="commitment-card"><div className="commitment-orbit" /><p>PUBLIC COMMITMENT #001</p><strong>ship this product<br />before the clock runs out.</strong><div><Clock3 /> 6 days remaining</div></div>
        </section>
        <section className="build-section" id="builds"><div className="section-title"><div><p className="eyebrow">Live commitments</p><h2>building now</h2></div><span>{builds.length} public builds</span></div>
          <div className="build-grid">{builds.map((build, index) => <button className="build-card" key={build.id} type="button" onClick={() => { setSelectedBuildId(build.id); setTx({ kind: "idle" }); setAmount("1"); setView("detail"); }}><div className={`build-art art-${index + 1}`}><span className="status-dot"><i />{build.status} · {build.days} days left</span><span className="build-number">0{index + 1}</span></div><div className="build-body"><div className="build-heading"><h3>{build.title}</h3><ChevronRight /></div><p>{build.pitch}</p><div className="build-meta"><span>by {build.builder}</span><span>{build.tipped} XLM tipped</span></div></div></button>)}</div>
        </section>
      </div> : <div className="page-wrap detail-page">
        <button className="back-link" type="button" onClick={() => setView("home")}><ArrowLeft /> all builds</button>
        <div className="detail-layout"><article className="build-detail"><p className="eyebrow"><i className="live-dot" /> {selectedBuild.status} · {selectedBuild.days} days left</p><h1>{selectedBuild.title}</h1><p className="detail-lead">{selectedBuild.pitch}</p>
          <div className="builder-line"><span className="avatar">{selectedBuild.builder.slice(0, 2).toUpperCase()}</span><div><span>building in public</span><strong>@{selectedBuild.builder}</strong></div><span className="deadline"><Clock3 /> {selectedBuild.deadline}</span></div>
          <section className="brief-section"><span>01</span><div><h2>The problem</h2><p>{selectedBuild.problem}</p></div></section>
          <section className="brief-section"><span>02</span><div><h2>What I’m shipping</h2><p>{selectedBuild.shipping}</p></div></section>
          <section className="brief-section"><span>03</span><div><h2>Deliverables</h2><ul><li>Live dApp and public GitHub repository</li><li>Freighter wallet connection and balance</li><li>Testnet XLM tipping with a shareable receipt</li></ul></div></section></article>
          <aside className="tip-panel">{tx.kind === "success" ? <div className="success-state"><span className="success-icon"><Check /></span><p className="eyebrow">Transaction confirmed</p><h2>you backed the build.</h2><p>{tx.amount} XLM sent on Stellar Testnet</p><div className="receipt-row"><span>Build</span><strong>{selectedBuild.title}</strong></div><div className="receipt-row"><span>Backer</span><strong>{shortAddress(publicKey)}</strong></div><div className="hash-box"><span>Transaction hash</span><code>{tx.hash}</code></div><a className="explorer-link" href={`${EXPLORER_URL}/${tx.hash}`} target="_blank" rel="noreferrer">View on Stellar Expert <ExternalLink /></a><Button className="electric-button full-button" onClick={copyReceipt}><Copy /> Copy receipt</Button><Button variant="ghost" className="full-button" onClick={() => setTx({ kind: "idle" })}>Back to build</Button></div>
            : <><div className="tip-head"><span>backed so far</span><span>{selectedBuild.backers} backers</span></div><strong className="tip-total">{selectedBuild.tipped} XLM</strong><Progress value={Math.min(selectedBuild.tipped, 100)} className="tip-progress" /><p className="tip-context">No funding goal. Every tip keeps the build moving.</p>
              <div className="amount-grid" aria-label="Suggested tip amount">{["1", "5", "10"].map(value => <button className={amount === value ? "amount-active" : ""} key={value} type="button" onClick={() => { setAmount(value); setTx({ kind: "idle" }); }}>{value} XLM</button>)}</div>
              <label className="amount-label" htmlFor="custom-amount">Custom amount</label><div className="amount-input"><Input id="custom-amount" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setTx({ kind: "idle" }); }} /><span>XLM</span></div>
              {tx.kind === "error" && <p className="inline-error" role="alert">{tx.message}</p>}
              <Button className="electric-button full-button tip-action" size="lg" onClick={sendTip} disabled={tx.kind === "sending"}>{tx.kind === "sending" ? <><LoaderCircle className="animate-spin" /> Waiting for confirmation</> : <><Rocket /> Tip this build</>}</Button>
              <div className="wallet-summary"><span>{publicKey ? "Connected balance" : "Wallet not connected"}</span><strong>{publicKey ? `${formattedBalance} XLM` : "Connect to continue"}</strong></div><p className="legal-note">Testnet only · tips go directly to the builder · not an investment</p></>}</aside>
        </div>
      </div>}
      <footer><span>ship or tip · stellar testnet</span><span>commit. build. ship.</span></footer>
    </main>
  );
}
