export type SrtEntry = {
  start: string;
  end: string;
  text: string;
};

const TIMECODE_REGEX =
  /(?<start>\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(?<end>\d{2}:\d{2}:\d{2},\d{3})/;

function normalizeTimestamp(raw: string): string {
  // Normalize "00:01:02,345" -> "00:01:02.345" and drop ms for display
  const cleaned = raw.replace(",", ".");
  return cleaned.split(".")[0];
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

    const textLines = lines.slice(match === lines[0] ? 1 : 2);
    const text = textLines.join(" ").trim();
    if (!text) continue;

    entries.push({ start, end, text });
  }

  return entries;
}
