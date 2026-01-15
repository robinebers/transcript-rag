import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

export type ChunkRecord = {
  lessonName: string;
  startTime: string;
  endTime: string;
  text: string;
};

export type RetrievedChunk = ChunkRecord & {
  id: number;
  distance: number;
};

export const EMBEDDING_DIMENSIONS = 1024;

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

    CREATE TABLE IF NOT EXISTS processed_files (
      id INTEGER PRIMARY KEY,
      filename TEXT UNIQUE,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      lesson_name TEXT,
      start_time TEXT,
      end_time TEXT,
      text TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${EMBEDDING_DIMENSIONS}]
    );
  `);

  initialized = true;
  return database;
}

function ensureDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function isProcessed(filename: string): boolean {
  const database = ensureDb();
  const row = database
    .prepare("SELECT 1 FROM processed_files WHERE filename = ? LIMIT 1")
    .get(filename) as { 1: number } | undefined;
  return Boolean(row);
}

export function recordProcessed(filename: string) {
  const database = ensureDb();
  database.prepare(
    "INSERT OR REPLACE INTO processed_files (filename, processed_at) VALUES (?, ?)"
  ).run(filename, new Date().toISOString());
}

export function deleteByLesson(lessonName: string) {
  const database = ensureDb();
  const ids = database
    .prepare("SELECT id FROM chunks WHERE lesson_name = ?")
    .all(lessonName) as { id: number }[];

  const chunkIds = ids.map((row) => row.id);

  if (chunkIds.length > 0) {
    const placeholders = chunkIds.map(() => "?").join(",");
    database.prepare(
      `DELETE FROM vec_chunks WHERE chunk_id IN (${placeholders})`
    ).run(...chunkIds);
  }

  database.prepare("DELETE FROM chunks WHERE lesson_name = ?").run(lessonName);
  database.prepare("DELETE FROM processed_files WHERE filename = ?").run(lessonName);
}

export function insertChunk(chunk: ChunkRecord): number {
  const database = ensureDb();
  const stmt = database.prepare(
    "INSERT INTO chunks (lesson_name, start_time, end_time, text) VALUES (?, ?, ?, ?)"
  );
  const result = stmt.run(
    chunk.lessonName,
    chunk.startTime,
    chunk.endTime,
    chunk.text
  );
  return Number(result.lastInsertRowid);
}

export function insertEmbedding(chunkId: number, embedding: number[]) {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding length ${embedding.length} does not match expected ${EMBEDDING_DIMENSIONS}`
    );
  }

  const buffer = Buffer.from(Float32Array.from(embedding).buffer);
  const database = ensureDb();
  database.prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)")
    .run(chunkId, buffer);
}

export function querySimilar(
  embedding: number[],
  limit: number,
  lessonNames?: string[]
): RetrievedChunk[] {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding length ${embedding.length} does not match expected ${EMBEDDING_DIMENSIONS}`
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
          c.start_time as startTime,
          c.end_time as endTime,
          c.text as text,
          distance
        FROM vec_chunks
        JOIN chunks c ON c.id = vec_chunks.chunk_id
        WHERE embedding MATCH ?
          AND k = ?
          AND c.lesson_name IN (${placeholders})
        ORDER BY distance
        LIMIT ?
      `
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
        c.start_time as startTime,
        c.end_time as endTime,
        c.text as text,
        distance
      FROM vec_chunks
      JOIN chunks c ON c.id = vec_chunks.chunk_id
      WHERE embedding MATCH ?
        AND k = ?
      ORDER BY distance
    `
    )
    .all(buffer, limit) as RetrievedChunk[];

  return rows;
}

export function getAvailableLessons(): string[] {
  const database = ensureDb();
  const rows = database
    .prepare("SELECT DISTINCT lesson_name FROM chunks ORDER BY lesson_name")
    .all() as { lesson_name: string }[];
  return rows.map((r) => r.lesson_name);
}
