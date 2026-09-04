import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useConfirmStore } from "../../stores/confirm";

/**
 * Single global confirm dialog (DESIGN §2). Driven by `confirm()` from the
 * confirm store; renders nothing when no request is pending. Confirm button
 * is focused on open so Enter confirms; Escape / backdrop click cancels.
 */
export function ConfirmModal() {
  const pending = useConfirmStore((s) => s.pending);
  const resolve = useConfirmStore((s) => s.resolve);
  const reduce = useReducedMotion();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolve(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, resolve]);

  const opts = pending?.opts;
  const confirmLabel = opts?.confirmLabel ?? "Delete";
  const cancelLabel = opts?.cancelLabel ?? "Cancel";

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-void/60 p-4"
          onClick={() => resolve(false)}
          initial={reduce ? { opacity: 0 } : { opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0 }}
          transition={{ duration: reduce ? 0.01 : 0.1 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
            transition={{
              duration: reduce ? 0.01 : 0.15,
            }}
            className="w-[min(92vw,360px)] rounded-card border border-line bg-panel p-4 shadow-panel"
          >
            <h2 id="confirm-title" className="text-15 font-semibold text-ink">
              {opts?.title}
            </h2>
            {opts?.message && (
              <p className="mt-1.5 text-13 text-mute">{opts.message}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                aria-label={cancelLabel}
                onClick={() => resolve(false)}
                className="rounded-card border border-line px-3 py-1.5 text-13 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                aria-label={confirmLabel}
                onClick={() => resolve(true)}
                className="rounded-card bg-signal px-3 py-1.5 text-13 font-semibold text-void transition-colors duration-150 hover:bg-ink active:scale-[0.98]"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
