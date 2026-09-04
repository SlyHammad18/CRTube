import { useEffect, useRef, useState } from "react";

/**
 * IntersectionObserver-based reveal. Returns a ref and a boolean; when the
 * element enters the viewport the boolean flips to `true` and stays there.
 * Used for GPU-composited CSS entrance transitions without Framer Motion.
 */
export function useReveal<T extends HTMLElement = HTMLElement>(opts?: {
  threshold?: number;
  rootMargin?: string;
}) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: opts?.threshold ?? 0, rootMargin: opts?.rootMargin ?? "0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, opts?.threshold, opts?.rootMargin]);

  return { ref, visible };
}
