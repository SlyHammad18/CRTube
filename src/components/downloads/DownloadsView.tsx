import { AnimatePresence } from "motion/react";
import { useQueueStore } from "../../stores/queue";
import { QueueRow } from "./QueueRow";

export function DownloadsView() {
  const items = useQueueStore((s) => s.items);

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col pt-[6vh]">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="font-display text-18 font-semibold tracking-tight">
          Downloads
        </h1>
        {items.length > 0 && (
          <span className="font-mono text-12 text-mute">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        )}
      </header>
      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center pb-[20vh]">
          <p className="font-mono text-15 text-mute">{"> no active transfers_"}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <QueueRow key={item.localId} item={item} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
