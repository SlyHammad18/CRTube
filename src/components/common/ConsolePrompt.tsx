import { useReducedMotion } from "motion/react";

export function ConsolePrompt({ lines }: { lines: string[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="font-mono text-15 text-dim">
        {lines.map((line, i) => (
          <p key={line}>
            {line}
            {i === lines.length - 1 && (
              <span className={reduce ? "" : "animate-caret"}>_</span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}
