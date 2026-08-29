"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Clock3, Copy, ExternalLink, LoaderCircle, Rocket, Unplug, Wallet } from "lucide-react";
import { Address, BASE_FEE, Horizon, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative } from "@stellar/stellar-sdk";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const EXPLORER_URL = "https://stellar.expert/explorer/testnet/tx";
const CONTRACT_ID = "CDUV2ODHI3V22VCXM23M7JDEAQK3RQSAECXLYQPRSJWDFK2O3CALA2GR";
const BUILDER_ADDRESS = "GA2PHFIXHVIAGCI4WJVZSN7CS7KT52HRB25CG6IWR4QHKWLTOYUFJNAP";
const WALLETCONNECT_PROJECT_ID = "5d413ae328f966338156302b02894580";
const builds = [
  { id: "ship-or-tip", title: "Ship or Tip", builder: "yeganomaly", pitch: "A place to publicly commit to a build and let early believers fund the follow-through.", problem: "Too many good ideas die in drafts. New builders need accountability, early validation, and a little support to keep shipping.", shipping: "A Stellar Testnet dApp where builders publish a commitment and supporters tip the ideas they want to see shipped.", deadline: "Sep 7, 2026", status: "building", days: 6, tipped: 42, backers: 12, recipient: BUILDER_ADDRESS },
  { id: "agent-field-notes", title: "Agent Field Notes", builder: "noa", pitch: "An open research log for experiments run by autonomous agents.", problem: "Useful agent experiments disappear inside private chats and terminal logs, making it hard for other builders to learn from them.", shipping: "A public field notebook for short agent experiments, prompts, outcomes, and reproducible build notes.", deadline: "Sep 12, 2026", status: "building", days: 11, tipped: 18, backers: 7, recipient: BUILDER_ADDRESS },
  { id: "tiny-tool-club", title: "Tiny Tool Club", builder: "mira", pitch: "One weird, useful micro-tool shipped every week for a month.", problem: "Small useful tool ideas are often abandoned because they feel too tiny to become full products.", shipping: "A four-week shipping club where every weekly micro-tool gets a public deadline, demo, and supporter feedback.", deadline: "Sep 20, 2026", status: "idea", days: 19, tipped: 9, backers: 4, recipient: BUILDER_ADDRESS },
];

type TxStage = "preparing" | "signature" | "pending";
type TxState = { kind: "idle" } | { kind: "sending"; stage: TxStage } | { kind: "success"; hash: string; amount: string } | { kind: "error"; message: string };
type ContractStats = Record<string, { tipped: number; backers: number }>;
type LiveTip = { id: string; buildId: string; backer: string; amount: number; txHash: string; closedAt: string };
type WalletKitApi = {
  authModal: () => Promise<{ address: string }>;
  getAddress: () => Promise<{ address: string }>;
  signTransaction: (
    xdr: string,
    options: { networkPassphrase: string; address: string },
  ) => Promise<{ signedTxXdr: string }>;
  disconnect: () => Promise<void>;
};
const shortAddress = (address: string) => address ? `${address.slice(0, 5)}…${address.slice(-4)}` : "";
const txStageLabel: Record<TxStage, string> = {
  preparing: "Preparing contract call",
  signature: "Waiting for wallet signature",
  pending: "Pending on Stellar Testnet",
};

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("user declined") || lower.includes("rejected")) return "The request was cancelled in Freighter.";
  if (lower.includes("closed the modal")) return "Wallet selection was cancelled.";
  if (lower.includes("not connected") || lower.includes("not available")) return "That wallet is not available on this device. Choose another wallet or install it first.";
  if (lower.includes("proposal expired") || lower.includes("timeout")) return "The connection request expired. Open Freighter and try again.";
  if (lower.includes("unsupported chain") || lower.includes("switch to")) return "Switch Freighter to Stellar Testnet and try again.";
  if (lower.includes("not found")) return "This Testnet account is not funded yet. Fund it with Friendbot and try again.";
  if (lower.includes("balance") || lower.includes("underfunded")) return "Your spendable XLM balance is too low for this tip.";
  if (lower.includes("error(contract, #4)")) return "This build is not registered on the tipping contract yet.";
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
  const [contractStats, setContractStats] = useState<ContractStats>({});
  const [liveTips, setLiveTips] = useState<LiveTip[]>([]);
  const [eventSync, setEventSync] = useState<"connecting" | "live" | "retrying">("connecting");
  const walletKitRef = useRef<WalletKitApi | null>(null);
  const eventCursorRef = useRef("");
  const selectedBuild = builds.find((build) => build.id === selectedBuildId) ?? builds[0];
  const selectedStats = contractStats[selectedBuild.id] ?? { tipped: selectedBuild.tipped, backers: selectedBuild.backers };
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
      const [{ StellarWalletsKit }, { defaultModules }, walletConnect, walletTypes] = await Promise.all([
        import("@creit-tech/stellar-wallets-kit/sdk"),
        import("@creit-tech/stellar-wallets-kit/modules/utils"),
        import("@creit-tech/stellar-wallets-kit/modules/wallet-connect"),
        import("@creit-tech/stellar-wallets-kit/types"),
      ]);
      const walletConnectModule = new walletConnect.WalletConnectModule({
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: {
          name: "Ship or Tip",
          description: "Back public build commitments with Testnet XLM.",
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.svg`],
        },
        allowedChains: [walletConnect.WalletConnectTargetChain.TESTNET],
      });
      StellarWalletsKit.init({
        modules: [...defaultModules(), walletConnectModule],
        network: walletTypes.Networks.TESTNET,
        authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
      });
      if (!active) return;
      walletKitRef.current = StellarWalletsKit as WalletKitApi;

      try {
        const { address } = await StellarWalletsKit.getAddress();
        setPublicKey(address);
        await refreshBalance(address);
      } catch {
        // A fresh visit has no active wallet yet.
      }
    })().catch((error) => toast.error(friendlyError(error)));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const server = new rpc.Server(SOROBAN_RPC_URL);

    async function syncContractEvents() {
      try {
        const request = eventCursorRef.current
          ? { filters: [{ type: "contract" as const, contractIds: [CONTRACT_ID] }], cursor: eventCursorRef.current, limit: 100 }
          : await server.getLatestLedger().then(({ sequence }) => ({
              filters: [{ type: "contract" as const, contractIds: [CONTRACT_ID] }],
              startLedger: Math.max(1, sequence - 120),
              limit: 100,
            }));
        const response = await server.getEvents(request);
        if (!active) return;
        eventCursorRef.current = response.cursor;
        const received = response.events.flatMap((event): LiveTip[] => {
          const topic = event.topic.map((part) => scValToNative(part));
          if (topic[0] !== "TIP" || topic[1] !== "received") return [];
          const value = scValToNative(event.value);
          if (!Array.isArray(value) || value.length < 6) return [];
          const [buildId, backer, , amountStroops] = value;
          return [{
            id: event.id,
            buildId: String(buildId),
            backer: String(backer),
            amount: Number(amountStroops) / 10_000_000,
            txHash: event.txHash,
            closedAt: event.ledgerClosedAt,
          }];
        });
        if (received.length) {
          setLiveTips((current) => [...received, ...current].filter((tip, index, all) => all.findIndex((item) => item.id === tip.id) === index).slice(0, 4));
          setContractStats((current) => {
            const next = { ...current };
            response.events.forEach((event) => {
              const topic = event.topic.map((part) => scValToNative(part));
              if (topic[0] !== "TIP" || topic[1] !== "received") return;
              const value = scValToNative(event.value);
              if (!Array.isArray(value) || value.length < 6) return;
              next[String(value[0])] = { tipped: Number(value[4]) / 10_000_000, backers: Number(value[5]) };
            });
            return next;
          });
        }
        setEventSync("live");
      } catch {
        if (active) setEventSync("retrying");
      }
    }

    void syncContractEvents();
    const interval = window.setInterval(syncContractEvents, 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  async function connectWallet() {
    setWalletBusy(true);
    try {
      const kit = walletKitRef.current;
      if (!kit) throw new Error("Wallet options are still loading. Try again in a moment.");
      const { address } = await kit.authModal();
      if (!address) throw new Error("The selected wallet did not return a Stellar account.");
      setPublicKey(address);
      await refreshBalance(address);
      toast.success("Wallet connected on Stellar Testnet");
    } catch (error) { toast.error(friendlyError(error)); }
    finally { setWalletBusy(false); }
  }

  async function disconnectWallet() {
    await walletKitRef.current?.disconnect().catch(() => undefined);
    setPublicKey(""); setBalance(null); setTx({ kind: "idle" });
    toast.info("Wallet disconnected from this session");
  }

  async function sendTip() {
    if (!publicKey) { await connectWallet(); return; }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setTx({ kind: "error", message: "Enter an amount greater than 0 XLM." }); return; }
    if (numericAmount > 1000) { setTx({ kind: "error", message: "Keep Testnet tips at or below 1,000 XLM." }); return; }
    setTx({ kind: "sending", stage: "preparing" });
    try {
      const server = new rpc.Server(SOROBAN_RPC_URL);
      const sourceAccount = await server.getAccount(publicKey);
      const amountInStroops = BigInt(Math.round(numericAmount * 10_000_000));
      const transaction = new TransactionBuilder(sourceAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.invokeContractFunction({
          contract: CONTRACT_ID,
          function: "tip",
          args: [
            nativeToScVal(selectedBuild.id, { type: "string" }),
            Address.fromString(publicKey).toScVal(),
            nativeToScVal(amountInStroops, { type: "i128" }),
          ],
        }))
        .setTimeout(180)
        .build();
      const preparedTransaction = await server.prepareTransaction(transaction);
      const kit = walletKitRef.current;
      if (!kit) throw new Error("Connect a Stellar wallet before sending a tip.");
      setTx({ kind: "sending", stage: "signature" });
      const { signedTxXdr } = await kit.signTransaction(preparedTransaction.toXDR(), {
        networkPassphrase: Networks.TESTNET,
        address: publicKey,
      });
      if (!signedTxXdr) throw new Error("The transaction was not signed.");
      const signedTransaction = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      setTx({ kind: "sending", stage: "pending" });
      const submitted = await server.sendTransaction(signedTransaction);
      if (submitted.status === "ERROR") throw new Error("The contract call was rejected by Stellar RPC.");

      let confirmed = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = await server.getTransaction(submitted.hash);
        if (result.status === "SUCCESS") { confirmed = true; break; }
        if (result.status === "FAILED") throw new Error("The contract call failed on Stellar Testnet.");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (!confirmed) throw new Error("Confirmation is taking longer than expected. Check the transaction in Stellar Expert.");
      setTx({ kind: "success", hash: submitted.hash, amount: numericAmount.toString() });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await refreshBalance(publicKey);
      toast.success("Contract tip confirmed on Stellar Testnet");
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
            : <><div className="tip-head"><span>backed so far</span><span>{selectedStats.backers} backers</span></div><strong className="tip-total">{selectedStats.tipped.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM</strong><Progress value={Math.min(selectedStats.tipped, 100)} className="tip-progress" /><p className="tip-context">No funding goal. Every tip keeps the build moving.</p>
              <div className="amount-grid" aria-label="Suggested tip amount">{["1", "5", "10"].map(value => <button className={amount === value ? "amount-active" : ""} key={value} type="button" onClick={() => { setAmount(value); setTx({ kind: "idle" }); }}>{value} XLM</button>)}</div>
              <label className="amount-label" htmlFor="custom-amount">Custom amount</label><div className="amount-input"><Input id="custom-amount" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setTx({ kind: "idle" }); }} /><span>XLM</span></div>
              {tx.kind === "error" && <p className="inline-error" role="alert">{tx.message}</p>}
              <Button className="electric-button full-button tip-action" size="lg" onClick={sendTip} disabled={tx.kind === "sending"}>{tx.kind === "sending" ? <><LoaderCircle className="animate-spin" /> {txStageLabel[tx.stage]}</> : <><Rocket /> Tip this build</>}</Button>
              <div className="wallet-summary"><span>{publicKey ? "Connected balance" : "Wallet not connected"}</span><strong>{publicKey ? `${formattedBalance} XLM` : "Connect to continue"}</strong></div>
              <div className="event-monitor"><div className="event-monitor-head"><span>CONTRACT EVENT STREAM</span><i className={eventSync}>{eventSync === "live" ? "LIVE" : eventSync === "connecting" ? "SYNCING" : "RETRYING"}</i></div>{liveTips.filter((tip) => tip.buildId === selectedBuild.id).length ? liveTips.filter((tip) => tip.buildId === selectedBuild.id).slice(0, 2).map((tip) => <a href={`${EXPLORER_URL}/${tip.txHash}`} target="_blank" rel="noreferrer" className="event-row" key={tip.id}><span><b>+{tip.amount.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM</b><small>{shortAddress(tip.backer)}</small></span><time>{new Date(tip.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></a>) : <p>Watching Soroban for the next tip…</p>}</div>
              <p className="legal-note">Testnet only · tips go directly to the builder · not an investment</p></>}</aside>
        </div>
      </div>}
      <footer><span>ship or tip · stellar testnet</span><span>commit. build. ship.</span></footer>
    </main>
  );
}
