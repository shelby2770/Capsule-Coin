import "server-only";

import { adminAuth } from "@/lib/firebase/admin";
import { allowlistEntry, isAllowed, normalizeEmail } from "@/lib/allowlist";

export type VerifiedIdentity = {
  uid: string;
  email: string;
  name: string;
};

/**
 * Verify the Firebase ID token from an Authorization: Bearer header.
 * Returns the identity, or null if missing/invalid. This does NOT check the
 * allowlist — callers decide how to respond (see requireMember).
 */
export async function verifyBearer(req: Request): Promise<VerifiedIdentity | null> {
  const header =
    req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = normalizeEmail(decoded.email || "");
    if (!email) return null;
    const name = allowlistEntry(email)?.name || (decoded.name as string) || email;
    return { uid: decoded.uid, email, name };
  } catch {
    return null;
  }
}

export type MemberGate =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; status: 401 | 403 };

/**
 * Verify the token AND enforce the allowlist. Use this at the top of every
 * mutating/data route.
 */
export async function requireMember(req: Request): Promise<MemberGate> {
  const identity = await verifyBearer(req);
  if (!identity) return { ok: false, status: 401 };
  if (!isAllowed(identity.email)) return { ok: false, status: 403 };
  return { ok: true, identity };
}
