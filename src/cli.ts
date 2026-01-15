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

export async function runCli() {
  const program = new Command();

  program
    .name("transcript-rag")
    .description("Transcript RAG CLI")
    .option("--ingest", "Ingest transcripts (skip processed by default)")
    .option("--force", "Re-ingest all transcripts (overrides skip)")
    .option("--ask <question>", "Ask a question over transcripts")
    .option("--transcripts-dir <path>", "Directory containing .srt files", "transcripts")
    .option("--top-k <number>", "Number of chunks to retrieve (default 25)")
    .option("--lessons <names>", "Filter to specific lesson(s), comma-separated")
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
