import { motion, useReducedMotion } from "motion/react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  const reduce = useReducedMotion();
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 active:scale-[0.98] ${
        checked ? "border-ice bg-ice" : "border-line bg-raise"
      }`}
    >
      <motion.span
        initial={false}
        animate={{ x: checked ? 18 : 0 }}
        transition={
          reduce
            ? { duration: 0 }
            : { type: "spring", stiffness: 300, damping: 22 }
        }
        className={`absolute left-[2px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full ${
          checked ? "bg-void" : "bg-dim"
        }`}
      />
    </button>
  );
}
