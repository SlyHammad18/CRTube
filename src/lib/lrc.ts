export interface LrcLine {
  tMs: number;
  text: string;
}

const STAMP = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/**
 * Parse LRC text into time-sorted lines. Multiple timestamps on one line
 * (`[00:01.00][00:05.00] word`) expand to repeated lines; non-timed lines and
 * empty content are dropped. Pure + deterministic — safe to unit test.
 */
export function parseLrc(text: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    STAMP.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = STAMP.exec(raw))) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracRaw = m[3] ?? "0";
      const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
      stamps.push(Math.round((min * 60 + sec + frac) * 1000));
      lastEnd = m.index + m[0].length;
    }
    if (stamps.length === 0) continue;
    const content = raw.slice(lastEnd).trim();
    if (!content) continue;
    for (const t of stamps) out.push({ tMs: t, text: content });
  }
  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}

/**
 * Index of the active line for `tMs` (binary search): the last line whose
 * timestamp is <= tMs, or -1 if before the first line. Callers pass the
 * playback time directly; the ~200ms sync tolerance is inherent to LRC
 * granularity, not this lookup.
 */
export function activeIndex(lines: LrcLine[], tMs: number): number {
  if (lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].tMs <= tMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
