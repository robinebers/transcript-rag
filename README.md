# Transcript RAG CLI

A minimal RAG CLI for querying .srt video transcripts.

## Setup

1. `bun install`
2. Copy `.env.example` to `.env` and add your API key
3. Place `.srt` files in `transcripts/` directory
4. Run `bun index.ts --ingest` to process transcripts
5. Run `bun index.ts --ask "your question"` to query

## Documentation

See [CLAUDE.md](./CLAUDE.md) for full command reference and usage instructions.
