import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// The only permitted gradient (#4DD8FF → #38E0C8) lives here, on the boot logotype.
const SHEEN = "linear-gradient(90deg, #4dd8ff 0%, #38e0c8 100%)";

export function BootOverlay({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShow(false), reduce ? 150 : 720);
    return () => clearTimeout(t);
  }, [reduce]);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {show && (
        <motion.div
          key="boot"
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-void"
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.01 : 0.18, ease: "easeOut" }}
        >
          {!reduce && (
            <>
              <motion.div
                aria-hidden
                className="absolute inset-0 bg-ink"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.07, 0.01, 0.05, 0] }}
                transition={{ duration: 0.24, times: [0, 0.25, 0.5, 0.75, 1] }}
              />
              <motion.div
                aria-hidden
                className="absolute left-0 right-0 top-0 h-[2px] bg-ice/25"
                initial={{ y: "-4vh" }}
                animate={{ y: "104vh" }}
                transition={{ duration: 0.42, ease: "linear", delay: 0.04 }}
              />
            </>
          )}
          <motion.div
            className="relative select-none"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={
              reduce
                ? { opacity: 1 }
                : { opacity: [0, 1, 0.55, 1], scale: [0.96, 1.02, 1] }
            }
            transition={{
              delay: reduce ? 0 : 0.18,
              duration: reduce ? 0.15 : 0.34,
              times: reduce ? undefined : [0, 0.35, 0.6, 1],
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {!reduce && (
              <>
                <motion.span
                  aria-hidden
                  className="absolute inset-0 font-display text-[44px] font-bold tracking-tight text-ice"
                  initial={{ x: -7, opacity: 0 }}
                  animate={{ x: 0, opacity: 0.5 }}
                  transition={{ delay: 0.2, duration: 0.3, ease: "easeOut" }}
                >
                  CRTUBE
                </motion.span>
                <motion.span
                  aria-hidden
                  className="absolute inset-0 font-display text-[44px] font-bold tracking-tight"
                  style={{ color: "#38e0c8" }}
                  initial={{ x: 7, opacity: 0 }}
                  animate={{ x: 0, opacity: 0.5 }}
                  transition={{ delay: 0.2, duration: 0.3, ease: "easeOut" }}
                >
                  CRTUBE
                </motion.span>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                >
                  <motion.span
                    className="absolute inset-0 font-display text-[44px] font-bold tracking-tight text-transparent"
                    style={{
                      backgroundImage: SHEEN,
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                    }}
                    initial={{ x: "-105%", opacity: 0.9 }}
                    animate={{ x: "105%", opacity: 0 }}
                    transition={{ delay: 0.38, duration: 0.45, ease: "easeInOut" }}
                  >
                    CRTUBE
                  </motion.span>
                </span>
              </>
            )}
            <span
              className="relative font-display text-[44px] font-bold tracking-tight text-transparent"
              style={{
                backgroundImage: SHEEN,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
              }}
            >
              CRTUBE
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
