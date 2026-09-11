"use client";

import { Toaster, toast } from "sonner";

type Tone = "warn" | "error" | "info";

/**
 * App-wide toasts, backed by `sonner`. Mounts the toaster (themed to match the
 * dark UI) and keeps the same name the layout imports. Prominent, transient
 * feedback — rate-limit rejections, mining results, etc.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        toastOptions={{
          style: {
            borderRadius: "16px",
            fontSize: "0.875rem",
          },
        }}
      />
    </>
  );
}

// Stable API object so callers can safely reference it (incl. in effect deps).
const api = {
  show(message: string, tone: Tone = "info") {
    if (tone === "error") toast.error(message);
    else if (tone === "warn") toast.warning(message);
    else toast.message(message);
  },
};

/** Backward-compatible toast hook — `useToast().show(message, tone)`. */
export function useToast() {
  return api;
}
