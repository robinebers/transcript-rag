import { readdir, stat } from "node:fs/promises";
import { join, parse as parsePath } from "node:path";
import { embedTexts } from "./embed";
import {
  deleteByLesson,
  initDb,
  insertChunk,
  insertEmbedding,
  getProcessedInfo,
  recordProcessed,
} from "./db";
import { aggregateEntries, normalizeEntries, parseSrt } from "./srt";

type IngestOptions = {
  transcriptsDir: string;
  force: boolean;
};

export async function runIngest(options: IngestOptions) {
  await initDb();

  const dirEntries = await readdir(options.transcriptsDir, {
    withFileTypes: true,
  });
  const srtFiles = dirEntries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".srt"),
    )
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

    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      console.warn(`File missing: ${filepath}`);
      continue;
    }

    const stats = await stat(filepath);
    const mtime = Math.floor(stats.mtimeMs);
    const size = stats.size;
    const processed = getProcessedInfo(lessonName);
    const isUnchanged =
      processed && processed.mtime === mtime && processed.size === size;

    if (!options.force && isUnchanged) {
      console.log(`Skipping unchanged: ${filename}`);
      skipped += 1;
      continue;
    }

    if (options.force || processed) {
      deleteByLesson(lessonName);
    }

    const content = await file.text();
    const entries = parseSrt(content);

    if (entries.length === 0) {
      console.warn(`No entries parsed from ${filename}`);
      continue;
    }

    const normalizedEntries = normalizeEntries(entries);
    const chunks = aggregateEntries(normalizedEntries, 45, 10);

    if (chunks.length === 0) {
      console.warn(`No chunks created from ${filename}`);
      continue;
    }

    const embeddings = await embedTexts(
      chunks.map((chunk) => chunk.text),
      "document",
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      const chunkId = insertChunk({
        lessonName,
        chunkIndex: chunk.chunkIndex,
        startTime: chunk.start,
        endTime: chunk.end,
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        text: chunk.text,
      });
      insertEmbedding(chunkId, embedding);
    }

    recordProcessed(lessonName, mtime, size);
    ingested += 1;
    console.log(`Ingested: ${filename} (${chunks.length} chunks)`);
  }

  console.log(
    `Ingest complete. Ingested ${ingested}, skipped ${skipped}, total files ${srtFiles.length}.`,
  );
}
