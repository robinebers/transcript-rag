export type SrtEntry = {
  start: string;
  end: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type ChunkEntry = {
  chunkIndex: number;
  start: string;
  end: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

const TIMECODE_REGEX =
  /(?<start>\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(?<end>\d{2}:\d{2}:\d{2},\d{3})/;

function normalizeTimestamp(raw: string): string {
  // Normalize "00:01:02,345" -> "00:01:02.345" and drop ms for display
  const cleaned = raw.replace(",", ".");
  return cleaned.split(".")[0];
}

function timestampToSeconds(raw: string): number {
  const cleaned = raw.replace(",", ".");
  const [hours, minutes, rest] = cleaned.split(":");
  const [seconds, millis] = rest.split(".");
  const total =
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(millis ?? 0) / 1000;
  return Number.isFinite(total) ? total : 0;
}

function stripBracketedCues(text: string): string {
  return text.replace(/\[[^\]]+?\]/g, " ");
}

function stripSpeakerPrefix(text: string): string {
  return text.replace(/^\s*(>>\s*|[A-Za-z][A-Za-z0-9_ -]{0,30}:\s+)/, "");
}

export function normalizeText(text: string): string {
  const cleaned = stripSpeakerPrefix(stripBracketedCues(text));
  return cleaned.replace(/\s+/g, " ").trim();
}

export function parseSrt(content: string): SrtEntry[] {
  const blocks = content.split(/\r?\n\r?\n/);
  const entries: SrtEntry[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) continue;

    const timeLine = lines[0].match(TIMECODE_REGEX) ? lines[0] : lines[1];
    const match = timeLine?.match(TIMECODE_REGEX);
    if (!match || !match.groups) continue;

    const start = normalizeTimestamp(match.groups.start);
    const end = normalizeTimestamp(match.groups.end);
    const startSeconds = timestampToSeconds(match.groups.start);
    const endSeconds = timestampToSeconds(match.groups.end);

    const textLines = lines.slice(match === lines[0] ? 1 : 2);
    const text = textLines.join(" ").trim();
    if (!text) continue;

    entries.push({ start, end, startSeconds, endSeconds, text });
  }

  return entries;
}

export function normalizeEntries(entries: SrtEntry[]): SrtEntry[] {
  const normalized: SrtEntry[] = [];
  let lastText = "";

  for (const entry of entries) {
    const cleaned = normalizeText(entry.text);
    if (!cleaned) continue;
    if (cleaned.toLowerCase() === lastText) continue;
    lastText = cleaned.toLowerCase();
    normalized.push({ ...entry, text: cleaned });
  }

  return normalized;
}

export function aggregateEntries(
  entries: SrtEntry[],
  windowSeconds = 45,
  overlapSeconds = 10,
): ChunkEntry[] {
  if (entries.length === 0) return [];

  const chunks: ChunkEntry[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < entries.length) {
    const windowStart = entries[startIndex].startSeconds;
    let endIndex = startIndex;

    while (
      endIndex < entries.length &&
      entries[endIndex].endSeconds - windowStart <= windowSeconds
    ) {
      endIndex += 1;
    }

    if (endIndex === startIndex) {
      endIndex = Math.min(startIndex + 1, entries.length);
    }

    const slice = entries.slice(startIndex, endIndex);
    const text = slice
      .map((entry) => entry.text)
      .join(" ")
      .trim();

    if (text) {
      const first = slice[0];
      const last = slice[slice.length - 1];
      chunks.push({
        chunkIndex,
        start: first.start,
        end: last.end,
        startSeconds: first.startSeconds,
        endSeconds: last.endSeconds,
        text,
      });
      chunkIndex += 1;
    }

    const overlapStart = slice[slice.length - 1].endSeconds - overlapSeconds;
    let nextIndex = startIndex + 1;
    while (
      nextIndex < entries.length &&
      entries[nextIndex].startSeconds < overlapStart
    ) {
      nextIndex += 1;
    }

    if (nextIndex <= startIndex) {
      nextIndex = startIndex + 1;
    }

    startIndex = nextIndex;
  }

  return chunks;
}
