/**
 * The company domain. Membership (the 16-email allowlist in lib/allowlist.ts) is
 * the real access gate; this only decides who is offered the read-only guest tour
 * at /visit. Deliberately has NO "server-only" pragma so the client pages (login,
 * visit, AppShell) and the /api/visit route can share one definition.
 */
export const ORBITAX_DOMAIN = "orbitax.com";

/** True for an @orbitax.com address (case- and whitespace-insensitive). */
export function isOrbitaxEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${ORBITAX_DOMAIN}`);
}
