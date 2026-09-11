import Link from "next/link";
import { CoinLogo } from "@/components/CoinLogo";
import {
  ArrowRight,
  Pickaxe,
  Store,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";

const features = [
  {
    icon: Pickaxe,
    title: "Mine CC",
    body: "Race 100,000 tokens against a hidden vault — every match mints fresh CC.",
  },
  {
    icon: Store,
    title: "Trade & send",
    body: "Post food offers, or send CC peer-to-peer — payments settle on the payer's nod.",
  },
  {
    icon: TrendingUp,
    title: "Live ৳ / $ value",
    body: "The coin's taka & dollar value moves with the group's balance spread, live.",
  },
];

export default function Home() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16 text-center">
      <div className="animate-rise flex flex-col items-center">
        <div className="animate-float">
          <CoinLogo size={96} glow />
        </div>

        <span className="chip mt-8">
          <ShieldCheck size={14} className="text-teal-400" /> Invite-only · 16
          members
        </span>

        <h1 className="mt-6 text-5xl font-bold sm:text-6xl">
          <span className="text-gradient-gold">Capsule Coin</span>
        </h1>

        <p className="mt-4 max-w-xl text-lg text-mute">
          The internal exchange for the Capsule group. Mine{" "}
          <b className="font-semibold text-white">CC</b>, trade food with each
          other, and watch the coin&apos;s value float on the group&apos;s live
          balance spread.
        </p>

        <Link href="/login" className="btn-gold mt-8 text-base">
          Enter the Exchange <ArrowRight size={18} />
        </Link>
      </div>

      <div className="stagger mt-16 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="capsule-card card-hover p-6 text-left">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold-500/10 text-gold-400">
              <f.icon size={20} />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-white">{f.title}</h3>
            <p className="mt-1 text-sm text-mute">{f.body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
