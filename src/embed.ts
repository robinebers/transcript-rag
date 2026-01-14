import { embedMany, embed } from "ai";

const EMBEDDING_MODEL = "voyage/voyage-3-large";

type InputType = "document" | "query";

export async function embedTexts(
  values: string[],
  inputType: InputType = "document"
): Promise<number[][]> {
  if (values.length === 0) return [];

  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values,
    providerOptions: {
      voyage: {
        inputType,
      },
    },
  });

  return embeddings;
}

export async function embedText(
  value: string,
  inputType: InputType = "document"
): Promise<number[]> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value,
    providerOptions: {
      voyage: {
        inputType,
      },
    },
  });

  return embedding;
}
