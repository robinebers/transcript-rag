import { Command } from "commander";
import { runIngest } from "./ingest";
import { answerQuestion } from "./search";
import { initDb, getAvailableLessons } from "./db";

type CliOptions = {
  ingest?: boolean;
  force?: boolean;
  ask?: string;
  transcriptsDir?: string;
  topK?: string;
  lessons?: string;
  listLessons?: boolean;
};

function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const matrix = Array.from({ length: aLen + 1 }, () =>
    Array.from({ length: bLen + 1 }, () => 0),
  );

  for (let i = 0; i <= aLen; i++) matrix[i][0] = i;
  for (let j = 0; j <= bLen; j++) matrix[0][j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[aLen][bLen];
}

function lessonSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower === bLower) return 1;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.95;
  const distance = levenshteinDistance(aLower, bLower);
  return 1 - distance / Math.max(aLower.length, bLower.length);
}

function suggestLessons(input: string, available: string[]): string[] {
  return available
    .map((name) => ({ name, score: lessonSimilarity(input, name) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.name);
}

export async function runCli() {
  const program = new Command();

  program
    .name("transcript-rag")
    .description("Transcript RAG CLI")
    .option("--ingest", "Ingest transcripts (skip processed by default)")
    .option("--force", "Re-ingest all transcripts (overrides skip)")
    .option("--ask <question>", "Ask a question over transcripts")
    .option(
      "--transcripts-dir <path>",
      "Directory containing .srt files",
      "transcripts",
    )
    .option("--top-k <number>", "Number of chunks to retrieve (default 25)")
    .option(
      "--lessons <names>",
      "Filter to specific lesson(s), comma-separated",
    )
    .option("--list-lessons", "List available lessons")
    .action(async (opts: CliOptions) => {
      const hasAction = opts.ingest || opts.ask || opts.listLessons;

      if (!hasAction) {
        program.help();
        return;
      }

      if (opts.listLessons) {
        await initDb();
        const lessons = getAvailableLessons();
        if (lessons.length === 0) {
          console.log("No lessons found. Run --ingest first.");
        } else {
          console.log("Available lessons:");
          lessons.forEach((l) => console.log(`  - ${l}`));
        }
        return;
      }

      const apiKey = process.env.AI_GATEWAY_API_KEY;
      if (!apiKey) {
        console.error("AI_GATEWAY_API_KEY is required.");
        process.exit(1);
      }

      if (opts.ingest) {
        await runIngest({
          transcriptsDir: opts.transcriptsDir ?? "transcripts",
          force: Boolean(opts.force),
        });
      }

      if (opts.ask) {
        const topK = opts.topK ? Number.parseInt(opts.topK, 10) : 25;
        const lessons = opts.lessons
          ? opts.lessons.split(",").map((l) => l.trim())
          : undefined;
        if (lessons && lessons.length > 0) {
          await initDb();
          const availableLessons = getAvailableLessons();
          if (availableLessons.length === 0) {
            console.error("No lessons found. Run --ingest first.");
            process.exit(1);
          }

          const invalid = lessons.filter(
            (lesson) => !availableLessons.includes(lesson),
          );

          if (invalid.length > 0) {
            console.error(`Unknown lesson(s): ${invalid.join(", ")}`);
            invalid.forEach((lesson) => {
              const suggestions = suggestLessons(lesson, availableLessons);
              if (suggestions.length > 0) {
                console.error(`Did you mean: ${suggestions.join(", ")}?`);
              }
            });
            process.exit(1);
          }
        }
        await answerQuestion({
          question: opts.ask,
          transcriptsDir: opts.transcriptsDir ?? "transcripts",
          topK: Number.isFinite(topK) && topK > 0 ? topK : 25,
          lessons,
        });
      }
    });

  await program.parseAsync();
}
