import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useToastStore } from "../../stores/toast";

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const reduce = useReducedMotion();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-12 right-5 z-[110] flex flex-col items-end gap-2"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: reduce ? 0.01 : 0.22,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="pointer-events-auto flex items-center gap-2.5 rounded-card border border-line bg-panel px-3.5 py-2.5 text-13 text-ink shadow-panel"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ice" />
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
