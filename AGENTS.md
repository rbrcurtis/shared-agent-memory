# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript MCP server and REST API backed by Qdrant.

- `src/index.ts` is the MCP entrypoint and transcript ingest CLI.
- `src/api/` contains the Fastify REST API, routes, middleware, and schemas.
- `src/ingest/` contains Claude Code transcript ingestion.
- `src/*.ts` holds core storage, embeddings, retention, client, entity, and secret-filter logic.
- `src/**/*.test.ts` and `tests/**/*.test.ts` are Vitest tests; `tests/ingest-cases/` stores JSON fixtures.
- `web/` is the static memory browser.
- `scripts/`, `bin/`, `Dockerfile`, and `k8s/` cover setup, utilities, and deployment.

## Build, Test, and Development Commands

- `npm run build` - compile TypeScript to `dist/`.
- `npm run dev` - run `tsc --watch`.
- `npm test` - run the full Vitest suite once.
- `npm run test:watch` - run watch mode.
- `npm run lint` - lint `src/` with ESLint.
- `npm run format` - format `src/` with Prettier.
- `npm start` - run the built MCP server.
- `npm run start:api` - run the built API server.

For local API work, set `QDRANT_URL` and `API_KEYS`.

## Coding Style & Naming Conventions

Use TypeScript ES modules with strict checking (`NodeNext`, `ES2022`). Prefer direct code and early returns. Keep filenames descriptive and kebab-case where established, such as `secret-filter.ts` and `backfill-titles.ts`. Test files should sit beside source as `*.test.ts` or under `tests/`.

ESLint allows unused parameters only when prefixed with `_`. Prettier is the formatting authority for `src/`.

## Testing Guidelines

Vitest runs in Node and includes `src/**/*.test.ts` plus `tests/**/*.test.ts`. Add focused tests for storage, API routes, secret filtering, ingest extraction, and retention logic when changing those areas. Fixture-driven ingest tests should add cases under `tests/ingest-cases/`.

Run `npm test` before submitting changes. Use `npm run build` when public types, API routes, or CLI behavior change.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects, sometimes with conventional prefixes: `fix: reject empty text/title`, `feat: add Dockerfile`, `Add TypeScript transcript ingestion`. Keep commits scoped.

Pull requests should include a concise summary, tests run, linked issue or context, and screenshots only for `web/` UI changes. Call out configuration, environment variable, Docker, or Kubernetes changes explicitly.

## Security & Configuration Tips

Never commit API keys, Qdrant credentials, bearer tokens, or transcript data containing secrets. The API requires `QDRANT_URL`; authenticated routes require `API_KEYS`. MCP clients use `MEMORY_API_URL`, `MEMORY_API_KEY`, `DEFAULT_AGENT`, and optionally `DEFAULT_PROJECT`.
