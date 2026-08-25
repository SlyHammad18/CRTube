const YT_URL_RE =
  /^https?:\/\/(www\.|music\.)?(youtube\.com\/(watch\?[^\s]*v=[\w-]{11}|(shorts|embed|live)\/[\w-]{11}|playlist\?[^\s]*list=[\w-]+)|youtu\.be\/[\w-]{11})/i;

export function looksLikeUrl(input: string): boolean {
  return YT_URL_RE.test(input.trim());
}

export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (!looksLikeUrl(s)) return null;

  const short = /^https?:\/\/youtu\.be\/([\w-]{11})/i.exec(s);
  if (short) return short[1];

  const path =
    /(youtube\.com\/(?:watch\?|shorts\/|embed\/|live\/))[\s\S]*/i.exec(s)?.[0] ?? "";
  const vParam = /[?&]v=([\w-]{11})/i.exec(path);
  if (vParam) return vParam[1];

  const seg = /(?:shorts|embed|live)\/([\w-]{11})/i.exec(s);
  return seg ? seg[1] : null;
}
