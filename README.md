# Transcript RAG CLI

A minimal RAG CLI for querying .srt video transcripts.

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

### List Available Lessons

```bash
bun index.ts --list-lessons              # Show all ingested lessons
```

### Ask Questions

```bash
bun index.ts --ask "your question"       # Query transcripts
bun index.ts --ask "?" --top-k 10        # Retrieve 10 chunks
bun index.ts --ask "?" --transcripts-dir <path>
bun index.ts --ask "?" --lessons "lesson-name"               # Filter to one lesson
bun index.ts --ask "?" --lessons "lesson-1,lesson-2"         # Filter to multiple
```
