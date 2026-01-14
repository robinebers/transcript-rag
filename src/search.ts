import { generateText } from "ai";
import { embedText } from "./embed";
import { initDb, querySimilar, RetrievedChunk } from "./db";

type AnswerOptions = {
  question: string;
  transcriptsDir: string;
  topK: number;
  lessons?: string[];
};

function buildPrompt(question: string, chunks: RetrievedChunk[]): string {
  const context = chunks
    .map(
      (chunk, idx) =>
        `[${idx + 1}] Lesson: ${chunk.lessonName} (${chunk.startTime} - ${chunk.endTime})\n${chunk.text}`
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
      `[${idx + 1}] ${chunk.lessonName} (${chunk.startTime}-${chunk.endTime}) :: ${preview}`
    );
  });
}

export async function answerQuestion(options: AnswerOptions) {
  await initDb();

  const queryEmbedding = await embedText(options.question, "query");
  const matches = querySimilar(queryEmbedding, options.topK, options.lessons);

  if (matches.length === 0) {
    console.log("No matches found.");
    return;
  }

  const prompt = buildPrompt(options.question, matches);

  const { text } = await generateText({
    model: "google/gemini-3-flash",
    prompt,
  });

  console.log("Answer:");
  console.log(text.trim());
  printSources(matches);
}
