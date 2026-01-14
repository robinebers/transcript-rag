import { readdir } from "node:fs/promises";
import { join, parse as parsePath } from "node:path";
import { embedTexts } from "./embed";
import {
  deleteByLesson,
  initDb,
  insertChunk,
  insertEmbedding,
  isProcessed,
  recordProcessed,
} from "./db";
import { parseSrt } from "./srt";

type IngestOptions = {
  transcriptsDir: string;
  force: boolean;
};

export async function runIngest(options: IngestOptions) {
  await initDb();

  const dirEntries = await readdir(options.transcriptsDir, { withFileTypes: true });
  const srtFiles = dirEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".srt"))
    .map((entry) => entry.name);

  if (srtFiles.length === 0) {
    console.warn(`No .srt files found in ${options.transcriptsDir}`);
    return;
  }

  let ingested = 0;
  let skipped = 0;

  for (const filename of srtFiles) {
    const { name: lessonName } = parsePath(filename);
    const filepath = join(options.transcriptsDir, filename);

    const alreadyProcessed = isProcessed(lessonName);
    if (alreadyProcessed && !options.force) {
      console.log(`Skipping already processed: ${filename}`);
      skipped += 1;
      continue;
    }

    if (options.force && alreadyProcessed) {
      deleteByLesson(lessonName);
    }

    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      console.warn(`File missing: ${filepath}`);
      continue;
    }

    const content = await file.text();
    const entries = parseSrt(content);

    if (entries.length === 0) {
      console.warn(`No entries parsed from ${filename}`);
      continue;
    }

    const embeddings = await embedTexts(
      entries.map((entry) => entry.text),
      "document"
    );

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const embedding = embeddings[i];
      const chunkId = insertChunk({
        lessonName,
        startTime: entry.start,
        endTime: entry.end,
        text: entry.text,
      });
      insertEmbedding(chunkId, embedding);
    }

    recordProcessed(lessonName);
    ingested += 1;
    console.log(`Ingested: ${filename} (${entries.length} chunks)`);
  }

  console.log(
    `Ingest complete. Ingested ${ingested}, skipped ${skipped}, total files ${srtFiles.length}.`
  );
}
