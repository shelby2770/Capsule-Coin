import "server-only";

import { readFileSync } from "fs";
import path from "path";
import {
  initializeApp,
  getApps,
  cert,
  applicationDefault,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firebase Admin — verifies Firebase ID tokens sent by the client.
 * Credential resolution order:
 *   1. FIREBASE_ADMIN_CREDENTIALS_FILE  (path to the service-account JSON) — local dev
 *   2. FIREBASE_ADMIN_SERVICE_ACCOUNT   (single-line service-account JSON) — deploys
 *   3. GOOGLE_APPLICATION_CREDENTIALS   (Google default credentials)
 *   4. projectId only (dev fallback: can still verify token signatures)
 */
function loadServiceAccount(): ServiceAccount | null {
  const file = process.env.FIREBASE_ADMIN_CREDENTIALS_FILE;
  if (file && file.trim()) {
    try {
      const resolved = path.resolve(process.cwd(), file.trim());
      return JSON.parse(readFileSync(resolved, "utf8")) as ServiceAccount;
    } catch (e) {
      console.error("Could not read FIREBASE_ADMIN_CREDENTIALS_FILE:", e);
    }
  }
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    try {
      return JSON.parse(raw) as ServiceAccount;
    } catch (e) {
      console.error("Could not parse FIREBASE_ADMIN_SERVICE_ACCOUNT:", e);
    }
  }
  return null;
}

function initAdmin(): App {
  const existing = getApps();
  if (existing.length) return existing[0];

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "capsule-coin";
  const svc = loadServiceAccount();

  if (svc) {
    return initializeApp({ credential: cert(svc), projectId });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({ credential: applicationDefault(), projectId });
  }
  return initializeApp({ projectId });
}

const adminApp = initAdmin();
export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp);
