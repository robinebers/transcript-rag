# BlackBelt - RAG CLI for Video Transcripts

A CLI tool that processes .srt video transcripts and answers questions using RAG.

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
bun index.ts --ask "?" --lessons "LaunchpadMarket"           # Filter to one lesson
bun index.ts --ask "?" --lessons "LaunchpadKickoff,Market"   # Filter to multiple
```

## Setup

1. `bun install`
2. Set `AI_GATEWAY_API_KEY` environment variable
3. Place .srt files in `transcripts/` directory (or custom path)
