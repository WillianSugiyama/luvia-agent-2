# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Start development server (Mastra dev with hot reload)
npm run dev

# Build for production
npm run build

# Run production server
npm start

# Run Express chat server directly (dev mode)
bun src/server.ts
# or
npm run dev:chat

# Run client tests
bun scripts/run-client-tests.ts
```

## Environment Setup

Copy `.env.example` to `.env` and configure:
- `SUPABASE_URL` / `SUPABASE_KEY` - Product rules and customer data
- `OPENAI_API_KEY` - LLM and embeddings
- `COHERE_API_KEY` - Reranking
- `QDRANT_URL` / `QDRANT_API_KEY` - Sales framework vectors

## Architecture Overview

This is a **Mastra-based AI agent system** for sales and customer support automation in Portuguese.

### Core Flow

The main entry point is `luviaWorkflow` which orchestrates:

1. **Security Layer** - Sanitizes user input
2. **Intent Interpretation** - Determines user intent and normalizes queries
3. **Product Search** - Finds relevant products with ambiguity detection
4. **Context Management** - Maintains conversation state per user
5. **Context Enrichment** - Fetches product rules (Supabase) and sales strategies (Qdrant)
6. **Agent Routing** - Routes to appropriate agent based on intent and customer status
7. **Output Validation** - Ensures required checkout links are present

### Agents (src/mastra/agents/)

- **salesAgent** - Sales persuasion with dynamic instructions from enriched context
- **supportAgent** - Customer support using business rules
- **clarificationAgent** - Asks for clarification when product is ambiguous
- **docsAgent** - RAG-powered responses from knowledge base

Agents receive enriched context (product, price, rules, sales strategy) via `runtimeContext`.

### Tools (src/mastra/tools/)

Tools are steps called within the workflow:
- `security-tool` - Input sanitization
- `interpret-message-tool` - Intent classification
- `advanced-product-search-tool` - Product matching with confidence scoring
- `manage-conversation-context-tool` - State persistence
- `get-enriched-context-tool` - Combines Supabase rules + Qdrant strategies
- `search-knowledge-tool` - RAG retrieval

### Data Sources

- **Supabase** - Product rules, customer status, business logic
- **Qdrant** - Sales framework embeddings for strategy retrieval
- **Cohere** - Reranking search results

### API Endpoint

`POST /api/chat` accepts:
```json
{
  "team_id": "string (required)",
  "message": "string (required)",
  "phone": "string (optional)",
  "email": "string (optional)",
  "user_confirmation": "boolean (optional)"
}
```

Returns workflow result with `workflow_run_id` and agent response.

## Coding Conventions

- TypeScript with ESM modules, Node >=20.9.0
- 2-space indentation, single quotes
- PascalCase for classes/agents/workflows, camelCase for functions/variables
- Kebab-case filenames matching main export
- Test files: `*.test.ts` colocated with source

## Commit Style

Use Conventional Commits: `feat:`, `fix:`, `chore:`
