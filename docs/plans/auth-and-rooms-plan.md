# Auth and Rooms Plan

> **Goal:** OAuth sign-in via Supabase, JWT-verified Fastify API, full room CRUD + invite surface, dashboard UI, room shell at `/r/$slug`.
> **Spec:** [docs/SPEC.md](../SPEC.md)
> **Design:** [docs/designs/auth-and-rooms.md](../designs/auth-and-rooms.md)
> **Depends on:** `design-system-plan.md` complete (tokens, prefs store, shadcn init).

> **Lint convention:** Biome's `noExplicitAny` rule is on by default. A few `as any` casts are unavoidable (third-party type misalignments — Fastify's `loggerInstance`, Hocuspocus payloads, Zustand setter signatures). At each site, add `// biome-ignore lint/suspicious/noExplicitAny: <reason>` immediately above the cast. Snippets in this plan show the cast without the ignore comment for readability — add it during execute.

## Prerequisites — Supabase project setup

Before executing any task in this plan:

1. Create a Supabase project (free tier is fine) at <https://supabase.com>.
2. In **Authentication → Providers**, enable GitHub and Google. For each:
   - Create an OAuth app at the provider (GitHub: Settings → Developer settings → OAuth Apps; Google: Cloud Console → APIs & Services → Credentials).
   - Provider's authorized callback URL: `https://<your-project>.supabase.co/auth/v1/callback`.
   - Paste the provider's client ID and secret into Supabase.
3. In **Authentication → URL Configuration**:
   - Site URL: `http://localhost:5173`
   - Redirect URLs: include `http://localhost:5173/auth/callback`.
4. From **Project Settings → API**, grab:
   - Project URL → `VITE_SUPABASE_URL`, `SUPABASE_JWT_ISSUER` (append `/auth/v1`).
   - `anon` public key → `VITE_SUPABASE_ANON_KEY`.
   - JWKS URL: `<project-url>/auth/v1/.well-known/jwks.json`.
5. From **Project Settings → Database → Connection string**, grab the *connection pooler* URI → `DATABASE_URL` (use the pooled, not direct, connection).
6. Verify the project's JWT settings use **asymmetric (RS256)** keys. New Supabase projects default to this; older projects may need a one-time migration via the dashboard.

These values feed into `.env` files set up in Task 4. Without them, sign-in fails opaquely.

## Task 1: Scaffolding cleanup — drop Docker Postgres + retarget port 3000

- **What:** Remove `docker-compose.yml`, the `db:up`/`db:down` scripts, change server `PORT` default from 3001 to 3000, fix the web `VITE_WS_URL` default, and delete the misleading repo-root `.env.example` (full env files are written per workspace in Task 4 and Task 9).
- **Why:** Per SPEC.md, cloud Supabase is the only Postgres. Scaffolding's local Docker setup + the repo-root `.env.example` describing local Postgres is dead. Plans referencing port 3001 (web env, dev URLs) must align on 3000 from this phase forward.
- **How:**
  - Delete `docker-compose.yml` at repo root.
  - Edit root `package.json`: remove `"db:up"` and `"db:down"` scripts.
  - Edit `apps/server/src/lib/env.ts`: change `PORT` default from `3001` to `3000`.
  - Edit `apps/web/src/lib/env.ts`: change `VITE_WS_URL` default from `"ws://localhost:3001/sync"` to `"ws://localhost:3000/ws"`. (The full env replacement happens in Task 9; this is a stop-gap so the dev server doesn't try to connect to the wrong port between Task 1 and Task 9.)
  - **Delete the existing repo-root `.env.example`** — the per-workspace env files in Task 4 (`apps/server/.env.example`) and Task 9 (`apps/web/.env.example`) replace it. Vite reads from `apps/web/.env*` and Bun reads from `apps/server/.env*` (each app's CWD); a shared root file is misleading.
- **Verify:**
  - `bun --cwd apps/server run dev` logs "listening on :3000".
  - `curl -s http://localhost:3000/health` returns `{"status":"ok",...}`.
  - `bun run check` and `bun run typecheck` from repo root pass.
  - Repo root no longer contains `docker-compose.yml` or `.env.example`.

## Task 2: Install dependencies — server, web, protocol

- **What:** Add all new deps the phase needs in one pass; remove the unused `pg` driver from scaffolding.
- **Why:** Avoid churning `package.json` across tasks. Scaffolding committed `pg` (node-postgres) but Drizzle's `drizzle-orm/postgres-js` adapter consumes the modern `postgres` (postgres-js) driver instead. Two competing Postgres drivers in deps is dead code.
- **How:**
  - **`apps/server/`:**
    - **Remove** from `dependencies`: `pg`. **Remove** from `devDependencies`: `@types/pg`.
    - **Add** to `dependencies`:
      - `jose@^5.0.0` (JWKS verification)
      - `postgres@^3.4.0` (postgres-js driver for Drizzle)
      - `unique-names-generator@^4.7.0`
      - `fastify-type-provider-zod@^4.0.0` (Fastify v5 compat)
      - `fastify-plugin@^5.0.0` (used by `auth/plugin.ts` in Task 5; explicit add even though it's a transitive dep of Fastify v5)
  - **`apps/web/`:**
    - shadcn components are added via CLI in Task 8 (not npm-installed here).
    - **Add** to `dependencies`:
      - `lucide-react@^0.460.0` (icon set used by TopBar, EmptyState, sign-in card, future tab bar)
      - `react-icons@^5.0.0` (multi-color brand icons — used for the Google sign-in button since lucide is monochrome)
  - **`packages/protocol/`:** no changes (zod already there).
  - Run `bun install` from repo root.
- **Verify:** `bun install` exits 0; `bun run typecheck` passes; `pg` and `@types/pg` are gone from `apps/server/package.json`.

## Task 3: Define shared protocol schemas

- **What:** Zod schemas for all 8 endpoint request/response shapes plus the error envelope.
- **Why:** Server (Task 7) and web (Task 12) both consume these. Lives in `packages/protocol/src/` so both workspaces import from `@rumi/protocol`.
- **How:**
  - Create `packages/protocol/src/errors.ts`:
    ```ts
    import { z } from "zod";
    export const ErrorCode = z.enum([
      "unauthorized", "forbidden", "not_found",
      "validation_failed", "slug_taken", "invite_not_found", "server_error",
    ]);
    export type ErrorCode = z.infer<typeof ErrorCode>;

    export const ErrorEnvelope = z.object({
      error: z.object({
        code: ErrorCode,
        message: z.string(),
        details: z.unknown().optional(),
      }),
    });
    export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
    ```
  - Create `packages/protocol/src/rooms.ts`:
    ```ts
    import { z } from "zod";

    export const Visibility = z.enum(["private", "link"]);
    export const Role = z.enum(["owner", "member"]);

    export const Room = z.object({
      id: z.string().uuid(),
      slug: z.string(),
      name: z.string().nullable(),
      ownerId: z.string().uuid(),
      visibility: Visibility,
      linkCanEdit: z.boolean(),
      createdAt: z.string(), // ISO
      updatedAt: z.string(),
    });
    export type Room = z.infer<typeof Room>;

    export const RoomInvite = z.object({
      id: z.string().uuid(),
      roomId: z.string().uuid(),
      invitedEmail: z.string().email(),
      invitedBy: z.string().uuid(),
      createdAt: z.string(),
      acceptedAt: z.string().nullable(),
    });
    export type RoomInvite = z.infer<typeof RoomInvite>;

    // Tabs — declared here so GetRoomResponse can return the room's tab list.
    // Tab CRUD endpoints (POST/PATCH/DELETE) live in the realtime-markdown phase.
    export const TabType = z.enum(["tab", "drawing"]);
    export type TabType = z.infer<typeof TabType>;

    export const TabSummary = z.object({
      id: z.string().uuid(),
      roomId: z.string().uuid(),
      type: TabType,
      language: z.string().nullable(),
      name: z.string(),
      ordinal: z.number().int().nonnegative(),
      createdAt: z.string(),
      updatedAt: z.string(),
    });
    export type TabSummary = z.infer<typeof TabSummary>;

    // Request bodies
    export const CreateRoomBody = z.object({
      name: z.string().trim().min(1).max(100).optional(),
      visibility: Visibility.optional(),
      linkCanEdit: z.boolean().optional(),
    });
    export const UpdateRoomBody = z.object({
      name: z.string().trim().min(1).max(100).optional(),
      visibility: Visibility.optional(),
      linkCanEdit: z.boolean().optional(),
    });
    export const CreateInviteBody = z.object({
      email: z.string().email().toLowerCase().max(254),
    });

    // Response bodies
    export const CreateRoomResponse = z.object({ room: Room });
    export const ListRoomsResponse = z.object({
      rooms: z.array(Room.extend({ pendingInvite: z.boolean() })),
    });
    export const GetRoomResponse = z.object({
      room: Room,
      role: Role,
      linkCanEdit: z.boolean(),
      tabs: z.array(TabSummary), // ordered by ordinal asc; always non-empty after seed
    });
    export const UpdateRoomResponse = z.object({ room: Room });
    export const CreateInviteResponse = z.object({ invite: RoomInvite });
    export const ListInvitesResponse = z.object({ invites: z.array(RoomInvite) });

    // Path params
    export const SlugParam = z.object({
      slug: z.string().regex(/^[a-z0-9-]+$/).max(64),
    });
    export const InviteIdParams = z.object({
      slug: z.string().regex(/^[a-z0-9-]+$/).max(64),
      id: z.string().uuid(),
    });
    ```
  - Update `packages/protocol/src/index.ts`:
    ```ts
    export * from "./errors";
    export * from "./rooms";
    export const PROTOCOL_VERSION = "0.1.0";
    ```
- **Verify:**
  - `bun --cwd packages/protocol run typecheck` passes.
  - `bun test packages/protocol` passes (existing smoke test still imports `PROTOCOL_VERSION`).

## Task 4: Drizzle schema, client, and migration

- **What:** Define `rooms`, `room_members`, `room_invites`, **and `tabs`** tables; create the Drizzle client; generate the first migration.
- **Why:** Service layer (Task 6) and route handlers (Task 7) depend on these tables existing. The `tabs` table is room metadata (per SPEC.md "Database tables"); the `tab_documents` binary-state table belongs to the realtime phase and is created by its own migration.
- **How:**
  - Create `apps/server/src/db/schema.ts` per the design doc:
    - `rooms`, `roomMembers`, `roomInvites` definitions verbatim from design doc lines 256–293.
    - `tabs` table per SPEC.md "Database tables → tabs":
    ```ts
    export const tabs = pgTable(
      "tabs",
      {
        id: uuid("id").primaryKey().defaultRandom(),
        roomId: uuid("room_id")
          .notNull()
          .references(() => rooms.id, { onDelete: "cascade" }),
        type: text("type", { enum: ["tab", "drawing"] }).notNull(),
        language: text("language"),
        name: text("name").notNull().default("Untitled"),
        ordinal: integer("ordinal").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
          .notNull()
          .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
          .notNull()
          .defaultNow(),
      },
      (t) => ({
        roomOrdinalIdx: uniqueIndex("tabs_room_ordinal_unique").on(t.roomId, t.ordinal),
        // CHECK: drawing tabs cannot have a language
        drawingHasNoLang: check(
          "tabs_drawing_lang_null",
          sql`(${t.type} <> 'drawing' OR ${t.language} IS NULL)`,
        ),
      }),
    );
    ```
  - Imports needed at top of `schema.ts`: `integer`, `uniqueIndex`, `check` from `drizzle-orm/pg-core`, plus `sql` from `drizzle-orm`.
  - Create `apps/server/src/db/client.ts`:
    ```ts
    import { drizzle } from "drizzle-orm/postgres-js";
    import postgres from "postgres";
    import { env } from "@/lib/env";
    import * as schema from "./schema";

    const client = postgres(env.DATABASE_URL, { prepare: false });
    export const db = drizzle(client, { schema });
    export type DbClient = typeof db;
    ```
    (`prepare: false` is required for Supabase's connection pooler.)
  - Add `DATABASE_URL` to `apps/server/src/lib/env.ts` Zod schema as `z.string().url()`. While here, also add Zod entries for `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`, `WEB_ORIGIN`.
  - **Create** `apps/server/.env.example` (does not exist in scaffolding):
    ```
    DATABASE_URL=postgresql://postgres:[password]@aws-0-<region>.pooler.supabase.com:6543/postgres
    SUPABASE_JWKS_URL=https://<project>.supabase.co/auth/v1/.well-known/jwks.json
    SUPABASE_JWT_ISSUER=https://<project>.supabase.co/auth/v1
    SUPABASE_JWT_AUDIENCE=authenticated
    PORT=3000
    WEB_ORIGIN=http://localhost:5173
    NODE_ENV=development
    LOG_LEVEL=info
    ```
  - Each developer copies this to `apps/server/.env` (gitignored) and fills in the real values from their Supabase project (Prerequisites step 4–5).
  - Create `apps/server/drizzle.config.ts`:
    ```ts
    import { defineConfig } from "drizzle-kit";
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set — copy apps/server/.env.example to apps/server/.env and fill it in");
    }
    export default defineConfig({
      schema: "./src/db/schema.ts",
      out: "./src/db/migrations",
      dialect: "postgresql",
      dbCredentials: { url: process.env.DATABASE_URL },
    });
    ```
    Bun loads `apps/server/.env` automatically when running scripts from that workspace, so `process.env.DATABASE_URL` is populated for the `db:generate` / `db:migrate` commands below — provided you've created `apps/server/.env`.
  - Before running migrations, ensure `apps/server/.env` exists (copy from `.env.example` and fill in `DATABASE_URL` from your Supabase project).
  - Run `bun --cwd apps/server run db:generate` — produces `src/db/migrations/0000_*.sql`. Inspect it: should create the 4 tables (`rooms`, `room_members`, `room_invites`, `tabs`), indexes, FKs, and the `tabs_drawing_lang_null` CHECK constraint.
  - Run `bun --cwd apps/server run db:migrate` against your Supabase project.
- **Verify:**
  - Migration file committed (e.g., `apps/server/src/db/migrations/0000_initial.sql`).
  - In Supabase Studio (or `psql`), confirm `rooms`, `room_members`, `room_invites`, `tabs` tables exist with the expected columns and constraints.
  - `bun --cwd apps/server run typecheck` passes.

## Task 5: JWT verification module + unified errors

- **What:** Replace the scaffolding `lib/errors.ts` with the full error model (`AppError`, `AuthError`, `envelope()`); add `auth/jwks.ts`, `auth/verify.ts`, `auth/plugin.ts`.
- **Why:** Every authenticated request and (in realtime-markdown) every WS upgrade goes through `verifyJwt`. The scaffolding's `AppError` has a different constructor signature (`(message, statusCode)`) than the new model needs (`(code, message, statusCode, details)`); we standardize on the new shape and put it in `lib/errors.ts` (not a separate `auth/errors.ts`) so service-layer code can throw the same error type.
- **How:**
  - **Replace `apps/server/src/lib/errors.ts`** (the scaffolding stub) with:
    ```ts
    import type { ErrorCode } from "@rumi/protocol";

    export class AppError extends Error {
      constructor(
        public code: ErrorCode,
        message: string,
        public statusCode = 400,
        public details?: unknown,
      ) {
        super(message);
        this.name = "AppError";
      }
    }

    export class AuthError extends AppError {
      constructor(code: "unauthorized" | "forbidden" | "not_found", message: string) {
        const status = code === "unauthorized" ? 401 : code === "forbidden" ? 403 : 404;
        super(code, message, status);
        this.name = "AuthError";
      }
    }

    export function envelope(err: AppError) {
      return { error: { code: err.code, message: err.message, details: err.details } };
    }
    ```
    Note: this is a breaking change to the constructor of the existing `AppError`. Scaffolding committed it but no other code consumes it yet, so the change is safe.
  - **`apps/server/src/auth/jwks.ts`:**
    ```ts
    import { createRemoteJWKSet } from "jose";
    import { env } from "@/lib/env";
    export const JWKS = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL), {
      cacheMaxAge: 10 * 60 * 1000, // 10 min
      cooldownDuration: 30 * 1000, // 30s on unknown kid (key rotation window)
    });
    ```
  - **`apps/server/src/auth/verify.ts`** (replaces the existing stub):
    ```ts
    import { jwtVerify } from "jose";
    import { JWKS } from "./jwks";
    import { env } from "@/lib/env";
    import { AuthError } from "@/lib/errors";

    export interface AuthenticatedUser {
      id: string;
      email: string;
    }

    export async function verifyJwt(token: string): Promise<AuthenticatedUser> {
      try {
        const { payload } = await jwtVerify(token, JWKS, {
          issuer: env.SUPABASE_JWT_ISSUER,
          audience: env.SUPABASE_JWT_AUDIENCE,
        });
        if (!payload.sub || typeof payload.email !== "string") {
          throw new AuthError("unauthorized", "JWT missing required claims");
        }
        return { id: payload.sub, email: payload.email.toLowerCase() };
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError("unauthorized", "Invalid or expired token");
      }
    }
    ```
  - **`apps/server/src/auth/plugin.ts`:**
    ```ts
    import type { FastifyPluginAsync } from "fastify";
    import fp from "fastify-plugin";
    import { verifyJwt, type AuthenticatedUser } from "./verify";
    import { AuthError, envelope } from "@/lib/errors";

    declare module "fastify" {
      interface FastifyRequest { user?: AuthenticatedUser }
    }

    const authPlugin: FastifyPluginAsync = async (app) => {
      app.addHook("onRequest", async (req, reply) => {
        if (!req.url.startsWith("/api/")) return;
        const auth = req.headers.authorization;
        if (!auth?.startsWith("Bearer ")) {
          const err = new AuthError("unauthorized", "Missing Authorization header");
          return reply.code(err.statusCode).send(envelope(err));
        }
        try {
          req.user = await verifyJwt(auth.slice("Bearer ".length));
        } catch (err) {
          if (err instanceof AuthError) {
            return reply.code(err.statusCode).send(envelope(err));
          }
          throw err;
        }
      });
    };

    export default fp(authPlugin, { name: "auth" });
    ```
  - **All other files import errors from `@/lib/errors`, not `@/auth/errors`** — the latter does not exist. Subsequent tasks (service.ts, server.ts, sync/authorize.ts) follow this convention.
- **Verify:**
  - `bun --cwd apps/server run typecheck` passes.
  - Unit test `apps/server/src/auth/verify.test.ts` mocks the JWKS and asserts:
    - Valid token → returns `{ id, email }` with lowercased email
    - Expired token → throws `AuthError("unauthorized")`
    - Wrong audience → throws
    - Missing `email` claim → throws
  - `bun test apps/server/src/auth` passes.

## Task 6: Rooms service layer (repo + business logic)

- **What:** `rooms/service.ts` with injectable Drizzle client; `rooms/slug.ts` with collision retry; `rooms/invites.ts` resolution helpers.
- **Why:** Encapsulates DB operations so route handlers stay thin and tests can pass a mock `DbClient` without a real DB.
- **How:**
  - **`apps/server/src/rooms/slug.ts`:**
    ```ts
    import { uniqueNamesGenerator, adjectives, animals, NumberDictionary } from "unique-names-generator";

    const numbers = NumberDictionary.generate({ length: 2 });

    export function generateSlug(): string {
      return uniqueNamesGenerator({
        dictionaries: [adjectives, animals, numbers],
        separator: "-",
        style: "lowerCase",
      });
    }

    export function fallbackSlug(): string {
      // Used after 5 collision retries — appends a 4-char UUID fragment.
      return `${generateSlug()}-${crypto.randomUUID().slice(0, 4)}`;
    }
    ```
  - **`apps/server/src/rooms/service.ts`:**
    ```ts
    import { and, eq, isNull } from "drizzle-orm";
    import type { DbClient } from "@/db/client";
    import { rooms, roomMembers, roomInvites, tabs } from "@/db/schema";
    import { generateSlug, fallbackSlug } from "./slug";
    import { AppError, AuthError } from "@/lib/errors";

    export type Service = ReturnType<typeof createService>;

    export function createService(db: DbClient) {
      return {
        async createRoom(opts: {
          ownerId: string;
          name?: string;
          visibility?: "private" | "link";
          linkCanEdit?: boolean;
        }) {
          for (let attempt = 0; attempt < 6; attempt++) {
            const slug = attempt < 5 ? generateSlug() : fallbackSlug();
            try {
              return await db.transaction(async (tx) => {
                const [room] = await tx.insert(rooms).values({
                  slug,
                  name: opts.name ?? null,
                  ownerId: opts.ownerId,
                  visibility: opts.visibility ?? "link",
                  linkCanEdit: opts.linkCanEdit ?? true,
                }).returning();
                await tx.insert(roomMembers).values({
                  roomId: room.id,
                  userId: opts.ownerId,
                  role: "owner",
                });
                // First-tab seed (per SPEC.md "Database tables → tabs" + Edge Cases).
                // The "Welcome" tab is empty server-side; the client recognizes
                // name='Welcome' + language='markdown' + empty Y.Text on first
                // connect and seeds welcome content into the Y.Text. We don't
                // write Yjs binary state from the server.
                await tx.insert(tabs).values({
                  roomId: room.id,
                  type: "tab",
                  language: "markdown",
                  name: "Welcome",
                  ordinal: 0,
                });
                return room;
              });
            } catch (err: any) {
              if (err.code === "23505" && err.constraint_name === "rooms_slug_unique") continue;
              throw err;
            }
          }
          throw new AppError("server_error", "Failed to generate unique slug after 6 attempts", 500);
        },

        async listRooms(userId: string, userEmail: string) {
          // Rooms where user is a member OR has a pending invite, deleted_at IS NULL.
          // Returns an array enriched with `pendingInvite: boolean`.
          // Implementation: two queries union'd in app code (cleaner than a complex SQL JOIN at MVP scale).
          const memberRooms = await db
            .select()
            .from(rooms)
            .innerJoin(roomMembers, eq(roomMembers.roomId, rooms.id))
            .where(and(eq(roomMembers.userId, userId), isNull(rooms.deletedAt)));

          const invitedRooms = await db
            .select()
            .from(rooms)
            .innerJoin(roomInvites, eq(roomInvites.roomId, rooms.id))
            .where(and(
              eq(roomInvites.invitedEmail, userEmail),
              isNull(roomInvites.acceptedAt),
              isNull(rooms.deletedAt),
            ));

          const seen = new Set<string>();
          const out: Array<typeof rooms.$inferSelect & { pendingInvite: boolean }> = [];
          for (const r of memberRooms) {
            if (seen.has(r.rooms.id)) continue;
            seen.add(r.rooms.id);
            out.push({ ...r.rooms, pendingInvite: false });
          }
          for (const r of invitedRooms) {
            if (seen.has(r.rooms.id)) continue;
            seen.add(r.rooms.id);
            out.push({ ...r.rooms, pendingInvite: true });
          }
          return out;
        },

        async getRoomBySlug(slug: string, userId: string, userEmail: string) {
          // Returns { room, role, linkCanEdit, tabs }. Auto-joins on `link`. Resolves invite on `private`.
          const room = await db.query.rooms.findFirst({
            where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
          });
          if (!room) throw new AuthError("not_found", "Room not found");

          const existing = await db.query.roomMembers.findFirst({
            where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
          });

          // Helper to read the room's tab list (ordered).
          const fetchTabs = () => db.query.tabs.findMany({
            where: eq(tabs.roomId, room.id),
            orderBy: (t, { asc }) => [asc(t.ordinal)],
          });

          if (existing) {
            const tabList = await fetchTabs();
            return { room, role: existing.role, linkCanEdit: room.linkCanEdit, tabs: tabList };
          }

          if (room.visibility === "link") {
            await db.insert(roomMembers)
              .values({ roomId: room.id, userId, role: "member" })
              .onConflictDoNothing();
            const tabList = await fetchTabs();
            return { room, role: "member" as const, linkCanEdit: room.linkCanEdit, tabs: tabList };
          }

          // Private — check for pending invite matching email.
          const invite = await db.query.roomInvites.findFirst({
            where: and(
              eq(roomInvites.roomId, room.id),
              eq(roomInvites.invitedEmail, userEmail),
              isNull(roomInvites.acceptedAt),
            ),
          });
          if (!invite) throw new AuthError("forbidden", "No access to this room");

          await db.transaction(async (tx) => {
            await tx.insert(roomMembers)
              .values({ roomId: room.id, userId, role: "member" })
              .onConflictDoNothing();
            await tx.update(roomInvites)
              .set({ acceptedAt: new Date() })
              .where(and(
                eq(roomInvites.id, invite.id),
                isNull(roomInvites.acceptedAt),
              ));
          });
          const tabList = await fetchTabs();
          return { room, role: "member" as const, linkCanEdit: room.linkCanEdit, tabs: tabList };
        },

        async updateRoom(slug: string, userId: string, body: {
          name?: string; visibility?: "private" | "link"; linkCanEdit?: boolean;
        }) {
          const room = await db.query.rooms.findFirst({
            where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
          });
          if (!room) throw new AuthError("not_found", "Room not found");
          if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");

          const sideEffectsNeeded =
            (body.visibility !== undefined && body.visibility !== room.visibility) ||
            (body.linkCanEdit !== undefined && body.linkCanEdit !== room.linkCanEdit);

          const [updated] = await db.update(rooms)
            .set({ ...body, updatedAt: new Date() })
            .where(eq(rooms.id, room.id))
            .returning();
          return { room: updated, sideEffectsNeeded };
        },

        async softDeleteRoom(slug: string, userId: string) {
          const room = await db.query.rooms.findFirst({
            where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
          });
          if (!room) throw new AuthError("not_found", "Room not found");
          if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");
          await db.update(rooms)
            .set({ deletedAt: new Date() })
            .where(eq(rooms.id, room.id));
          // Return the room id so the caller can drop live tab connections.
          return { roomId: room.id };
        },

        async createInvite(slug: string, userId: string, email: string) {
          const room = await db.query.rooms.findFirst({
            where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
          });
          if (!room) throw new AuthError("not_found", "Room not found");
          if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");

          const lower = email.toLowerCase();
          // Idempotent: return existing pending invite if one exists for this (room, email).
          const existing = await db.query.roomInvites.findFirst({
            where: and(
              eq(roomInvites.roomId, room.id),
              eq(roomInvites.invitedEmail, lower),
              isNull(roomInvites.acceptedAt),
            ),
          });
          if (existing) return existing;

          const [invite] = await db.insert(roomInvites).values({
            roomId: room.id,
            invitedEmail: lower,
            invitedBy: userId,
          }).returning();
          return invite;
        },

        async listInvites(slug: string, userId: string) {
          const room = await db.query.rooms.findFirst({
            where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
          });
          if (!room) throw new AuthError("not_found", "Room not found");
          if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");
          return db.query.roomInvites.findMany({
            where: and(
              eq(roomInvites.roomId, room.id),
              isNull(roomInvites.acceptedAt),
            ),
          });
        },

        async revokeInvite(slug: string, inviteId: string, userId: string) {
          const room = await db.query.rooms.findFirst({
            where: and(eq(rooms.slug, slug), isNull(rooms.deletedAt)),
          });
          if (!room) throw new AuthError("not_found", "Room not found");
          if (room.ownerId !== userId) throw new AuthError("forbidden", "Owner only");
          const result = await db.delete(roomInvites)
            .where(and(
              eq(roomInvites.id, inviteId),
              eq(roomInvites.roomId, room.id),
              isNull(roomInvites.acceptedAt),
            ))
            .returning({ id: roomInvites.id });
          if (result.length === 0) throw new AuthError("not_found", "Invite not found");
        },
      };
    }
    ```
- **Verify:**
  - `bun --cwd apps/server run typecheck` passes.
  - `apps/server/src/rooms/service.test.ts` covers each method with a mocked `DbClient` (use `as unknown as DbClient` shape with method stubs):
    - `createRoom` retries on `23505` unique violation; gives up at attempt 6 with `server_error`.
    - `getRoomBySlug` — link auto-joins, private with invite promotes, private without invite throws `forbidden`.
    - `updateRoom` returns `sideEffectsNeeded: true` only when visibility or linkCanEdit change.
    - `softDeleteRoom` non-owner throws `forbidden`.
    - `createInvite` is idempotent on (room, email).
  - `bun test apps/server/src/rooms` passes.

## Task 7: Fastify routes — `/api/rooms` (8 endpoints) + `dropRoomConnections` decorator stub

- **What:** Wire all 8 endpoints in `rooms/routes.ts`, register Helmet/CORS, configure the Zod type provider, and decorate the app with a `dropRoomConnections` stub for the realtime-markdown phase to override.
- **Why:** End-to-end of the auth-and-rooms HTTP surface. The decorator stub lets PATCH/DELETE handlers call `app.dropRoomConnections(roomId)` even before realtime-markdown ships — currently a no-op, later wired to Hocuspocus to iterate the room's tabs and the control doc.
- **How:**
  - Update `apps/server/src/server.ts`:
    ```ts
    import Fastify from "fastify";
    import cors from "@fastify/cors";
    import helmet from "@fastify/helmet";
    import rateLimit from "@fastify/rate-limit";
    import {
      serializerCompiler, validatorCompiler, ZodTypeProvider,
    } from "fastify-type-provider-zod";
    import { env } from "@/lib/env";
    import { logger } from "@/lib/logger";
    import { db } from "@/db/client";
    import authPlugin from "@/auth/plugin";
    import { createService } from "@/rooms/service";
    import { roomsRoutes } from "@/rooms/routes";
    import { AppError, envelope } from "@/lib/errors";

    export async function buildServer() {
      const app = Fastify({
        // biome-ignore lint/suspicious/noExplicitAny: Fastify's loggerInstance type is overly strict; pino's Logger is compatible at runtime
        loggerInstance: logger as any,
        disableRequestLogging: false,
        trustProxy: true,
      }).withTypeProvider<ZodTypeProvider>();
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);

      // Derive the Supabase public origin from the JWT issuer (e.g.,
      // "https://<project>.supabase.co/auth/v1" → "https://<project>.supabase.co").
      const supabaseOrigin = new URL(env.SUPABASE_JWT_ISSUER).origin;
      await app.register(helmet, {
        contentSecurityPolicy: {
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'"], // anti-flash inline script
            "connect-src": ["'self'", supabaseOrigin],
            "img-src": ["'self'", "data:", "https:"],
          },
        },
      });
      await app.register(cors, { origin: env.WEB_ORIGIN, credentials: false });
      await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });

    // Decorate with a service factory + dropRoomConnections stub.
    // The dropRoomConnections stub is replaced by realtime-markdown phase with
      // the real Hocuspocus-backed implementation; that phase removes this
      // stub line entirely before adding its own decorate call.
      app.decorate("service", createService(db));
    // Stub: realtime-markdown phase replaces this with the real Hocuspocus-backed
    // implementation. `dropRoomConnections(roomId)` is responsible for closing
    // every tab connection in the room AND the room control doc connection.
    // This phase only declares it so room PATCH/DELETE handlers compile.
    app.decorate("dropRoomConnections", async (_roomId: string) => {
      // No-op until realtime-markdown phase wires Hocuspocus.
    });

      await app.register(authPlugin);
      await app.register(roomsRoutes, { prefix: "/api/rooms" });

      app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

      app.setErrorHandler((err, _req, reply) => {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send(envelope(err));
        }
        logger.error({ err }, "unhandled error");
        return reply.code(500).send(envelope(new AppError("server_error", "Internal error", 500)));
      });

      return app;
    }

    if (import.meta.main) {
      const app = await buildServer();
      await app.listen({ port: env.PORT, host: "0.0.0.0" });
      logger.info(`listening on :${env.PORT}`);

      const shutdown = async (signal: string) => {
        logger.info({ signal }, "shutting down");
        await app.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
    }
    ```
  - Add Fastify type augmentation in a new file `apps/server/src/types.d.ts`:
    ```ts
    import type { Service } from "@/rooms/service";
    declare module "fastify" {
      interface FastifyInstance {
        service: Service;
        dropRoomConnections: (roomId: string) => Promise<void>;
      }
    }
    ```
  - Create `apps/server/src/rooms/routes.ts` with all 8 endpoints. Each route uses the Zod type provider's `schema` field for body/params validation and the protocol schemas for response shapes:
    ```ts
    import type { FastifyPluginAsync } from "fastify";
    import { ZodTypeProvider } from "fastify-type-provider-zod";
    import {
      CreateRoomBody, UpdateRoomBody, CreateInviteBody,
      SlugParam, InviteIdParams,
      type Room as ProtocolRoom, type RoomInvite as ProtocolInvite,
      type TabSummary,
    } from "@rumi/protocol";
    import type {
      rooms as roomsTable,
      roomInvites as roomInvitesTable,
      tabs as tabsTable,
    } from "@/db/schema";

    export const roomsRoutes: FastifyPluginAsync = async (app) => {
      const typed = app.withTypeProvider<ZodTypeProvider>();

      typed.post("/", { schema: { body: CreateRoomBody } }, async (req, reply) => {
        const room = await app.service.createRoom({ ownerId: req.user!.id, ...req.body });
        return reply.code(201).send({ room: serialize(room) });
      });

      typed.get("/", async (req) => {
        const rooms = await app.service.listRooms(req.user!.id, req.user!.email);
        return { rooms: rooms.map((r) => ({ ...serialize(r), pendingInvite: r.pendingInvite })) };
      });

      typed.get("/:slug", { schema: { params: SlugParam } }, async (req) => {
        const { room, role, linkCanEdit, tabs } = await app.service.getRoomBySlug(
          req.params.slug, req.user!.id, req.user!.email,
        );
        return {
          room: serialize(room),
          role,
          linkCanEdit,
          tabs: tabs.map(serializeTab),
        };
      });

      typed.patch("/:slug", { schema: { params: SlugParam, body: UpdateRoomBody } }, async (req) => {
        const { room, sideEffectsNeeded } = await app.service.updateRoom(
          req.params.slug, req.user!.id, req.body,
        );
        if (sideEffectsNeeded) await app.dropRoomConnections(room.id);
        return { room: serialize(room) };
      });

      typed.delete("/:slug", { schema: { params: SlugParam } }, async (req, reply) => {
        const { roomId } = await app.service.softDeleteRoom(req.params.slug, req.user!.id);
        await app.dropRoomConnections(roomId);
        return reply.code(204).send();
      });

      typed.post("/:slug/invites", { schema: { params: SlugParam, body: CreateInviteBody } }, async (req, reply) => {
        const invite = await app.service.createInvite(req.params.slug, req.user!.id, req.body.email);
        return reply.code(201).send({ invite: serializeInvite(invite) });
      });

      typed.get("/:slug/invites", { schema: { params: SlugParam } }, async (req) => {
        const invites = await app.service.listInvites(req.params.slug, req.user!.id);
        return { invites: invites.map(serializeInvite) };
      });

      typed.delete("/:slug/invites/:id", { schema: { params: InviteIdParams } }, async (req, reply) => {
        await app.service.revokeInvite(req.params.slug, req.params.id, req.user!.id);
        return reply.code(204).send();
      });
    };

    // Drizzle returns Date objects for timestamps; protocol uses ISO strings.
    // These helpers narrow the types and serialize Dates.
    function serializeTab(t: typeof tabsTable.$inferSelect): TabSummary {
      return {
        id: t.id,
        roomId: t.roomId,
        type: t.type,
        language: t.language,
        name: t.name,
        ordinal: t.ordinal,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    }
    function serialize(r: typeof roomsTable.$inferSelect): ProtocolRoom {
      return {
        id: r.id, slug: r.slug, name: r.name, ownerId: r.ownerId,
        visibility: r.visibility, linkCanEdit: r.linkCanEdit,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    }
    function serializeInvite(i: typeof roomInvitesTable.$inferSelect): ProtocolInvite {
      return {
        id: i.id, roomId: i.roomId, invitedEmail: i.invitedEmail, invitedBy: i.invitedBy,
        createdAt: i.createdAt.toISOString(),
        acceptedAt: i.acceptedAt?.toISOString() ?? null,
      };
    }
    ```
- **Verify:**
  - `bun --cwd apps/server run dev` boots; `curl http://localhost:3000/api/rooms` returns `401 unauthorized` envelope (no JWT).
  - `apps/server/src/rooms/routes.test.ts` uses `app.inject()` with a mocked `service` and `closeConnections`:
    - PATCH with name-only → `dropRoomConnections` not called.
    - PATCH with `visibility` change → `dropRoomConnections(roomId)` called once.
    - DELETE → `dropRoomConnections(roomId)` called once.
    - All 8 endpoints return correct status codes and envelope shapes for happy/error paths.
  - `bun test apps/server/src/rooms/routes.test.ts` passes.

## Task 8: Install shadcn components

- **What:** Run `bunx shadcn@latest add` for the 11 components this phase needs.
- **Why:** Components are added per-phase per design-system decision. Doing them as one batch keeps the `components.json` config audit single-shot. Tooltip and Popover are needed for the TopBar's presence-avatar tooltips and the inline-rename / share-confirmation surfaces (and pre-empt the realtime-markdown phase's add-tab popover).
- **How:**
  - From `apps/web/`, run:
    ```bash
    bunx shadcn@latest add button input label avatar dropdown-menu dialog alert-dialog sonner skeleton tooltip popover
    ```
  - Each command writes to `apps/web/src/components/ui/<name>.tsx` and may add npm dependencies (Radix primitives). Accept all prompts.
  - After all components are added, verify each imports `cn` from `@/lib/utils` (default shadcn behavior — should be automatic).
- **Verify:**
  - 11 component files exist in `apps/web/src/components/ui/`.
  - `bun --cwd apps/web run typecheck` passes.
  - Visual verification happens naturally in Task 12 when components are consumed by routes — no need for a temporary smoke render here.

## Task 9: Web — Supabase client, session store, typed API wrapper

- **What:** `lib/supabase.ts`, `lib/auth.ts` (session store + `extractProfile`), `lib/api.ts` (typed fetch with 401 refresh-retry).
- **Why:** Every web feature consumes these. Session store hydrates before any `_authed` route renders.
- **How:**
  - Replace the contents of `apps/web/src/lib/env.ts` (created in scaffolding with stubs) with the full validated shape:
    ```ts
    import { z } from "zod";

    const Env = z.object({
      VITE_API_URL: z.string().url(),
      VITE_SUPABASE_URL: z.string().url(),
      VITE_SUPABASE_ANON_KEY: z.string().min(1),
      // VITE_WS_URL is consumed by realtime-markdown but the var is declared
      // here so the env file has the full surface from day one. Default
      // matches the dev server port (3000).
      VITE_WS_URL: z.string().default("ws://localhost:3000/ws"),
    });

    export const env = Env.parse(import.meta.env);
    export type Env = typeof env;
    ```
  - Create `apps/web/.env.example` (Vite reads env vars from the project root, not the monorepo root):
    ```
    VITE_API_URL=http://localhost:3000
    VITE_SUPABASE_URL=https://<your-project>.supabase.co
    VITE_SUPABASE_ANON_KEY=<your-anon-key>
    VITE_WS_URL=ws://localhost:3000/ws
    ```
  - **`apps/web/src/lib/supabase.ts`:**
    ```ts
    import { createClient } from "@supabase/supabase-js";
    import { env } from "./env";
    export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    ```
    (`detectSessionInUrl: false` because we handle the callback explicitly in `/auth/callback`.)
  - **`apps/web/src/lib/auth.ts`:**
    ```ts
    import { create } from "zustand";
    import type { User as SupabaseUser } from "@supabase/supabase-js";
    import { supabase } from "./supabase";

    export interface SessionUser {
      id: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
    }

    interface SessionState {
      user: SessionUser | null;
      token: string | null;
      status: "loading" | "authenticated" | "anonymous";
      _set: (s: Partial<Omit<SessionState, "_set">>) => void;
    }

    export const useSession = create<SessionState>((set) => ({
      user: null,
      token: null,
      status: "loading",
      _set: (s) => set(s as any),
    }));

    function pickNonEmpty(...vs: (string | null | undefined)[]): string | null {
      for (const v of vs) if (v && v.trim()) return v.trim();
      return null;
    }

    export function extractProfile(u: SupabaseUser): SessionUser {
      const m = (u.user_metadata ?? {}) as Record<string, string | null | undefined>;
      return {
        id: u.id,
        email: (u.email ?? "").toLowerCase(),
        displayName:
          pickNonEmpty(m.full_name, m.name, m.user_name, u.email?.split("@")[0]) ?? "Unknown",
        avatarUrl: pickNonEmpty(m.avatar_url, m.picture),
      };
    }

    // Initialize on app boot.
    export async function initAuth() {
      const { data } = await supabase.auth.getSession();
      if (data.session && data.session.user.email) {
        useSession.getState()._set({
          user: extractProfile(data.session.user),
          token: data.session.access_token,
          status: "authenticated",
        });
      } else {
        // No session, or session without an email claim (rare OAuth edge case).
        if (data.session && !data.session.user.email) {
          await supabase.auth.signOut();
        }
        useSession.getState()._set({ status: "anonymous" });
      }

      supabase.auth.onAuthStateChange((_event, session) => {
        if (session && session.user.email) {
          useSession.getState()._set({
            user: extractProfile(session.user),
            token: session.access_token,
            status: "authenticated",
          });
        } else {
          // Either signed out, or signed in with no email — treat as anonymous.
          if (session && !session.user.email) {
            void supabase.auth.signOut();
          }
          useSession.getState()._set({ user: null, token: null, status: "anonymous" });
        }
      });
    }

    export async function signInWithProvider(provider: "github" | "google", next = "/") {
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    }

    export async function signOut() {
      await supabase.auth.signOut();
    }
    ```
  - **`apps/web/src/lib/api.ts`:**
    ```ts
    import { supabase } from "./supabase";
    import { useSession } from "./auth";
    import { env } from "./env";
    import type { ErrorEnvelope } from "@rumi/protocol";

    export class ApiError extends Error {
      constructor(public code: string, message: string, public status: number) { super(message); }
    }

    interface FetchOpts extends Omit<RequestInit, "body"> { body?: unknown; _retried?: boolean }

    export async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
      const token = useSession.getState().token;
      const headers = new Headers(opts.headers);
      headers.set("Content-Type", "application/json");
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const res = await fetch(`${env.VITE_API_URL}${path}`, {
        ...opts,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      if (res.status === 401 && !opts._retried) {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session) {
          useSession.getState()._set({ token: data.session.access_token });
          return apiFetch<T>(path, { ...opts, _retried: true });
        }
        // Refresh failed — sign out and short-circuit. The signOut triggers
        // onAuthStateChange → _authed.beforeLoad redirect to /sign-in.
        // Throwing here prevents the caller from acting on a stale 401 body.
        await supabase.auth.signOut();
        throw new ApiError("unauthorized", "Session expired", 401);
      }
      if (res.status === 204) return undefined as T;
      const json = await res.json();
      if (!res.ok) {
        const body = json as ErrorEnvelope;
        throw new ApiError(body.error.code, body.error.message, res.status);
      }
      return json as T;
    }
    ```
  - **Wire `initAuth` in `main.tsx`:**
    ```ts
    import { initAuth } from "@/lib/auth";
    initAuth().then(() => {
      // Existing createRoot render call here.
    });
    ```
    (Awaiting `initAuth` before mount avoids a flash of "anonymous" UI on reload.)
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - `apps/web/src/lib/auth.test.ts` covers `extractProfile` for GitHub fixture (`{ name: "Justin", user_name: "jcordova", avatar_url: "..." }`), Google fixture (`{ full_name: "...", picture: "..." }`), and empty-metadata fallback to email-prefix.
  - `bun test apps/web/src/lib/auth.test.ts` passes.

## Task 10: TanStack Router — `__root`, `_authed`, `sign-in`, `auth.callback` routes

- **What:** Replace existing root, add the four new routes, plus `_authed` pathless layout with `beforeLoad` guard.
- **Why:** Auth gating at the route layer; OAuth callback must be a flat sibling of `_authed` to avoid the auth-guard infinite loop.
- **How:**
  - **Update `apps/web/src/routes/__root.tsx`:**
    ```tsx
    import { Outlet, createRootRoute } from "@tanstack/react-router";
    import { useTheme } from "next-themes";
    import { Toaster } from "@/components/ui/sonner";
    import { TooltipProvider } from "@/components/ui/tooltip";
    import { ThemeProvider } from "@/lib/theme";

    export const Route = createRootRoute({
      component: () => (
        <ThemeProvider>
          <TooltipProvider delayDuration={150}>
            <Outlet />
            <ThemedToaster />
          </TooltipProvider>
        </ThemeProvider>
      ),
    });

    // Sonner toaster bound to next-themes + design tokens (per auth-and-rooms.md).
    function ThemedToaster() {
      const { theme } = useTheme();
      return (
        <Toaster
          theme={theme as "light" | "dark" | "system"}
          position="bottom-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: "group bg-background text-foreground border-border shadow-lg",
              description: "text-muted-foreground",
              actionButton: "bg-primary text-primary-foreground",
              cancelButton: "bg-muted text-muted-foreground",
            },
          }}
        />
      );
    }
    ```
    Note: `richColors` is dropped from the Sonner config — token-bound class names handle styling instead, so theme switches don't flash.

  - **Create `apps/web/src/routes/sign-in.tsx`:** per `auth-and-rooms.md` "/sign-in" spec — full-bleed gradient background, centered card with brand tile, headline, subtitle, and OAuth buttons.
    ```tsx
    import { createFileRoute } from "@tanstack/react-router";
    import { Sparkles } from "lucide-react";
    import { FaGithub } from "react-icons/fa6";
    import { FcGoogle } from "react-icons/fc";
    import { Button } from "@/components/ui/button";
    import { signInWithProvider } from "@/lib/auth";

    export const Route = createFileRoute("/sign-in")({
      component: SignInPage,
      validateSearch: (s) => ({ next: typeof s.next === "string" ? s.next : "/" }),
    });

    function SignInPage() {
      const { next } = Route.useSearch();
      return (
        <div className="relative min-h-screen grid place-items-center p-6 bg-gradient-subtle overflow-hidden">
          <div className="absolute inset-0 grid-dots opacity-30 pointer-events-none" />
          <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface/80 backdrop-blur-md p-8 shadow-lg animate-fade-in">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand shadow-float">
                <Sparkles className="h-5 w-5 text-primary-foreground" strokeWidth={2.5} />
              </div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-balance">
                Welcome to Rumi
              </h1>
              <p className="text-sm text-muted-foreground">
                Sign in to start collaborating.
              </p>
              <div className="flex flex-col gap-2 w-full mt-2">
                <Button
                  variant="outline"
                  className="w-full h-10"
                  onClick={() => signInWithProvider("github", next)}
                >
                  <FaGithub className="h-4 w-4 mr-2" />
                  Sign in with GitHub
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-10"
                  onClick={() => signInWithProvider("google", next)}
                >
                  <FcGoogle className="h-4 w-4 mr-2" />
                  Sign in with Google
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    ```
    Add `react-icons` to web deps in Task 2 (`bun --cwd apps/web add react-icons`) — needed for the multi-color Google logo, since lucide is monochrome only.
  - **Create `apps/web/src/routes/auth.callback.tsx`:**
    ```tsx
    import { createFileRoute, useNavigate } from "@tanstack/react-router";
    import { useEffect } from "react";
    import { toast } from "sonner";
    import { supabase } from "@/lib/supabase";

    export const Route = createFileRoute("/auth/callback")({
      component: CallbackPage,
      validateSearch: (s) => ({
        code: typeof s.code === "string" ? s.code : undefined,
        next: typeof s.next === "string" ? s.next : "/",
        error_description: typeof s.error_description === "string" ? s.error_description : undefined,
      }),
    });

    function CallbackPage() {
      const { code, next, error_description } = Route.useSearch();
      const nav = useNavigate();
      useEffect(() => {
        (async () => {
          if (error_description || !code) {
            toast.error("Sign-in failed — please try again.");
            nav({ to: "/sign-in" });
            return;
          }
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            toast.error("Sign-in failed — please try again.");
            nav({ to: "/sign-in" });
          } else {
            nav({ to: next });
          }
        })();
      }, [code, error_description, next, nav]);

      return (
        <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">
          Signing in…
        </div>
      );
    }
    ```
  - **Create `apps/web/src/routes/_authed.tsx`:**
    ```tsx
    import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
    import { useSession } from "@/lib/auth";

    export const Route = createFileRoute("/_authed")({
      beforeLoad: ({ location }) => {
        const { status } = useSession.getState();
        if (status === "anonymous") {
          throw redirect({ to: "/sign-in", search: { next: location.pathname } });
        }
      },
      component: () => <Outlet />,
    });
    ```
  - The TanStack Router file-based generator picks up these new routes automatically when `vite` runs.
- **Verify:**
  - `bun --cwd apps/web run dev`; visit `/` (now under `_authed` per Task 11) — redirects to `/sign-in?next=/`.
  - Click "Sign in with GitHub" — redirects to GitHub. After successful OAuth, lands at `/auth/callback?code=...`, briefly shows "Signing in…", then redirects to `/`.

## Task 11: Web — dashboard `/` and room shell `/r/$slug`

- **What:** `_authed/index.tsx` (dashboard with `<TopBar />`, `<EmptyState />`, `<RoomCard />` grid, dialogs); `_authed/r.$slug.tsx` (room shell with placeholder for editor).
- **Why:** End-to-end of the user-facing surface for this phase. The room shell is intentionally minimal — realtime-markdown fills in the editor.
- **How:**
  - **Delete** `apps/web/src/routes/index.tsx` (the design-system demo route).
    With this file removed, hitting `/` resolves to `_authed/index.tsx` below — which is the dashboard, gated by the `_authed` `beforeLoad` that redirects anonymous users to `/sign-in`. (Note: TanStack Router file-based routing treats `_authed/index.tsx` as the index of the `_authed` layout. Since `_authed` is *pathless*, the index renders at `/`.)
  - Create `apps/web/src/routes/_authed/index.tsx`:
    ```tsx
    import { createFileRoute } from "@tanstack/react-router";
    import { useEffect, useState } from "react";
    import { TopBar } from "@/components/topbar";
    import { RoomCard } from "@/components/rooms/room-card";
    import { EmptyState } from "@/components/rooms/empty-state";
    import { CreateRoomDialog } from "@/components/rooms/create-room-dialog";
    import { Button } from "@/components/ui/button";
    import { Skeleton } from "@/components/ui/skeleton";
    import { useRoomsStore } from "@/stores/rooms";

    export const Route = createFileRoute("/_authed/")({
      component: DashboardPage,
    });

    function DashboardPage() {
      const { rooms, status, fetch } = useRoomsStore();
      const [createOpen, setCreateOpen] = useState(false);

      useEffect(() => { fetch(); }, [fetch]);

      return (
        <div className="min-h-screen flex flex-col">
          <TopBar />
          <main className="flex-1 max-w-5xl w-full mx-auto p-6 space-y-6">
            <header className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold tracking-tight">Your rooms</h1>
              <Button onClick={() => setCreateOpen(true)}>New room</Button>
            </header>

            {status === "loading" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2].map((n) => <Skeleton key={n} className="h-28 rounded-lg" />)}
              </div>
            )}
            {status === "ready" && rooms.length === 0 && <EmptyState onCreate={() => setCreateOpen(true)} />}
            {status === "ready" && rooms.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {rooms.map((r) => <RoomCard key={r.id} room={r} />)}
              </div>
            )}
          </main>
          <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} />
        </div>
      );
    }
    ```
  - Create `apps/web/src/routes/_authed/r.$slug.tsx`:
    ```tsx
    import { createFileRoute, useNavigate } from "@tanstack/react-router";
    import { useEffect } from "react";
    import { toast } from "sonner";
    import { TopBar } from "@/components/topbar";
    import { apiFetch, ApiError } from "@/lib/api";
    import type { GetRoomResponse } from "@rumi/protocol";

    function RoomError({ error }: { error: unknown }) {
      const nav = useNavigate();
      useEffect(() => {
        const code = error instanceof ApiError ? error.code : "server_error";
        const msg =
          code === "not_found" ? "Room not found" :
          code === "forbidden" ? "You don't have access to this room" :
          "Something went wrong";
        toast.error(msg);
        nav({ to: "/" });
      }, [error, nav]);
      return null;
    }

    export const Route = createFileRoute("/_authed/r/$slug")({
      loader: async ({ params }) => {
        return apiFetch<GetRoomResponse>(`/api/rooms/${params.slug}`);
      },
      errorComponent: RoomError,
      component: RoomPage,
    });

    function RoomPage() {
      const { room, tabs } = Route.useLoaderData();
      // The realtime-markdown phase fills in the tab bar + editor; here we just
      // confirm the loader returns a non-empty tab list (the seeded "Welcome" tab).
      return (
        <div className="min-h-screen flex flex-col">
          <TopBar room={room} />
          <main className="flex-1 grid place-items-center text-muted-foreground text-sm">
            Editor will mount here in the realtime-markdown phase.
            <br />
            <span className="text-[11px] mt-2">
              {tabs.length} tab{tabs.length === 1 ? "" : "s"} loaded · first: {tabs[0]?.name}
            </span>
          </main>
        </div>
      );
    }
    ```
- **Verify:** Build flows pass after Task 12 components exist; deferred to Task 13's verification.

## Task 12: Web — components (`TopBar`, `RoomCard`, `EmptyState`, dialogs) + rooms store

- **What:** All components referenced by Tasks 11.
- **Why:** Without these the routes don't compile. Bundling them into one task because they're tightly coupled (all consume the `Room` type from protocol; all render shadcn primitives).
- **How:**
  - **`apps/web/src/stores/rooms.ts`:** Zustand store fetching `/api/rooms`:
    ```ts
    import { create } from "zustand";
    import { apiFetch } from "@/lib/api";
    import type { ListRoomsResponse, Room } from "@rumi/protocol";

    type RoomEntry = Room & { pendingInvite: boolean };

    interface RoomsState {
      rooms: RoomEntry[];
      status: "idle" | "loading" | "ready" | "error";
      fetch: () => Promise<void>;
      addRoom: (room: Room) => void;
      removeRoom: (slug: string) => void;
      updateRoom: (room: Room) => void;
    }

    export const useRoomsStore = create<RoomsState>((set, get) => ({
      rooms: [],
      status: "idle",
      fetch: async () => {
        set({ status: "loading" });
        try {
          const data = await apiFetch<ListRoomsResponse>("/api/rooms");
          set({ rooms: data.rooms, status: "ready" });
        } catch {
          set({ status: "error" });
        }
      },
      addRoom: (room) => set({ rooms: [{ ...room, pendingInvite: false }, ...get().rooms] }),
      removeRoom: (slug) => set({ rooms: get().rooms.filter((r) => r.slug !== slug) }),
      updateRoom: (room) => set({
        rooms: get().rooms.map((r) => r.slug === room.slug ? { ...r, ...room } : r),
      }),
    }));
    ```
  - **`apps/web/src/components/topbar.tsx`:** Two-mode component (dashboard vs room) per `auth-and-rooms.md` "TopBar" section. Layout `h-14 border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-10 flex items-center px-4 gap-3`.

    Always present (left): brand tile + wordmark.
    ```tsx
    <Link to="/" className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-brand">
        <Sparkles className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <span className="font-display text-[15px] font-semibold tracking-tight">Rumi</span>
    </Link>
    ```

    Dashboard mode (when `!room`): right side has the avatar dropdown only.
    ```tsx
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full ml-auto">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.avatarUrl ?? undefined} alt={user?.displayName} />
            <AvatarFallback>{user?.displayName?.[0] ?? "?"}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="font-medium pointer-events-none opacity-70">
          {user?.displayName}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    ```

    Room mode (when `room` is set): vertical 1px divider after wordmark, then **inline editable room title**, then on the right (in order): "Live" pill slot (props from realtime-markdown), presence avatar slot, Share button, settings dropdown.

    Inline editable room title — internal state pattern:
    ```tsx
    function RoomTitle({ room }: { room: Room }) {
      const [editing, setEditing] = useState(false);
      const title = room.name?.trim() || room.slug;
      const [draft, setDraft] = useState(title);
      const inputRef = useRef<HTMLInputElement>(null);
      const updateRoom = useRoomsStore((s) => s.updateRoom);

      useEffect(() => { setDraft(title); }, [title]);
      useEffect(() => {
        if (editing) {
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }, [editing]);

      async function commit() {
        const next = draft.trim();
        if (next !== (room.name ?? "")) {
          // Empty submit clears name; server falls back to slug-as-title.
          const updated = await apiFetch<UpdateRoomResponse>(
            `/api/rooms/${room.slug}`,
            { method: "PATCH", body: { name: next || null } },
          );
          updateRoom(updated.room);
        }
        setEditing(false);
      }

      if (editing) {
        return (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setDraft(title); setEditing(false); }
            }}
            className="border border-border bg-surface rounded-md px-2.5 py-1 text-sm font-medium ring-2 ring-ring/30 outline-none"
          />
        );
      }
      return (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex items-center gap-2 text-sm font-medium hover:bg-muted/60 rounded-md px-2 py-1 transition-colors"
        >
          {title}
          <span className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            rename
          </span>
        </button>
      );
    }
    ```

    Live pill slot (controlled by realtime-markdown's `status` prop; renders only when `status === "connected"`):
    ```tsx
    {status === "connected" && (
      <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
        <span className="text-[11px] font-medium text-success">Live</span>
      </div>
    )}
    ```

    Share button (per `auth-and-rooms.md`):
    ```tsx
    function ShareButton({ room }: { room: Room }) {
      const [copied, setCopied] = useState(false);
      const Icon = copied ? Check : Link2;
      const desc = room.visibility === "private"
        ? "Invitees only."
        : "Anyone with this link can join.";

      async function handleCopy() {
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast.success("Link copied", { description: desc });
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Could not copy link");
        }
      }

      return (
        <Button
          onClick={handleCopy}
          className="bg-foreground text-background hover:bg-foreground/90 shadow-sm hover:shadow-md transition-all h-8 px-3"
        >
          <Icon className="h-3.5 w-3.5 mr-1.5" />
          Share
        </Button>
      );
    }
    ```

    Settings dropdown (lucide `Settings2` trigger):
    ```tsx
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon"><Settings2 className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">Room</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => triggerRename()}>Rename room</DropdownMenuItem>
        <DropdownMenuItem onSelect={handleCopy}>Copy invite link</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => setTheme("light")}>Light</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme("dark")}>Dark</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme("system")}>System</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    ```

    Items deliberately omitted vs the prototype: Permissions (no role UI in MVP), Compact density (no implementation), Leave room (no member-management endpoints in MVP). The `triggerRename()` reference focuses the inline-rename input via a ref/signal exposed by `RoomTitle`; implement via a small ref-callback pattern or a simple state hoist in TopBar.

    Add `lucide-react` icons to the install list if not already present: `Sparkles`, `Link2`, `Check`, `Settings2`. shadcn Tooltip + DropdownMenu (with Sub/Label/Separator) are required.

  - **`apps/web/src/components/rooms/room-card.tsx`:** Card with inline-editable title (same pattern as the TopBar `RoomTitle`), visibility badge, owner pip, pending-invite badge, "..." menu with **Delete only** for owners (rename is inline).
    ```tsx
    import { useEffect, useRef, useState } from "react";
    import { Link, useNavigate } from "@tanstack/react-router";
    import { MoreHorizontal, Lock, Globe } from "lucide-react";
    import {
      DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
    } from "@/components/ui/dropdown-menu";
    import { Button } from "@/components/ui/button";
    import { apiFetch } from "@/lib/api";
    import { useSession } from "@/lib/auth";
    import { useRoomsStore } from "@/stores/rooms";
    import type { Room, UpdateRoomResponse } from "@rumi/protocol";
    import { DeleteRoomDialog } from "./delete-room-dialog";

    export function RoomCard({ room }: { room: Room & { pendingInvite?: boolean } }) {
      const { user } = useSession();
      const isOwner = user?.id === room.ownerId;
      const updateRoom = useRoomsStore((s) => s.updateRoom);
      const [editing, setEditing] = useState(false);
      const title = room.name?.trim() || room.slug;
      const [draft, setDraft] = useState(title);
      const inputRef = useRef<HTMLInputElement>(null);
      const [deleteOpen, setDeleteOpen] = useState(false);

      useEffect(() => { setDraft(title); }, [title]);
      useEffect(() => {
        if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
      }, [editing]);

      async function commit() {
        const next = draft.trim();
        if (next !== (room.name ?? "")) {
          const res = await apiFetch<UpdateRoomResponse>(
            `/api/rooms/${room.slug}`,
            { method: "PATCH", body: { name: next || null } },
          );
          updateRoom(res.room);
        }
        setEditing(false);
      }

      return (
        <div className="group relative rounded-xl border border-border bg-surface p-4 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md transition-all duration-200">
          <div className="flex items-start justify-between gap-2">
            <Link
              to="/r/$slug"
              params={{ slug: room.slug }}
              className="flex-1 min-w-0"
              onDoubleClick={isOwner ? (e) => { e.preventDefault(); setEditing(true); } : undefined}
            >
              {editing ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") { setDraft(title); setEditing(false); }
                  }}
                  onClick={(e) => e.preventDefault()}
                  className="w-full border border-border bg-surface rounded-md px-2 py-1 text-sm font-medium ring-2 ring-ring/30 outline-none"
                />
              ) : (
                <h3 className="text-sm font-medium truncate">{title}</h3>
              )}
            </Link>
            {isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => setDeleteOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    Delete room
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
            {room.visibility === "private" ? (
              <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> Private</span>
            ) : (
              <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> Anyone with link</span>
            )}
            {isOwner && (
              <span className="rounded-full bg-accent text-accent-foreground px-1.5 py-0.5 text-[10px] font-medium">Owner</span>
            )}
            {room.pendingInvite && (
              <span className="rounded-full bg-warning/20 text-warning px-1.5 py-0.5 text-[10px] font-medium">Pending invite</span>
            )}
          </div>
          <DeleteRoomDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            slug={room.slug}
          />
        </div>
      );
    }
    ```

  - **`apps/web/src/components/rooms/empty-state.tsx`:** Per `auth-and-rooms.md` "EmptyState" spec.
    ```tsx
    export function EmptyState({ onCreate }: { onCreate: () => void }) {
      return (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-subtle py-16 px-8 grid-dots animate-fade-in">
          <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-background to-transparent pointer-events-none" />
          <div className="relative mx-auto flex max-w-md flex-col items-center text-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand shadow-float">
              <Sparkles className="h-5 w-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-balance">
              Start your first room
            </h2>
            <p className="text-muted-foreground text-balance">
              Spin up a shared room. Anyone with the link will see your edits in real time.
            </p>
            <Button onClick={onCreate} className="h-10 px-5 rounded-md mt-2">
              Create room
            </Button>
            <p className="text-[12px] text-muted-foreground mt-2">
              Tip — you can create up to <span className="font-medium text-foreground">3 rooms</span> on the free plan.
            </p>
          </div>
        </div>
      );
    }
    ```

  - **`apps/web/src/components/rooms/create-room-dialog.tsx`:** shadcn `Dialog` with optional `name`, visibility radio, `linkCanEdit` switch.
    ```tsx
    import { useState } from "react";
    import { useNavigate } from "@tanstack/react-router";
    import { toast } from "sonner";
    import {
      Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
    } from "@/components/ui/dialog";
    import { Button } from "@/components/ui/button";
    import { Input } from "@/components/ui/input";
    import { Label } from "@/components/ui/label";
    import { apiFetch } from "@/lib/api";
    import { useRoomsStore } from "@/stores/rooms";
    import { CreateRoomBody, type CreateRoomResponse } from "@rumi/protocol";

    interface Props { open: boolean; onOpenChange: (v: boolean) => void; }

    export function CreateRoomDialog({ open, onOpenChange }: Props) {
      const nav = useNavigate();
      const addRoom = useRoomsStore((s) => s.addRoom);
      const [name, setName] = useState("");
      const [visibility, setVisibility] = useState<"private" | "link">("link");
      const [linkCanEdit, setLinkCanEdit] = useState(true);
      const [submitting, setSubmitting] = useState(false);

      async function submit() {
        const body = CreateRoomBody.parse({
          name: name.trim() || undefined,
          visibility,
          linkCanEdit: visibility === "link" ? linkCanEdit : undefined,
        });
        setSubmitting(true);
        try {
          const res = await apiFetch<CreateRoomResponse>("/api/rooms", {
            method: "POST", body,
          });
          addRoom(res.room);
          toast.success("Room created");
          onOpenChange(false);
          nav({ to: "/r/$slug", params: { slug: res.room.slug } });
        } catch (err: any) {
          toast.error(err?.message ?? "Couldn't create room");
        } finally {
          setSubmitting(false);
        }
      }

      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogHeader><DialogTitle>New room</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="room-name">Name (optional)</Label>
                <Input
                  id="room-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Leave blank for a memorable slug"
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label>Visibility</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={visibility === "link" ? "default" : "outline"}
                    onClick={() => setVisibility("link")}
                    className="flex-1"
                  >Anyone with link</Button>
                  <Button
                    type="button"
                    variant={visibility === "private" ? "default" : "outline"}
                    onClick={() => setVisibility("private")}
                    className="flex-1"
                  >Private</Button>
                </div>
              </div>
              {visibility === "link" && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={linkCanEdit}
                    onChange={(e) => setLinkCanEdit(e.target.checked)}
                  />
                  Allow link visitors to edit
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
    ```

  - **`apps/web/src/components/rooms/delete-room-dialog.tsx`:** shadcn `AlertDialog`.
    ```tsx
    import { useState } from "react";
    import { toast } from "sonner";
    import {
      AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
      AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    } from "@/components/ui/alert-dialog";
    import { apiFetch } from "@/lib/api";
    import { useRoomsStore } from "@/stores/rooms";

    interface Props { open: boolean; onOpenChange: (v: boolean) => void; slug: string; }

    export function DeleteRoomDialog({ open, onOpenChange, slug }: Props) {
      const removeRoom = useRoomsStore((s) => s.removeRoom);
      const [submitting, setSubmitting] = useState(false);

      async function confirm() {
        setSubmitting(true);
        try {
          await apiFetch(`/api/rooms/${slug}`, { method: "DELETE" });
          removeRoom(slug);
          toast.success("Room deleted");
          onOpenChange(false);
        } catch (err: any) {
          toast.error(err?.message ?? "Couldn't delete room");
        } finally {
          setSubmitting(false);
        }
      }

      return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this room?</AlertDialogTitle>
              <AlertDialogDescription>
                This soft-deletes the room and removes it from your dashboard.
                The room's content is preserved but inaccessible.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirm}
                disabled={submitting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {submitting ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    ```

  - **`apps/web/src/components/rooms/invite-dialog.tsx`:** email input + pending invites list with revoke.
    ```tsx
    import { useEffect, useState } from "react";
    import { toast } from "sonner";
    import { X } from "lucide-react";
    import {
      Dialog, DialogContent, DialogHeader, DialogTitle,
    } from "@/components/ui/dialog";
    import { Button } from "@/components/ui/button";
    import { Input } from "@/components/ui/input";
    import { Label } from "@/components/ui/label";
    import { apiFetch } from "@/lib/api";
    import {
      CreateInviteBody,
      type CreateInviteResponse,
      type ListInvitesResponse,
      type RoomInvite,
    } from "@rumi/protocol";

    interface Props { open: boolean; onOpenChange: (v: boolean) => void; slug: string; }

    export function InviteDialog({ open, onOpenChange, slug }: Props) {
      const [invites, setInvites] = useState<RoomInvite[]>([]);
      const [email, setEmail] = useState("");
      const [submitting, setSubmitting] = useState(false);

      useEffect(() => {
        if (!open) return;
        apiFetch<ListInvitesResponse>(`/api/rooms/${slug}/invites`).then((r) => setInvites(r.invites));
      }, [open, slug]);

      async function send() {
        const body = CreateInviteBody.parse({ email });
        setSubmitting(true);
        try {
          const res = await apiFetch<CreateInviteResponse>(
            `/api/rooms/${slug}/invites`,
            { method: "POST", body },
          );
          setInvites((cur) => [res.invite, ...cur]);
          setEmail("");
          toast.success("Invite sent");
        } catch (err: any) {
          toast.error(err?.message ?? "Couldn't send invite");
        } finally {
          setSubmitting(false);
        }
      }

      async function revoke(id: string) {
        await apiFetch(`/api/rooms/${slug}/invites/${id}`, { method: "DELETE" });
        setInvites((cur) => cur.filter((i) => i.id !== id));
      }

      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogHeader><DialogTitle>Invite to room</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <div className="flex gap-2">
                  <Input
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <Button onClick={send} disabled={submitting || !email}>Send</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tell them to sign in with this email to join the room.
                </p>
              </div>
              {invites.length > 0 && (
                <div className="space-y-2">
                  <Label>Pending invites</Label>
                  <ul className="space-y-1">
                    {invites.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-sm">
                        <span>{inv.invitedEmail}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => revoke(inv.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      );
    }
    ```

  - **No `RenameRoomDialog`** — both dashboard cards and the in-room TopBar use inline rename (click/double-click to edit; commit on blur/Enter; Escape resets the draft and exits; empty value falls back to slug-as-title). Per `auth-and-rooms.md` "Note: there is no RenameRoomDialog."

  - All dialog forms validate against the protocol Zod schemas before submitting.
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - `bun --cwd apps/web run dev`; sign in with GitHub against your Supabase project.
  - Click "New room" → fill form → land on `/r/wispy-falcon-42` (or similar). Room name renders in TopBar; placeholder "Editor will mount here… · 1 tab loaded · first: Welcome" message renders.
  - Click the room title in the TopBar → input appears with text selected; type a new name + Enter → title updates.
  - Press Escape mid-edit → draft resets to current title.
  - Back to `/`; the room appears in the grid.
  - Double-click the title on a RoomCard → input appears; rename inline; Enter commits without reload.
  - "..." menu → Delete → confirm → card disappears.
  - Open a second browser, sign in as a different Supabase user, paste the link-room URL → auto-joins, sees the room shell.

## Task 13: Manual verification flow + pre-commit gate

- **What:** Run a smaller version of the realtime-markdown verification flow that's actually executable in this phase, then the pre-commit gate.
- **Why:** Catches integration issues that mocked tests miss. Manual verification is our integration-test substitute.
- **How:**
  - With the dev server running and signed in:
    1. Create a room with default settings → land in room shell, see slug-as-title in the TopBar; "1 tab loaded · first: Welcome" placeholder text confirms the seeded tab.
    2. Back to dashboard; double-click the title on the RoomCard, rename it inline → title updates on the card, persists on reload.
    3. Sign in as user-2 (incognito + different OAuth account) and paste the link → auto-joins, sees the room shell.
    4. As owner, PATCH `visibility=private` via the API directly (no UI for this in MVP):
       ```bash
       curl -X PATCH http://localhost:3000/api/rooms/<slug> \
         -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
         -d '{"visibility":"private"}'
       ```
    5. As user-3 (third Supabase account), paste the URL → 403 redirect to `/`.
    6. As owner, invite user-3's email via the InviteDialog (built in Task 12).
    7. As user-3, refresh dashboard → sees the room with "pending invite" badge → click → joined → in room shell.
    8. As owner, soft-delete the room → it disappears from your dashboard.
    9. As user-2 (still signed in but on dashboard, not in the room), refresh → room is gone from their list too.
  - From repo root:
    - `bun run check`
    - `bun run typecheck`
    - `bun test apps packages`
- **Verify:** All 9 manual steps succeed without errors. All three commands exit 0.

---

## Suggested commit points

Plans are disposable per CLAUDE.md, but commits should be feature-scoped. Suggested checkpoints if you prefer smaller diffs:

- **After Task 4** (DB schema + first migration applied) — protocol + schema land cleanly.
- **After Task 7** (server end-to-end with mocked tests passing) — backend ships independently.
- **After Task 13** (manual verification + pre-commit gate green) — full phase complete.

Single-commit also fine: this whole phase is "feat: auth + rooms (Pattern B permissions)."
