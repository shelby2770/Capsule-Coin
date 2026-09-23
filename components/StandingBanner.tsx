"use client";

import { useAuth } from "@/components/AuthProvider";
import { AlertTriangle, Ban } from "lucide-react";

/**
 * Credit-floor standing banner. Shows an ember warning while a member is in the
 * −500 grace window (with the live countdown), or a red frozen notice once the
 * account is banned. Renders nothing when the member is in good standing.
 */
export function StandingBanner() {
  const { member } = useAuth();
  if (!member) return null;

  const now = Date.now();
  const graceMs = member.graceUntil ? Date.parse(member.graceUntil) : 0;
  const expired = !!member.graceUntil && graceMs <= now;
  const banned = member.banned || expired;
  const inGrace = !banned && !!member.graceUntil;

  if (banned) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
        <Ban size={18} className="mt-0.5 shrink-0 text-red-300" />
        <div>
          <div className="font-semibold text-red-200">Account frozen</div>
          <p className="mt-1 text-red-200/80">
            You dropped below the −500 CC floor and the 3-day recovery window
            passed, so buying, mining and transfers are locked. You can still be
            paid. Ask an admin to restore access.
          </p>
        </div>
      </div>
    );
  }

  if (inGrace) {
    const hrsLeft = Math.max(0, Math.ceil((graceMs - now) / 3_600_000));
    const days = Math.floor(hrsLeft / 24);
    const hrs = hrsLeft % 24;
    const left = days > 0 ? `${days}d ${hrs}h` : `${hrs}h`;
    return (
      <div className="dc-card mb-4 flex items-start gap-3 border-ember-500/40 p-4 text-sm">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-ember-400" />
        <div>
          <div className="font-semibold text-ember-300">
            Below the −500 CC floor — {left} to recover
          </div>
          <p className="mt-1 text-mute">
            Buying and mining are locked until you climb back above −500. Earn CC
            back by selling or getting paid. Miss the deadline and the account is
            permanently frozen.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
