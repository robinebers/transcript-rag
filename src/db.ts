import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

export type ChunkRecord = {
  lessonName: string;
  chunkIndex: number;
  startTime: string;
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type RetrievedChunk = ChunkRecord & {
  id: number;
  distance?: number;
  bm25?: number;
};

export const EMBEDDING_DIMENSIONS = 1024;
const SCHEMA_VERSION = 2;

const SQLITE_CANDIDATES = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon Homebrew
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel Homebrew
];

function trySetCustomSQLite() {
  for (const candidate of SQLITE_CANDIDATES) {
    if (existsSync(candidate)) {
      Database.setCustomSQLite(candidate);
      return;
    }
  }
}

let db: Database | null = null;
let initialized = false;
let sqliteVecModule: typeof import("sqlite-vec") | null = null;

async function loadSqliteVec() {
  if (!sqliteVecModule) {
    sqliteVecModule = await import("sqlite-vec");
  }
  return sqliteVecModule;
}

async function getDb() {
  if (db) return db;
  trySetCustomSQLite();
  db = new Database("data/transcript-rag.db");
  return db;
}

export async function initDb() {
  if (initialized && db) return db;

  const database = await getDb();

  try {
    const sqliteVec = await loadSqliteVec();
    sqliteVec.load(database);
  } catch (error) {
    console.error("Failed to load sqlite-vec extension:", error);
    throw error;
  }

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  const versionRow = database.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion !== SCHEMA_VERSION) {
    database.exec(`
      DROP TABLE IF EXISTS chunks_fts;
      DROP TABLE IF EXISTS vec_chunks;
      DROP TABLE IF EXISTS chunks;
      DROP TABLE IF EXISTS processed_files;
    `);

    database.exec(`
      CREATE TABLE processed_files (
        id INTEGER PRIMARY KEY,
        filename TEXT UNIQUE,
        processed_at TEXT,
        mtime INTEGER,
        size INTEGER
      );

      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY,
        lesson_name TEXT,
        chunk_index INTEGER,
        start_time TEXT,
        end_time TEXT,
        start_seconds REAL,
        end_seconds REAL,
        text TEXT
      );

      CREATE VIRTUAL TABLE vec_chunks USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding float[${EMBEDDING_DIMENSIONS}]
      );

      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        chunk_id UNINDEXED,
        lesson_name,
        text
      );
    `);

    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  initialized = true;
  return database;
}

function ensureDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function getProcessedInfo(
  filename: string,
): { mtime: number; size: number } | null {
  const database = ensureDb();
  const row = database
    .prepare(
      "SELECT mtime, size FROM processed_files WHERE filename = ? LIMIT 1",
    )
    .get(filename) as { mtime: number; size: number } | undefined;
  if (!row) return null;
  return { mtime: Number(row.mtime), size: Number(row.size) };
}

export function recordProcessed(filename: string, mtime: number, size: number) {
  const database = ensureDb();
  database
    .prepare(
      "INSERT OR REPLACE INTO processed_files (filename, processed_at, mtime, size) VALUES (?, ?, ?, ?)",
    )
    .run(filename, new Date().toISOString(), mtime, size);
}

export function deleteByLesson(lessonName: string) {
  const database = ensureDb();
  const ids = database
    .prepare("SELECT id FROM chunks WHERE lesson_name = ?")
    .all(lessonName) as { id: number }[];

  const chunkIds = ids.map((row) => row.id);

  if (chunkIds.length > 0) {
    const placeholders = chunkIds.map(() => "?").join(",");
    database
      .prepare(`DELETE FROM vec_chunks WHERE chunk_id IN (${placeholders})`)
      .run(...chunkIds);
  }

  database.prepare("DELETE FROM chunks WHERE lesson_name = ?").run(lessonName);
  database
    .prepare("DELETE FROM chunks_fts WHERE lesson_name = ?")
    .run(lessonName);
  database
    .prepare("DELETE FROM processed_files WHERE filename = ?")
    .run(lessonName);
}

export function insertChunk(chunk: ChunkRecord): number {
  const database = ensureDb();
  const stmt = database.prepare(
    `INSERT INTO chunks (
      lesson_name,
      chunk_index,
      start_time,
      end_time,
      start_seconds,
      end_seconds,
      text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const result = stmt.run(
    chunk.lessonName,
    chunk.chunkIndex,
    chunk.startTime,
    chunk.endTime,
    chunk.startSeconds,
    chunk.endSeconds,
    chunk.text,
  );
  const chunkId = Number(result.lastInsertRowid);
  database
    .prepare(
      "INSERT INTO chunks_fts (chunk_id, lesson_name, text) VALUES (?, ?, ?)",
    )
    .run(chunkId, chunk.lessonName, chunk.text);
  return chunkId;
}

export function insertEmbedding(chunkId: number, embedding: number[]) {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding length ${embedding.length} does not match expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  const buffer = Buffer.from(Float32Array.from(embedding).buffer);
  const database = ensureDb();
  database
    .prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)")
    .run(chunkId, buffer);
}

export function queryVectorSimilar(
  embedding: number[],
  limit: number,
  lessonNames?: string[],
): RetrievedChunk[] {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding length ${embedding.length} does not match expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  const buffer = Buffer.from(Float32Array.from(embedding).buffer);
  const database = ensureDb();

  if (lessonNames && lessonNames.length > 0) {
    const candidateLimit = limit * 10;
    const placeholders = lessonNames.map(() => "?").join(",");
    const rows = database
      .prepare(
        `
        SELECT
          c.id as id,
          c.lesson_name as lessonName,
          c.chunk_index as chunkIndex,
          c.start_time as startTime,
          c.end_time as endTime,
          c.start_seconds as startSeconds,
          c.end_seconds as endSeconds,
          c.text as text,
          distance
        FROM vec_chunks
        JOIN chunks c ON c.id = vec_chunks.chunk_id
        WHERE embedding MATCH ?
          AND k = ?
          AND c.lesson_name IN (${placeholders})
        ORDER BY distance
        LIMIT ?
      `,
      )
      .all(buffer, candidateLimit, ...lessonNames, limit) as RetrievedChunk[];
    return rows;
  }

  const rows = database
    .prepare(
      `
      SELECT
        c.id as id,
        c.lesson_name as lessonName,
        c.chunk_index as chunkIndex,
        c.start_time as startTime,
        c.end_time as endTime,
        c.start_seconds as startSeconds,
        c.end_seconds as endSeconds,
        c.text as text,
        distance
      FROM vec_chunks
      JOIN chunks c ON c.id = vec_chunks.chunk_id
      WHERE embedding MATCH ?
        AND k = ?
      ORDER BY distance
      LIMIT ?
    `,
    )
    .all(buffer, limit, limit) as RetrievedChunk[];

  return rows;
}

export function queryBm25(
  query: string,
  limit: number,
  lessonNames?: string[],
): RetrievedChunk[] {
  const database = ensureDb();
  const cleaned = query.replace(/[^A-Za-z0-9_]+/g, " ").trim();
  if (!cleaned) return [];

  if (lessonNames && lessonNames.length > 0) {
    const placeholders = lessonNames.map(() => "?").join(",");
    const rows = database
      .prepare(
        `
        SELECT
          c.id as id,
          c.lesson_name as lessonName,
          c.chunk_index as chunkIndex,
          c.start_time as startTime,
          c.end_time as endTime,
          c.start_seconds as startSeconds,
          c.end_seconds as endSeconds,
          c.text as text,
          bm25(chunks_fts) as bm25
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.chunk_id
        WHERE chunks_fts MATCH ?
          AND c.lesson_name IN (${placeholders})
        ORDER BY bm25
        LIMIT ?
      `,
      )
      .all(cleaned, ...lessonNames, limit) as RetrievedChunk[];
    return rows;
  }

  const rows = database
    .prepare(
      `
      SELECT
        c.id as id,
        c.lesson_name as lessonName,
        c.chunk_index as chunkIndex,
        c.start_time as startTime,
        c.end_time as endTime,
        c.start_seconds as startSeconds,
        c.end_seconds as endSeconds,
        c.text as text,
        bm25(chunks_fts) as bm25
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.chunk_id
      WHERE chunks_fts MATCH ?
      ORDER BY bm25
      LIMIT ?
    `,
    )
    .all(cleaned, limit) as RetrievedChunk[];
  return rows;
}

export function getChunksByLessonAndIndexes(
  lessonName: string,
  indexes: number[],
): RetrievedChunk[] {
  const database = ensureDb();
  if (indexes.length === 0) return [];
  const placeholders = indexes.map(() => "?").join(",");
  const rows = database
    .prepare(
      `
      SELECT
        id as id,
        lesson_name as lessonName,
        chunk_index as chunkIndex,
        start_time as startTime,
        end_time as endTime,
        start_seconds as startSeconds,
        end_seconds as endSeconds,
        text as text
      FROM chunks
      WHERE lesson_name = ?
        AND chunk_index IN (${placeholders})
      ORDER BY chunk_index
    `,
    )
    .all(lessonName, ...indexes) as RetrievedChunk[];
  return rows;
}

export function getAvailableLessons(): string[] {
  const database = ensureDb();
  const rows = database
    .prepare("SELECT DISTINCT lesson_name FROM chunks ORDER BY lesson_name")
    .all() as { lesson_name: string }[];
  return rows.map((r) => r.lesson_name);
}
