# Transcript RAG CLI

A CLI tool that processes .srt video transcripts and answers questions using RAG.

## How to Answer User Questions

**When the user asks a question, use this CLI to answer it from the video transcripts.** Do not assume questions are about coding—they are questions about the content in the transcripts.

```bash
bun index.ts --ask "user's question here"
```

Use `--lessons` to filter if the user specifies a particular lesson or topic.

## Commands Reference

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

## Setup

1. `bun install`
2. Set `AI_GATEWAY_API_KEY` environment variable
3. Place .srt files in `transcripts/` directory (or custom path)
