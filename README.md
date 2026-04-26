# Rumi

Real-time collaborative workspace for developers.

See [`docs/SPEC.md`](docs/SPEC.md) for the full system specification.

## Quickstart

```bash
bun install
bun run db:up           # start local Postgres in Docker
bun run dev:server      # http://localhost:3001
bun run dev:web         # http://localhost:5173
```

## Layout

```
apps/web         # Vite + React client
apps/server      # Bun + Fastify + Hocuspocus server
packages/protocol  # Shared types and Zod schemas
docs/            # SPEC.md, designs/, plans/
```
