"use client";

import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithCustomToken,
} from "firebase/auth";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// "Cache after verified on that device": keep the session in local storage so a
// member stays signed in on this device across restarts until they sign out.
if (typeof window !== "undefined") {
  setPersistence(auth, browserLocalPersistence).catch(() => {
    /* non-fatal: falls back to default persistence */
  });

  // Dev-only helper: lets local integration tests establish a browser session
  // via a custom token. Stripped from production builds (NODE_ENV === production).
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as Record<string, unknown>).__cpcDevSignIn = (
      token: string,
    ) => signInWithCustomToken(auth, token);
    // Dev-only: expose the current ID token so local integration tests can call
    // the authenticated APIs directly. Stripped from production builds.
    (window as unknown as Record<string, unknown>).__cpcGetToken = () =>
      auth.currentUser?.getIdToken();
  }
}
