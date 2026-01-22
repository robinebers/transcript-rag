# V2 Update Specs (Opinionated)

## Chunk aggregation + overlap
- Ingest groups consecutive SRT entries into ~45s windows with 10s overlap.
- Chunk text is the concatenation of included lines; start/end times from first/last entry.
- Store `chunk_index` (0-based per lesson) to preserve order.
- Drop chunks that are empty after normalization.

## Text normalization + de-dup
- Normalize whitespace (collapse multiple spaces, trim).
- Strip bracketed cues like `[music]`, `[applause]`.
- Strip leading speaker markers like `>>` or `Speaker:`.
- Remove consecutive duplicate lines within a lesson before aggregation.
- Skip lines that become empty after cleaning.

## Hybrid retrieval
- Maintain an FTS5 table over chunk text.
- At query time: retrieve top 50 vector hits + top 50 BM25 hits.
- Combine with reciprocal rank fusion (RRF) and take top-K (existing `--top-k`).

## Rerank
- Rerank top 30 candidates using the existing text model.
- Model scores each chunk for relevance to the question (0–5); keep top-K.
- If rerank fails, fall back to pre-rerank order.

## Neighbor expansion
- After final top-K, include adjacent chunks by `chunk_index` (±1) within the same lesson.
- Deduplicate by chunk id and keep context ordered by `chunk_index`.

## File change detection
- Store fingerprint per lesson: `mtime` + `size`.
- On ingest, if fingerprint changed, delete and re-ingest that lesson automatically.
- `--force` still re-ingests everything.

## Lesson filter + fuzzy match
- When `--lessons` contains unknown names, show “Did you mean” suggestions (top 5 fuzzy matches).
- Do not auto-correct; require explicit user input.
- If any lessons are invalid, exit before running the query.
