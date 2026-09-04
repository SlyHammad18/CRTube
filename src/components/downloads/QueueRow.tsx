import { memo, useEffect } from "react";
import { motion, useMotionValue, useTransform, useReducedMotion } from "motion/react";
import { CheckCircle, Warning, X } from "@phosphor-icons/react";
import { progressMvs, type QueueItem } from "../../stores/queue";
import { useQueueStore } from "../../stores/queue";
import { fmtBytes, fmtEta } from "../../lib/format";

function queuedPosition(item: QueueItem, items: QueueItem[]): number {
  let pos = 0;
  for (const i of items) {
    if (i.status !== "queued") continue;
    pos += 1;
    if (i.localId === item.localId) return pos;
  }
  return 0;
}

export const QueueRow = memo(function QueueRow({ item }: { item: QueueItem }) {
  const cancel = useQueueStore((s) => s.cancel);
  const dismiss = useQueueStore((s) => s.dismiss);
  const items = useQueueStore((s) => s.items);
  const reduce = useReducedMotion();

  const mv = useMotionValue(item.pct / 100);
  const scaleX = useTransform(mv, [0, 1], [0.02, 1]);

  useEffect(() => {
    progressMvs.set(item.localId, mv);
    return () => {
      progressMvs.delete(item.localId);
    };
  }, [item.localId, mv]);

  const speed = fmtBytes(item.speedBps);
  const eta = fmtEta(item.etaS);
  const pct = Math.round(item.pct);
  const position = item.status === "queued" ? queuedPosition(item, items) : 0;

  return (
    <motion.div
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={{ duration: reduce ? 0.01 : 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-card border border-line bg-panel p-3 ${
        item.status === "queued" ? "opacity-60" : ""
      }`}
    >
      {item.status === "done" && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-ice"
          initial={{ opacity: 0.25 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      )}
      <div className="flex items-center gap-3">
        <div className="relative h-[54px] w-[96px] shrink-0 overflow-hidden rounded-card bg-raise">
          {item.request.thumbUrl && (
            <img
              src={item.request.thumbUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-90"
            />
          )}
          {item.status === "queued" && (
            <span className="absolute inset-0 grid place-items-center bg-void/60 font-mono text-18 text-ink">
              {position}
            </span>
          )}
          {item.status === "done" && (
            <span className="absolute inset-0 grid place-items-center bg-void/60">
              <CheckCircle size={26} weight="light" className="text-ice" aria-hidden />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-13 text-ink">{item.request.title}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-raise">
              <motion.div
                className="relative h-full origin-left overflow-hidden rounded-full bg-ice"
                style={{ scaleX }}
              >
                {item.status === "active" && !reduce && (
                  <span className="animate-sheen absolute inset-y-0 left-0 w-1/4 bg-ink/30" />
                )}
              </motion.div>
            </div>
            {item.status === "active" && (
              <span className="shrink-0 font-mono text-12 text-mute">
                {item.stage !== "download"
                  ? `${item.stage}…`
                  : `${speed ? `${speed}/s` : "—"} · ${
                      eta ? `ETA ${eta}` : "ETA —"
                    } · ${pct}%`}
              </span>
            )}
            {item.status === "queued" && (
              <span className="shrink-0 font-mono text-12 text-mute">queued</span>
            )}
            {item.status === "done" && (
              <span className="shrink-0 font-mono text-12 text-ice">done</span>
            )}
          </div>
          {item.status === "error" && (
            <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-12 text-signal">
              <Warning size={12} weight="light" aria-hidden />
              {item.error ?? "download failed"}
            </p>
          )}
        </div>

        <button
          aria-label={item.status === "error" ? "Dismiss" : "Cancel download"}
          title={item.status === "error" ? "Dismiss" : "Cancel"}
          onClick={() =>
            item.status === "error" || item.status === "done"
              ? dismiss(item.localId)
              : cancel(item.localId)
          }
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
            item.status === "error"
              ? "text-signal hover:bg-raise"
              : "text-mute hover:bg-signal hover:text-void"
          }`}
        >
          {item.status === "done" ? (
            <CheckCircle size={15} weight="light" className="text-ice" aria-hidden />
          ) : (
            <X size={15} weight="light" aria-hidden />
          )}
        </button>
      </div>
    </motion.div>
  );
});
