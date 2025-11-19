# Repository Guidelines

## Project Structure & Module Organization
- Application code lives in `src/mastra`. Group related logic under:
  - `agents/` – agent entrypoints (e.g., `weather-agent.ts`).
  - `tools/` – callable tools used by agents.
  - `workflows/` – orchestration and multi-step flows.
  - `scorers/` – evaluation, ranking, and scoring logic.
- Product docs and higher-level configuration live in `agent-os/` (see `agent-os/config.yml` and `agent-os/product/*`).
- Environment-specific settings go in `.env` (not committed).

## Build, Test, and Development Commands
- `npm run dev` – start the Mastra dev server with hot reload.
- `npm run build` – build the production bundle using TypeScript and Mastra.
- `npm start` – run the built agent in production mode.
- `npm test` – currently a placeholder; update once a test runner is added.

## Coding Style & Naming Conventions
- Use TypeScript with Node `>=20.9.0` and ESM imports.
- Prefer 2-space indentation, single quotes, and explicit return types on exported functions.
- Use `PascalCase` for classes, agents, and workflows (`WeatherAgent`), and `camelCase` for variables and functions (`fetchWeatherData`).
- Name files with kebab-case matching their main export (e.g., `weather-workflow.ts`).

## Testing Guidelines
- When adding tests, use a modern Node test runner (e.g., Jest or Vitest) and colocate tests next to sources: `src/mastra/agents/__tests__/weather-agent.test.ts`.
- Name test files `*.test.ts` and keep tests small, focused, and deterministic.
- Aim for unit tests around tools, workflows, and scorers before adding end‑to‑end coverage.

## Commit & Pull Request Guidelines
- Use Conventional Commits style where possible: `feat: add weather workflow`, `fix: handle missing location`, `chore: update deps`.
- Keep commit messages in the imperative and scoped to one logical change.
- Pull requests should describe the motivation, key changes, and any config or migration steps; include logs or example prompts/responses when behavior changes.

## Security & Configuration Tips
- Never commit secrets; load API keys and credentials from `.env` or your runtime environment.
- Avoid logging full request/response payloads containing user data; prefer redacted logs via the configured logger.

