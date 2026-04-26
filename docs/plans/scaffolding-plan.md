# Scaffolding Plan

> **Goal:** Stand up the Rumi monorepo with `apps/web`, `apps/server`, `packages/protocol`, install all dependencies decided in SPEC.md, configure shared tooling (Biome, base tsconfig, Bun workspaces), and verify both apps boot. No feature code.
> **Spec:** `docs/SPEC.md`

## Phase 1: Workspace root

**Gate:** Root `package.json`, workspace config, shared tsconfig, Biome config, and `.gitignore` exist and are coherent before any workspace tries to install or extend them.

### Task 1.1: Initialize repo root

- **What:** Create root-level config files: `package.json` (workspace root), `tsconfig.base.json`, `biome.json`, `.gitignore`, `.env.example`, `README.md`, `.editorconfig`.
- **Why:** Every other workspace extends or relies on these. They have to land first.
- **How:**
  - `package.json` at `/Users/justincordova/cs/projects/rumi/package.json`:
    - `"name": "rumi"`, `"private": true`, `"type": "module"`
    - `"workspaces": ["apps/*", "packages/*"]`
    - `"packageManager": "bun@1.1.43"`
    - Scripts:
      - `"dev:web": "bun run --filter '@rumi/web' dev"`
      - `"dev:server": "bun run --filter '@rumi/server' dev"`
      - `"build": "bun run --filter '*' build"`
      - `"check": "biome check ."`
      - `"format": "biome format --write ."`
      - `"typecheck": "tsc -b"`
      - `"test": "bun test"`
    - devDependencies: `typescript@^5.6.0`, `@biomejs/biome@^1.9.0`, `@types/bun@latest`
  - `tsconfig.base.json`:
    - `compilerOptions`: `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `esModuleInterop: true`, `skipLibCheck: true`, `resolveJsonModule: true`, `isolatedModules: true`, `verbatimModuleSyntax: true`, `forceConsistentCasingInFileNames: true`
    - No `paths` here — each workspace defines its own `@/*` alias
  - `biome.json`:
    - `"$schema": "https://biomejs.dev/schemas/1.9.0/schema.json"`
    - `formatter`: 2-space indent, double quotes
    - `linter`: enable `recommended`, plus `style.useImportType` and `correctness.noUnusedVariables` as errors
    - `files.ignore`: `["**/dist", "**/node_modules", "**/.next", "**/migrations"]`
  - `.gitignore`:
    - `node_modules`, `dist`, `.env`, `.env.local`, `.DS_Store`, `*.log`, `.turbo`, `.vercel`, `.fly`, `bun.lockb` is **kept** (committed; standard for Bun)
  - `.env.example`: include `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` placeholders. Empty values, comments explaining.
  - `README.md`: minimal — project title, one-sentence vision, "see `docs/SPEC.md`", quickstart commands.
  - `.editorconfig`: 2-space indent, LF line endings, UTF-8, trim trailing whitespace, insert final newline.
- **Verify:**
  - `cat package.json` shows `"workspaces": ["apps/*", "packages/*"]`.
  - `bun pm ls` (after Task 1.2) won't error with "no workspace config".

### Task 1.2: Create empty workspace skeleton

- **What:** Create the directory tree with `.gitkeep` files in every empty directory so the structure is committable. No `package.json` in workspaces yet — those land in Phase 2.
- **Why:** Establishes the file layout exactly as SPEC.md describes. Tasks in Phase 2 fill in workspace contents.
- **How:**
  - Directories to create (using `mkdir -p`):
    ```
    apps/web/src/routes
    apps/web/src/lib
    apps/web/src/styles
    apps/server/src/lib
    apps/server/src/db/migrations
    apps/server/src/auth
    apps/server/src/rooms
    apps/server/src/sync
    apps/server/src/presence
    apps/server/src/persistence
    packages/protocol/src
    docs/designs
    docs/plans
    ```
  - Place a `.gitkeep` (empty file) in every directory that won't have a real file by end of Phase 3:
    - `apps/server/src/db/migrations/.gitkeep`
    - `apps/server/src/rooms/.gitkeep`
    - `apps/server/src/sync/.gitkeep`
    - `apps/server/src/presence/.gitkeep`
    - `apps/server/src/persistence/.gitkeep`
    - `docs/designs/.gitkeep`
    - All other directories will end up with real files (`package.json`, `index.ts`, etc.) so they don't need `.gitkeep`.
- **Verify:**
  - `find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*'` lists every directory above.
  - `find apps/server/src -name .gitkeep` lists the five empty server module dirs.

## Phase 2: Workspace package definitions

**Gate:** All three workspaces have valid `package.json` and `tsconfig.json` files before `bun install` is run, so the install resolves the dependency graph correctly in one pass.

### Task 2.1: Create `packages/protocol`

- **What:** Define the shared protocol package as a workspace.
- **Why:** Both `apps/web` and `apps/server` will list it as a dependency. Must exist before they can.
- **How:**
  - `packages/protocol/package.json`:
    - `"name": "@rumi/protocol"`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`
    - `"main": "./src/index.ts"`, `"types": "./src/index.ts"` (Bun + TS bundler resolution can consume `.ts` directly — no build step needed for a shared package consumed by Bun and Vite)
    - `"exports": { ".": "./src/index.ts" }`
    - dependencies: `"zod": "^3.23.0"`
  - `packages/protocol/tsconfig.json`:
    - `"extends": "../../tsconfig.base.json"`
    - `"compilerOptions": { "outDir": "dist", "rootDir": "src", "noEmit": true }`
    - `"include": ["src/**/*"]`
  - `packages/protocol/src/index.ts`:
    - Single placeholder export so the package isn't empty:
      ```ts
      export const PROTOCOL_VERSION = "0.0.0";
      ```
- **Verify:** File exists and parses; `bun --print 'require("@rumi/protocol")'` will work after Phase 3 install.

### Task 2.2: Create `apps/server` package

- **What:** Define the Bun + Fastify + Hocuspocus server workspace.
- **Why:** Independent of `apps/web`; can be defined in parallel with Task 2.3 but listed first because the spec leads with backend.
- **How:**
  - `apps/server/package.json`:
    - `"name": "@rumi/server"`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`
    - Scripts:
      - `"dev": "bun --watch src/server.ts"`
      - `"start": "bun src/server.ts"`
      - `"build": "bun build ./src/server.ts --target bun --outdir dist"`
      - `"typecheck": "tsc -b"`
      - `"test": "bun test"`
      - `"db:generate": "drizzle-kit generate"`
      - `"db:migrate": "drizzle-kit migrate"`
    - dependencies (exact names from SPEC.md):
      - `fastify` (^5.0.0)
      - `@fastify/cors` (^10.0.0)
      - `@fastify/helmet` (^12.0.0)
      - `@fastify/rate-limit` (^10.0.0)
      - `@fastify/websocket` (^11.0.0)
      - `@hocuspocus/server` (^2.13.0)
      - `@hocuspocus/extension-database` (^2.13.0)
      - `yjs` (^13.6.0)
      - `drizzle-orm` (^0.36.0)
      - `pg` (^8.13.0)
      - `zod` (^3.23.0)
      - `@rumi/protocol`: `"workspace:*"`
    - devDependencies:
      - `drizzle-kit` (^0.28.0)
      - `@types/pg` (^8.11.0)
      - `pino-pretty` (^11.0.0)
  - `apps/server/tsconfig.json`:
    - `"extends": "../../tsconfig.base.json"`
    - `"compilerOptions": { "outDir": "dist", "rootDir": "src", "types": ["bun"], "lib": ["ES2023"], "noEmit": true, "baseUrl": ".", "paths": { "@/*": ["./src/*"] } }`
    - `"include": ["src/**/*"]`
  - `apps/server/.env.example`:
    - `PORT=3001`
    - `NODE_ENV=development`
    - `DATABASE_URL=postgres://postgres:postgres@localhost:5432/rumi`
    - `SUPABASE_URL=`
    - `SUPABASE_JWT_SECRET=` (used by server to verify tokens)
    - `LOG_LEVEL=debug`
- **Verify:** `bunx --print 'JSON.parse(require("fs").readFileSync("apps/server/package.json"))'` parses cleanly.

### Task 2.3: Create `apps/web` package

- **What:** Define the Vite + React + TypeScript client workspace.
- **Why:** Mirror of Task 2.2 for the client side.
- **How:**
  - `apps/web/package.json`:
    - `"name": "@rumi/web"`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`
    - Scripts:
      - `"dev": "vite"`
      - `"build": "tsc -b && vite build"`
      - `"preview": "vite preview"`
      - `"typecheck": "tsc -b"`
      - `"test": "bun test"`
    - dependencies:
      - `react` (^18.3.0) — note: stay on 18 for now, React 19 is fine but plenty of editor packages still warn on it; revisit if pain
      - `react-dom` (^18.3.0)
      - `@tanstack/react-router` (^1.95.0)
      - `zustand` (^5.0.0)
      - `@supabase/supabase-js` (^2.46.0)
      - `yjs` (^13.6.0)
      - `@hocuspocus/provider` (^2.13.0)
      - `codemirror` (^6.0.0)
      - `@codemirror/lang-markdown` (^6.3.0)
      - `@codemirror/state` (^6.5.0)
      - `@codemirror/view` (^6.35.0)
      - `y-codemirror.next` (^0.5.0)
      - `zod` (^3.23.0)
      - `@rumi/protocol`: `"workspace:*"`
    - devDependencies:
      - `vite` (^6.0.0)
      - `@vitejs/plugin-react` (^4.3.0)
      - `tailwindcss` (^4.0.0)
      - `@tailwindcss/vite` (^4.0.0)
      - `@types/react` (^18.3.0)
      - `@types/react-dom` (^18.3.0)
      - `@tanstack/router-plugin` (^1.95.0)
  - `apps/web/tsconfig.json`:
    - `"extends": "../../tsconfig.base.json"`
    - `"compilerOptions": { "jsx": "react-jsx", "lib": ["ES2023", "DOM", "DOM.Iterable"], "noEmit": true, "baseUrl": ".", "paths": { "@/*": ["./src/*"] }, "types": ["vite/client"] }`
    - `"include": ["src/**/*"]`
  - `apps/web/tsconfig.node.json`:
    - For `vite.config.ts` itself (Vite convention).
    - `"extends": "../../tsconfig.base.json"`, `"include": ["vite.config.ts"]`, `"compilerOptions": { "module": "ESNext", "moduleResolution": "bundler", "noEmit": true }`
  - `apps/web/.env.example`:
    - `VITE_SUPABASE_URL=`
    - `VITE_SUPABASE_ANON_KEY=`
    - `VITE_WS_URL=ws://localhost:3001/sync`
- **Verify:** File parses; React-version pin is 18 (avoiding 19 churn for now).

## Phase 3: Install + minimal runnable code

**Gate:** All deps installed before code runs. Each workspace gets one minimal, runnable file so we can verify the toolchain end-to-end.

### Task 3.1: Install dependencies

- **What:** Run `bun install` at repo root.
- **Why:** Resolves the workspace graph and downloads all deps in one pass.
- **How:**
  - From repo root: `bun install`
  - Expect: zero peer-dep warnings that matter; `node_modules` at root and per-workspace symlinks for `@rumi/protocol`.
- **Verify:**
  - `bun install` exits 0.
  - `rtk ls apps/server/node_modules/@rumi/protocol` resolves (workspace symlink).
  - `rtk ls apps/web/node_modules/@rumi/protocol` resolves.
  - `bun.lockb` exists at root.

### Task 3.2: Server entry — `apps/server/src/server.ts` + supporting modules

- **What:** Build the smallest Fastify server that boots, logs structured JSON via Pino, and serves `GET /health`. No Hocuspocus, no DB connection yet — those come with feature plans. Stub the module dirs.
- **Why:** Verifies the Bun + Fastify + TS + Biome toolchain end-to-end. Establishes the wiring conventions that feature tasks will plug into.
- **How:**
  - `apps/server/src/lib/env.ts`:
    - Use `zod` to parse `process.env` into a typed `env` object.
    - Required for now: `PORT` (number, default 3001), `NODE_ENV` (`"development" | "production" | "test"`, default `"development"`), `LOG_LEVEL` (`"debug" | "info" | "warn" | "error"`, default `"info"`).
    - Export `env` as the parsed result. Throw on parse failure.
  - `apps/server/src/lib/logger.ts`:
    - Export a Pino logger configured from `env.LOG_LEVEL`. In `development`, use `pino-pretty` transport. In `production`, plain JSON.
  - `apps/server/src/lib/errors.ts`:
    - Define `AppError extends Error` with a `statusCode: number` field. Export it. No additional helpers yet.
  - `apps/server/src/server.ts`:
    - Import `Fastify` from `fastify`, plus `cors`, `helmet`, `rateLimit` plugins.
    - Build the app: register `helmet`, `cors` (origin from env later — for now allow all in dev, document this), `rate-limit` (sane default: 100 req / 1 min).
    - Pass the Pino logger to Fastify (`{ loggerInstance: logger }`).
    - Register one route: `GET /health` → returns `{ status: "ok", uptime: process.uptime() }`.
    - Listen on `env.PORT`, host `0.0.0.0`. Log "listening on :3001".
    - Wire `SIGINT` and `SIGTERM` to `app.close()` then exit. No 30s timeout dance (over-engineering for MVP — Fastify's `close` is fast).
  - In each empty server module dir (`rooms/`, `sync/`, `presence/`, `persistence/`, `auth/`), keep the `.gitkeep`. Do not stub `index.ts` files in them — empty stubs invite premature decisions.
  - `apps/server/src/auth/`: actually drop the `.gitkeep` and add `apps/server/src/auth/verify.ts` with a single typed-but-unimplemented stub: `export async function verifySupabaseJwt(token: string): Promise<never> { throw new AppError("Not implemented", 501); }`. Reason: SPEC.md references this contract; having the file makes the rooms-feature plan concrete. (Override the rule above only for `auth/`.)
  - `apps/server/src/db/client.ts`: stub — exports nothing yet, just a comment `// Drizzle client set up in db-schema feature plan`. Or omit entirely; prefer omit. **Decision: omit `db/client.ts` for now.** Keep `db/migrations/.gitkeep`.
- **Verify:**
  - `bun run --filter '@rumi/server' dev` starts the server, prints a Pino-pretty log line "listening on :3001".
  - `curl -s http://localhost:3001/health` returns JSON `{"status":"ok","uptime":<number>}`.
  - `bun run --filter '@rumi/server' typecheck` exits 0.

### Task 3.3: Web entry — `apps/web/src/main.tsx` + Vite + Tailwind v4

- **What:** Minimal React app booted by Vite with Tailwind v4 working. One route via TanStack Router renders "Rumi" centered on the page.
- **Why:** Verifies Vite + React + TS + Tailwind v4 + TanStack Router toolchain end-to-end before any feature work.
- **How:**
  - `apps/web/index.html`: standard Vite template, `<div id="root"></div>`, `<script type="module" src="/src/main.tsx">`.
  - `apps/web/vite.config.ts`:
    - Import `defineConfig` from `vite`, `react` from `@vitejs/plugin-react`, `tailwindcss` from `@tailwindcss/vite`, `TanStackRouterVite` from `@tanstack/router-plugin/vite`.
    - Plugins in order: `TanStackRouterVite()`, `react()`, `tailwindcss()`.
    - Set `resolve.alias`: `"@": path.resolve(__dirname, "./src")`.
    - Server port: 5173 (Vite default; explicit).
  - `apps/web/src/styles/globals.css`:
    - First line: `@import "tailwindcss";` (Tailwind v4 syntax — replaces v3's `@tailwind base; ...`).
  - `apps/web/src/lib/env.ts`:
    - Zod parse of `import.meta.env`. Required: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WS_URL`. For scaffolding, allow these to be empty strings (zod `.default("")`) so the dev server boots without configured env. Tighten in the auth feature plan.
  - `apps/web/src/lib/supabase.ts`:
    - Stub: `import { createClient } from "@supabase/supabase-js"; export const supabase = createClient(env.VITE_SUPABASE_URL || "https://placeholder.supabase.co", env.VITE_SUPABASE_ANON_KEY || "placeholder");`
    - The placeholder values mean the client constructs without throwing; it just won't actually authenticate. Real values land with the auth feature.
  - `apps/web/src/routes/__root.tsx`:
    - TanStack Router root route. Imports `createRootRoute`, `Outlet`. Renders `<div className="min-h-screen flex items-center justify-center text-2xl"><Outlet /></div>`.
  - `apps/web/src/routes/index.tsx`:
    - Index route at `/`. Renders `<div>Rumi</div>`.
  - `apps/web/src/routeTree.gen.ts`: auto-generated by `@tanstack/router-plugin`. Do not write by hand; the plugin generates it on first dev/build.
  - `apps/web/src/main.tsx`:
    - Imports `globals.css`, `React`, `ReactDOM`, `RouterProvider`, `createRouter`, the generated `routeTree`.
    - Creates router: `const router = createRouter({ routeTree })`.
    - TS module augmentation for router: `declare module "@tanstack/react-router" { interface Register { router: typeof router } }`.
    - Renders `<StrictMode><RouterProvider router={router} /></StrictMode>` into `#root`.
- **Verify:**
  - `bun run --filter '@rumi/web' dev` starts Vite on `:5173`.
  - Visiting `http://localhost:5173` shows centered "Rumi" with no console errors.
  - `bun run --filter '@rumi/web' typecheck` exits 0.
  - `routeTree.gen.ts` was generated automatically.

### Task 3.4: Smoke tests

- **What:** One trivial test per workspace to verify the test runner works.
- **Why:** Cheap insurance that `bun test` is wired correctly across the monorepo before any feature lands.
- **How:**
  - `apps/server/src/lib/env.test.ts`: imports `env`, asserts `env.PORT > 0`. Use `import { test, expect } from "bun:test"`.
  - `apps/web/src/lib/env.test.ts`: imports the env module, asserts the parsed object has the expected keys.
  - `packages/protocol/src/index.test.ts`: asserts `PROTOCOL_VERSION === "0.0.0"`.
- **Verify:**
  - From repo root: `bun test` runs all three, all pass.

### Task 3.5: Docker compose for local Postgres

- **What:** A `docker-compose.yml` at repo root that runs Postgres 16.
- **Why:** SPEC.md says Postgres on Supabase in production, but local Postgres for fast iteration. Don't require a Supabase account to run the project locally.
- **How:**
  - `docker-compose.yml`:
    ```yaml
    services:
      postgres:
        image: postgres:16-alpine
        container_name: rumi-postgres
        environment:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: rumi
        ports:
          - "5432:5432"
        volumes:
          - rumi-postgres-data:/var/lib/postgresql/data
        healthcheck:
          test: ["CMD-SHELL", "pg_isready -U postgres -d rumi"]
          interval: 5s
          timeout: 3s
          retries: 5

    volumes:
      rumi-postgres-data:
    ```
  - Add a script to root `package.json`: `"db:up": "docker compose up -d postgres"`, `"db:down": "docker compose down"`.
- **Verify:**
  - `docker compose up -d postgres && docker compose ps` shows the container healthy.
  - `docker compose down` stops it cleanly.
  - **Don't actually run this during scaffolding execution.** The verify check is "the file is correct YAML and references postgres:16-alpine." Running it is on the user.

### Task 3.6: Final verification pass

- **What:** Run all the toolchain checks together and confirm a clean state.
- **Why:** Single source of truth that the scaffold is healthy.
- **How:** Run from repo root:
  - `bun install` — exits 0
  - `bun run check` (Biome) — exits 0
  - `bun run typecheck` — exits 0
  - `bun test` — passes 3 smoke tests
  - `bun run --filter '@rumi/server' dev` — server boots, log line appears (kill after confirming)
  - `bun run --filter '@rumi/web' dev` — Vite boots (kill after confirming)
- **Verify:** All six commands succeed. Print a final summary.

## Notes

- **Versions:** Pin to `^` ranges in `package.json` so future installs get patches but not breaking changes. Bun's lockfile pins exact resolutions.
- **No CI yet.** First feature plan can add GitHub Actions if/when needed.
- **No husky / lint-staged.** Biome is fast enough that an editor integration plus an occasional `bun run check` is fine.
- **No shadcn/ui yet.** Add when first real component needs it.
- **Empty module dirs use `.gitkeep`** per user request. Do not place stub `index.ts` files — they invite premature decisions.
- **One exception:** `apps/server/src/auth/verify.ts` is stubbed (typed, throws Not Implemented) because SPEC.md commits to that contract and feature plans reference it. Worth one stub file.
