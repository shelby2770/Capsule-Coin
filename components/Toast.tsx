"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, X } from "lucide-react";

type Tone = "warn" | "error" | "info";
type ToastItem = { id: number; message: string; tone: Tone };
type ToastCtx = { show: (message: string, tone?: Tone) => void };

const Ctx = createContext<ToastCtx | null>(null);

/**
 * Lightweight app-wide toasts. Used for prominent, transient feedback such as
 * rate-limit rejections ("slow down, try again in …"). Auto-dismiss after 6s.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback(
    (id: number) => setItems((t) => t.filter((x) => x.id !== id)),
    [],
  );

  const show = useCallback(
    (message: string, tone: Tone = "info") => {
      const id = Date.now() + Math.random();
      setItems((t) => [...t, { id, message, tone }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 left-4 right-4 z-[100] flex flex-col items-end gap-2 sm:left-auto"
        aria-live="polite"
        role="status"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`animate-toast-in-up pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
              t.tone === "error"
                ? "border-red-500/40 bg-red-500/15 text-red-200"
                : t.tone === "warn"
                  ? "border-gold-500/40 bg-gold-500/15 text-gold-200"
                  : "border-white/15 bg-white/10 text-white"
            }`}
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-70 transition hover:opacity-100"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Safe no-op if used outside the provider. */
export function useToast(): ToastCtx {
  return useContext(Ctx) ?? { show: () => {} };
}
