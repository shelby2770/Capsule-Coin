"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { DarkCoinLogo } from "@/components/DarkCoinLogo";
import { CountUp } from "@/components/CountUp";
import type { MiningStatus, MineOutcome, BuyPackOutcome } from "@/lib/types";
import { emitLedgerChange } from "@/lib/ledgerEvents";
import { formatCC, formatDC, round2 } from "@/lib/format";
import { toast } from "sonner";
import {
  Pickaxe,
  Loader2,
  Zap,
  Sparkles,
  Flame,
  CircleCheck,
  Lock,
  Vault,
  Cpu,
} from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HEX = "0123456789ABCDEF";
function randToken(): string {
  let s = "0x";
  for (let i = 0; i < 6; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}
/** Split a total reward into `n` positive display parts that sum to it. */
function splitReward(total: number, n: number): number[] {
  if (n <= 0) return [];
  const weights = Array.from({ length: n }, () => 0.4 + Math.random());
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => round2((w / sum) * total));
  // fix rounding drift on the last part
  const acc = round2(parts.slice(0, -1).reduce((a, b) => a + b, 0));
  parts[n - 1] = round2(total - acc);
  return parts;
}
function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

type Phase = "idle" | "scanning" | "revealing" | "result";

export default function MinePage() {
  return (
    <AppShell>
      <Mine />
    </AppShell>
  );
}

function Mine() {
  const { authedFetch, refresh: refreshMe, member } = useAuth();
  const [status, setStatus] = useState<MiningStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [running, setRunning] = useState(false);
  const [buying, setBuying] = useState(false);
  const [result, setResult] = useState<MineOutcome | null>(null);
  const [reveal, setReveal] = useState<number[]>([]);
  const [tally, setTally] = useState(0);
  const [scanPairs, setScanPairs] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // stable random token columns for the two streams
  const leftTokens = useMemo(() => Array.from({ length: 14 }, randToken), []);
  const rightTokens = useMemo(() => Array.from({ length: 14 }, randToken), []);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await authedFetch("/api/mine");
      if (r.ok && mounted.current) setStatus((await r.json()) as MiningStatus);
    } catch {
      /* ignore */
    }
  }, [authedFetch]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const totalPairs = status ? status.tokensPerSide * status.tokensPerSide : 1e10;

  async function doMine() {
    if (!status?.canMine || running) return;
    setRunning(true);
    setPhase("scanning");
    setResult(null);
    setReveal([]);
    setTally(0);
    setScanPairs(0);

    // cosmetic scan counter racing toward total pairs
    const scanStart = performance.now();
    const scanDur = 1150;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - scanStart) / scanDur);
      setScanPairs(Math.floor(p * totalPairs));
      if (p < 1 && mounted.current) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    let outcome: MineOutcome | null = null;
    try {
      const r = await authedFetch("/api/mine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mine" }),
      });
      const d = await r.json().catch(() => ({}));
      cancelAnimationFrame(raf);
      if (!r.ok) {
        if (mounted.current) {
          setPhase("idle");
          setRunning(false);
          toast.error(d.message || "Couldn't mine right now.");
        }
        await fetchStatus();
        return;
      }
      outcome = d as MineOutcome;
    } catch {
      cancelAnimationFrame(raf);
      if (mounted.current) {
        setPhase("idle");
        setRunning(false);
        toast.error("Network error. Try again.");
      }
      return;
    }

    if (!mounted.current) return;
    setScanPairs(totalPairs);
    await sleep(Math.max(0, scanDur - (performance.now() - scanStart)));
    if (!mounted.current) return;

    setResult(outcome);
    setPhase("revealing");

    const parts = splitReward(outcome.reward, outcome.matches);
    const stagger = Math.min(240, Math.max(55, Math.round(1000 / Math.max(1, outcome.matches))));
    let acc = 0;
    for (let i = 0; i < outcome.matches; i++) {
      if (!mounted.current) return;
      setReveal((prev) => [...prev, parts[i]]);
      acc = round2(acc + parts[i]);
      setTally(acc);
      await sleep(stagger);
    }
    if (!mounted.current) return;
    setTally(outcome.reward);
    setPhase("result");

    await Promise.all([refreshMe(), fetchStatus()]);
    emitLedgerChange();
    if (mounted.current) setRunning(false);
  }

  async function buyPack() {
    if (running || buying || !status?.nextTier) return;
    setBuying(true);
    try {
      const r = await authedFetch("/api/mine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "buy" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(d.message || "Couldn't unlock that pack.");
      } else {
        const b = d as BuyPackOutcome;
        toast.success(`Unlocked ${b.mines} mines · spent ${b.fee} DC 🔥`);
        await Promise.all([refreshMe(), fetchStatus()]);
        emitLedgerChange();
      }
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      if (mounted.current) setBuying(false);
    }
  }

  const dcBalance = member?.dcBalance ?? status?.dcBalance ?? 0;
  const ccBalance = member?.balance ?? status?.balance ?? 0;
  const reservePct = status
    ? Math.max(0, Math.min(100, (status.reserveRemaining / status.supplyCap) * 100))
    : 0;
  const needsPack =
    !!status && status.freeRemaining <= 0 && status.paidRemaining <= 0;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="text-center">
        <h1 className="flex items-center justify-center gap-2 font-display text-2xl font-bold text-white">
          <Pickaxe size={22} className="text-ember-400" /> Mining Rig
        </h1>
        <p className="mt-1 text-sm text-mute">
          Draw {status ? status.tokensPerSide.toLocaleString() : "100,000"} tokens
          against the secret vault — every collision with the hidden set forges DC.
        </p>
      </div>

      {/* ── the rig ── */}
      <section className="relative overflow-hidden rounded-[28px] border border-gold-500/20 bg-gradient-to-b from-ink-700/80 to-ink-800/80 p-4 shadow-glow">
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <TokenStream
            label="YOUR DRAWS"
            icon={Cpu}
            tokens={leftTokens}
            fast={phase === "scanning"}
          />

          {/* center console */}
          <div className="relative flex w-36 flex-col items-center justify-center rounded-2xl border border-white/5 bg-ink-900/60 px-2 py-4 sm:w-44">
            {phase === "scanning" && (
              <div className="pointer-events-none absolute inset-x-2 top-0 h-16 animate-scan-sweep bg-gradient-to-b from-transparent via-gold-400/25 to-transparent" />
            )}

            {phase === "idle" && (
              <div className="flex flex-col items-center text-center">
                <div className="animate-float">
                  <DarkCoinLogo size={72} glow />
                </div>
                <p className="mt-3 text-[11px] uppercase tracking-wider text-mute">
                  Rig idle
                </p>
              </div>
            )}

            {phase === "scanning" && (
              <div className="flex flex-col items-center text-center">
                <Loader2 size={30} className="animate-spin text-gold-400" />
                <p className="mt-3 text-[11px] uppercase tracking-wider text-gold-300">
                  Scanning
                </p>
                <p className="mt-1 font-display text-sm font-bold tabular-nums text-white">
                  {Math.floor(scanPairs).toLocaleString()}
                </p>
                <p className="text-[10px] text-mute">pairs compared</p>
              </div>
            )}

            {(phase === "revealing" || phase === "result") && result && (
              <div className="flex flex-col items-center text-center">
                {result.capped ? (
                  <Sparkles size={30} className="animate-cap-slam text-ember-300" />
                ) : (
                  <DarkCoinLogo size={32} />
                )}
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-3xl font-black tabular-nums text-ember-300">
                    {formatDC(phase === "result" ? result.reward : tally)}
                  </span>
                </div>
                <p className="text-[10px] uppercase tracking-wider text-mute">
                  DC forged
                </p>
                <p className="mt-1 text-[11px] text-teal-300">
                  {result.matches} match{result.matches === 1 ? "" : "es"}
                  {result.boosted ? " · boosted" : ""}
                </p>
              </div>
            )}
          </div>

          <TokenStream
            label="THE VAULT"
            icon={Vault}
            tokens={rightTokens}
            fast={phase === "scanning"}
            reverse
          />
        </div>

        {/* match chips */}
        {(phase === "revealing" || phase === "result") && result && (
          <div className="mt-3 min-h-[34px] rounded-2xl border border-white/5 bg-ink-900/50 p-2">
            {result.matches === 0 ? (
              <p className="py-1 text-center text-xs text-mute">
                No collisions this run — better luck next draw.
              </p>
            ) : (
              <div className="flex flex-wrap justify-center gap-1.5">
                {reveal.map((v, i) => (
                  <span
                    key={i}
                    className="animate-match-burst inline-flex items-center gap-1 rounded-full border border-ember-500/30 bg-ember-500/10 px-2 py-0.5 text-[11px] font-semibold text-ember-300"
                  >
                    <Sparkles size={11} /> +{formatDC(v)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── balance + action ── */}
      <section className="dc-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-mute">
              Your Dark Capsule Coin
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <CountUp
                value={dcBalance}
                format={formatDC}
                className="text-3xl font-bold text-white"
              />
              <span className="text-base font-semibold text-ember-400">DC</span>
            </div>
            <div className="mt-0.5 text-xs text-mute">
              {formatCC(ccBalance)} CC in your wallet · packs cost DC
            </div>
          </div>
          <AttemptsBadge status={status} />
        </div>

        <div className="mt-4">
          {status && status.standing !== "OK" ? (
            <div className="rounded-capsule border border-ember-500/40 bg-ember-500/10 px-5 py-3 text-center text-sm text-ember-200">
              {status.standing === "BANNED"
                ? "Mining is locked — your account is frozen."
                : "Mining is locked while you're below the −500 CC floor. Earn CC back to recover."}
            </div>
          ) : status && !status.canMine && needsPack && !status.nextTier ? (
            <div className="rounded-capsule border border-edge bg-ink-800/60 px-5 py-3 text-center text-sm text-mute">
              You&apos;ve used every mine today. Refills in{" "}
              <span className="text-white">
                {fmtCountdown(status.resetsAtMs - now)}
              </span>
              .
            </div>
          ) : status && status.reserveRemaining <= 0 ? (
            <div className="rounded-capsule border border-edge bg-ink-800/60 px-5 py-3 text-center text-sm text-mute">
              The mining reserve is tapped out. Spending DC on games and packs reopens it.
            </div>
          ) : needsPack && status?.nextTier ? (
            <button
              onClick={buyPack}
              disabled={buying}
              className="btn-ghost w-full border-gold-500/40 text-gold-300"
            >
              {buying ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Flame size={18} />
              )}
              Unlock {status.nextTier.mines} mines · spend {status.nextTier.fee} DC
            </button>
          ) : (
            <button
              onClick={doMine}
              disabled={!status?.canMine || running}
              className="btn-gold w-full text-base"
            >
              {running ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Mining…
                </>
              ) : (
                <>
                  {status && status.freeRemaining <= 0 ? (
                    <Zap size={18} />
                  ) : (
                    <Pickaxe size={18} />
                  )}
                  {status && status.freeRemaining <= 0
                    ? "Boosted mine"
                    : "Mine"}
                </>
              )}
            </button>
          )}
        </div>
      </section>

      {/* ── pay-to-mine ladder ── */}
      <LadderStepper status={status} />

      {/* ── reserve ── */}
      <section className="capsule-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-mute">
            <Vault size={15} className="text-teal-400" /> DC mining reserve
          </span>
          <span className="font-semibold text-white">
            {status ? formatDC(status.reserveRemaining) : "—"}
            <span className="text-mute">
              {" "}
              / {status ? status.supplyCap.toLocaleString() : "—"} DC
            </span>
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-400 to-ember-500 transition-all duration-700"
            style={{ width: `${reservePct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-mute">
          Fixed supply: only this reserve can ever be mined into circulation, so
          DC can&apos;t inflate away. Spending DC on games and packs reopens
          headroom — an active economy keeps mining alive.
        </p>
      </section>
    </div>
  );
}

// ── subcomponents ────────────────────────────────────────────────────────────
function TokenStream({
  label,
  icon: Icon,
  tokens,
  fast,
  reverse,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tokens: string[];
  fast?: boolean;
  reverse?: boolean;
}) {
  const doubled = [...tokens, ...tokens];
  return (
    <div className="relative h-56 overflow-hidden rounded-2xl border border-white/5 bg-ink-900/40">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 bg-gradient-to-b from-ink-900/90 to-transparent px-2 py-1.5 text-[10px] uppercase tracking-wider text-mute">
        <Icon size={11} className="text-gold-400" /> {label}
      </div>
      <div
        className={`flex flex-col gap-2 px-2 pt-8 ${
          fast ? "animate-token-scroll-fast" : "animate-token-scroll"
        }`}
        style={reverse ? { animationDirection: "reverse" } : undefined}
      >
        {doubled.map((t, i) => (
          <span
            key={i}
            className={`text-center font-mono text-xs tabular-nums ${
              fast ? "text-gold-300/80 blur-[0.4px]" : "text-mute/60"
            }`}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-ink-900/90 to-transparent" />
    </div>
  );
}

function AttemptsBadge({ status }: { status: MiningStatus | null }) {
  if (!status) return null;
  const dots = Array.from({ length: status.freePerDay }, (_, i) => i < status.freeRemaining);
  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1">
        {dots.map((on, i) => (
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full ${
              on ? "bg-gold-400" : "bg-white/10"
            }`}
          />
        ))}
      </div>
      <div className="mt-1 text-[11px] text-mute">
        {status.freeRemaining} free
        {status.paidRemaining > 0 && (
          <span className="text-teal-300"> · {status.paidRemaining} paid</span>
        )}
      </div>
    </div>
  );
}

function LadderStepper({ status }: { status: MiningStatus | null }) {
  const ladder = [
    { fee: 20, mines: 5 },
    { fee: 50, mines: 10 },
    { fee: 100, mines: 20 },
  ];
  return (
    <section className="capsule-card p-5">
      <div className="flex items-center gap-2 text-sm text-mute">
        <Flame size={15} className="text-gold-400" /> Pay-to-mine ladder
        <span className="ml-auto text-[11px]">unlocked in order · resets daily</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {ladder.map((t, i) => {
          const unlocked = !!status && i < status.tier;
          const isNext = !!status && i === status.tier;
          return (
            <div
              key={i}
              className={`rounded-2xl border p-3 text-center transition ${
                unlocked
                  ? "border-teal-500/40 bg-teal-500/10"
                  : isNext
                    ? "border-gold-500/50 bg-gold-500/10 shadow-glow"
                    : "border-edge bg-ink-800/40 opacity-60"
              }`}
            >
              <div className="flex items-center justify-center gap-1 text-sm font-bold text-white">
                {unlocked ? (
                  <CircleCheck size={14} className="text-teal-400" />
                ) : !isNext ? (
                  <Lock size={13} className="text-mute" />
                ) : null}
                +{t.mines}
              </div>
              <div className="mt-0.5 text-[11px] text-mute">spend {t.fee} DC</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
