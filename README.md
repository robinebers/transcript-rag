# Transcript RAG CLI

A minimal RAG CLI for querying .srt video transcripts. Built for AI coding agents like Claude Code, Codex, OpenCode, and Droid—no UI, just fast answers from your transcripts via the command line.

## Setup

1. `bun install`
2. Copy `.env.example` to `.env` and add your `AI_GATEWAY_API_KEY`
3. Place `.srt` files in `transcripts/` directory

## Commands

### Ingest Transcripts

```bash
bun index.ts --ingest                    # Ingest new transcripts
bun index.ts --ingest --force            # Re-ingest all
bun index.ts --ingest --transcripts-dir <path>
```

Notes:
- Ingest automatically skips unchanged files based on mtime + size.
- If the database schema changes, existing data is cleared and you must re-ingest.

### List Available Lessons

```bash
bun index.ts --list-lessons              # Show all ingested lessons
```

### Ask Questions

```bash
bun index.ts --ask "your question"       # Query transcripts
bun index.ts --ask "?" --top-k 10        # Retrieve 10 chunks (default 25)
bun index.ts --ask "?" --transcripts-dir <path>
bun index.ts --ask "?" --lessons "lesson-name"               # Filter to one lesson
bun index.ts --ask "?" --lessons "lesson-1,lesson-2"         # Filter to multiple
```

RAG details (built-in, no flags needed):
- Chunking: ~45s windows with 10s overlap.
- Normalization: trims cues like “[music]”, removes speaker prefixes, de-dups consecutive lines.
- Retrieval: hybrid (vector + BM25) with rerank, then neighbor expansion (±1 chunk).
