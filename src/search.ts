import { generateText } from "ai";
import { embedText } from "./embed";
import {
  getChunksByLessonAndIndexes,
  initDb,
  queryBm25,
  queryVectorSimilar,
  RetrievedChunk,
} from "./db";

type AnswerOptions = {
  question: string;
  transcriptsDir: string;
  topK: number;
  lessons?: string[];
};

const VECTOR_RETRIEVAL_LIMIT = 50;
const BM25_RETRIEVAL_LIMIT = 50;
const RERANK_LIMIT = 30;
const RRF_K = 60;
const NEIGHBOR_WINDOW = 1;

function buildPrompt(question: string, chunks: RetrievedChunk[]): string {
  const context = chunks
    .map(
      (chunk, idx) =>
        `[${idx + 1}] Lesson: ${chunk.lessonName} (${chunk.startTime} - ${chunk.endTime})\n${chunk.text}`,
    )
    .join("\n\n");

  return `
You are answering from transcript excerpts only.

Question:
${question}

Context (use these and nothing else):
${context}

Answer requirements:
- Be concise and specific.
- Quote or paraphrase only from the context.
- Always cite sources as [index] with lesson name and timestamp (e.g., [2] Lesson (hh:mm:ss-hh:mm:ss)).
- If the answer is not in the context, say you don't know.
`;
}

function printSources(chunks: RetrievedChunk[]) {
  console.log("\nSources:");
  chunks.forEach((chunk, idx) => {
    const preview =
      chunk.text.length > 140 ? `${chunk.text.slice(0, 140)}...` : chunk.text;
    console.log(
      `[${idx + 1}] ${chunk.lessonName} (${chunk.startTime}-${chunk.endTime}) :: ${preview}`,
    );
  });
}

function rrfCombine(
  vectorMatches: RetrievedChunk[],
  bm25Matches: RetrievedChunk[],
): RetrievedChunk[] {
  const scores = new Map<number, { score: number; chunk: RetrievedChunk }>();

  const addList = (list: RetrievedChunk[]) => {
    list.forEach((chunk, index) => {
      const rank = index + 1;
      const rrfScore = 1 / (RRF_K + rank);
      const existing = scores.get(chunk.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(chunk.id, { score: rrfScore, chunk });
      }
    });
  };

  addList(vectorMatches);
  addList(bm25Matches);

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.chunk);
}

async function rerankChunks(
  question: string,
  chunks: RetrievedChunk[],
): Promise<RetrievedChunk[]> {
  if (chunks.length === 0) return chunks;

  const prompt = `
You are a ranking model. Score each chunk for relevance to the question.
Return a JSON array of numbers (0 to 5) in the same order as the chunks.

Question:
${question}

Chunks:
${chunks
  .map(
    (chunk, idx) =>
      `[${idx + 1}] ${chunk.lessonName} (${chunk.startTime}-${chunk.endTime})\n${chunk.text}`,
  )
  .join("\n\n")}
`;

  try {
    const { text } = await generateText({
      model: "google/gemini-3-flash",
      prompt,
    });

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return chunks;

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return chunks;

    const scores = parsed.map((value) =>
      Number.isFinite(Number(value)) ? Number(value) : 0,
    );

    if (scores.length < chunks.length) return chunks;

    const scored = chunks.map((chunk, idx) => ({
      chunk,
      score: scores[idx] ?? 0,
      order: idx,
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.order - b.order;
    });

    return scored.map((entry) => entry.chunk);
  } catch {
    return chunks;
  }
}

function uniqueById(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<number>();
  const result: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    result.push(chunk);
  }
  return result;
}

function sortByLessonAndIndex(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return [...chunks].sort((a, b) => {
    if (a.lessonName !== b.lessonName) {
      return a.lessonName.localeCompare(b.lessonName);
    }
    return a.chunkIndex - b.chunkIndex;
  });
}

function collectNeighborIndexes(chunks: RetrievedChunk[], window: number) {
  const map = new Map<string, Set<number>>();
  for (const chunk of chunks) {
    if (!map.has(chunk.lessonName)) {
      map.set(chunk.lessonName, new Set<number>());
    }
    const set = map.get(chunk.lessonName)!;
    for (let offset = -window; offset <= window; offset += 1) {
      if (offset === 0) continue;
      const index = chunk.chunkIndex + offset;
      if (index >= 0) set.add(index);
    }
  }
  return map;
}

function expandNeighbors(
  chunks: RetrievedChunk[],
  window: number,
): RetrievedChunk[] {
  if (window <= 0 || chunks.length === 0) return chunks;

  const neighborMap = collectNeighborIndexes(chunks, window);
  const neighbors: RetrievedChunk[] = [];

  for (const [lessonName, indexes] of neighborMap.entries()) {
    const fetched = getChunksByLessonAndIndexes(
      lessonName,
      Array.from(indexes),
    );
    neighbors.push(...fetched);
  }

  const combined = uniqueById([...chunks, ...neighbors]);
  return sortByLessonAndIndex(combined);
}

export async function answerQuestion(options: AnswerOptions) {
  await initDb();

  const queryEmbedding = await embedText(options.question, "query");
  const vectorMatches = queryVectorSimilar(
    queryEmbedding,
    VECTOR_RETRIEVAL_LIMIT,
    options.lessons,
  );
  const bm25Matches = queryBm25(
    options.question,
    BM25_RETRIEVAL_LIMIT,
    options.lessons,
  );
  const combined = rrfCombine(vectorMatches, bm25Matches);

  if (combined.length === 0) {
    console.log("No matches found.");
    return;
  }

  const candidates = combined.slice(0, RERANK_LIMIT);
  const reranked = await rerankChunks(options.question, candidates);
  const topK = reranked.slice(0, options.topK);
  const expanded = expandNeighbors(topK, NEIGHBOR_WINDOW);
  const prompt = buildPrompt(options.question, expanded);

  const { text } = await generateText({
    model: "google/gemini-3-flash",
    prompt,
  });

  console.log("Answer:");
  console.log(text.trim());
  printSources(expanded);
}
