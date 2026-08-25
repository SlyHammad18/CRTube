import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useUIStore } from "./stores/ui";
import { Titlebar } from "./components/titlebar/Titlebar";
import { Rail } from "./components/rail/Rail";
import { BootOverlay } from "./components/boot/BootOverlay";
import { Scanlines } from "./components/common/Scanlines";
import { PlaceholderView } from "./components/common/PlaceholderView";

export default function App() {
  const view = useUIStore((s) => s.view);
  const booted = useUIStore((s) => s.booted);
  const setBooted = useUIStore((s) => s.setBooted);
  const reduce = useReducedMotion();

  return (
    <>
      <motion.div
        className="flex h-full flex-col overflow-hidden bg-void"
        initial={false}
        animate={
          booted
            ? { opacity: 1, scale: 1 }
            : reduce
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.98 }
        }
        transition={{ duration: reduce ? 0.01 : 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        <Titlebar />
        <div className="flex min-h-0 flex-1">
          <Rail />
          <main className="relative min-w-0 flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                className="absolute inset-0 flex flex-col overflow-y-auto p-8"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={{
                  opacity: 0,
                  transition: {
                    duration: reduce ? 0.01 : 0.12,
                    ease: "easeIn",
                  },
                }}
                transition={{
                  duration: reduce ? 0.01 : 0.24,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <PlaceholderView view={view} />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </motion.div>
      <BootOverlay onDone={() => setBooted(true)} />
      <Scanlines />
    </>
  );
}
