# Realtime Markdown Plan

> **Goal:** Implement the unified Tab editor (text/code/markdown via CodeMirror 6 + Shiki + a markdown preview pipeline), the per-room tab bar with create/rename/close + 3-tab cap UI, server-side tab CRUD endpoints, per-tab Yjs persistence in a `tab_documents` table, and Hocuspocus mounted on the Fastify port via HTTP-upgrade hijack. Drawing tab is a separate plan (`drawing-plan.md`) that consumes this plan's tab infrastructure.
> **Spec:** [docs/SPEC.md](../SPEC.md)
> **Design:** [docs/designs/realtime-markdown.md](../designs/realtime-markdown.md)
> **Depends on:** `auth-and-rooms-plan.md` complete (`verifyJwt`, `tabs` table seeded with the Welcome row on `POST /api/rooms`, `GetRoomResponse.tabs[]`, room shell route, `closeConnections` decorator stub, `TabSummary` protocol type).

> **Lint convention:** Same `as any` rule as auth-and-rooms — add `// biome-ignore lint/suspicious/noExplicitAny: <reason>` above each cast during execute. Hocuspocus's `onAuthenticated` payload and `Server.configure` typings drive most of these.

---

## Task 1: Install dependencies + drop `@fastify/websocket`

- **What:** Add the missing CodeMirror language packs, Shiki, the markdown render pipeline, and tldraw-friendly Yjs deps; remove the unused `@fastify/websocket` from scaffolding.
- **Why:** The unified Tab editor needs language packs + Shiki + a markdown renderer with sanitization. We use HTTP-upgrade hijack, not the Fastify WS plugin.
- **How:**
  - **`apps/server/`:**
    - Remove `@fastify/websocket` from `dependencies`.
    - **Add `WS_PUBLIC_ORIGIN` to the env shape.** Edit `apps/server/src/lib/env.ts` Zod schema to include `WS_PUBLIC_ORIGIN: z.string().url().optional()`. Add to `apps/server/.env.example` with a comment:
      ```
      # WS_PUBLIC_ORIGIN=wss://api.example.com  # production only; dev leaves unset and CSP uses 'self'
      ```
    - **Update Helmet's `connect-src` CSP** in `apps/server/src/server.ts` (the helmet config from auth-and-rooms Task 7). Find:
      ```ts
      "connect-src": ["'self'", supabaseOrigin],
      ```
      Replace with:
      ```ts
      const wsOrigins = env.WS_PUBLIC_ORIGIN ? [env.WS_PUBLIC_ORIGIN] : [];
      // ...
      "connect-src": ["'self'", supabaseOrigin, ...wsOrigins],
      ```
      (Hoist the `wsOrigins` declaration above the helmet `register` call.) Without this, browsers block the WS handshake in production where CSP is enforced; in dev, the server hijacks Fastify's port so `'self'` covers the WS origin.
  - **`apps/web/`:**
    - Add to `dependencies`:
      - `@codemirror/language@^6.10.0` (HighlightStyle, syntaxHighlighting)
      - `@codemirror/commands@^6.7.0` (history, defaultKeymap, historyKeymap)
      - `@codemirror/lang-javascript@^6.2.0` (TS/JS/JSX)
      - `@codemirror/lang-python@^6.1.0`
      - `@codemirror/lang-go@^6.0.0`
      - `@codemirror/lang-rust@^6.0.0`
      - `@codemirror/lang-json@^6.0.0`
      - `@codemirror/lang-html@^6.4.0`
      - `@codemirror/lang-css@^6.2.0`
      - `shiki@^1.0.0`
      - `unified@^11.0.0`
      - `remark-parse@^11.0.0`
      - `remark-gfm@^4.0.0`
      - `remark-rehype@^11.0.0`
      - `rehype-sanitize@^6.0.0`
      - `rehype-stringify@^10.0.0`
      - `@shikijs/rehype@^1.0.0` (rehype transformer for fenced code blocks)
    - `@lezer/highlight` is a transitive dep of `@codemirror/language` — no explicit add unless typecheck complains.
  - Run `bun install` from repo root.
- **Verify:** `bun install` exits 0; `bun run typecheck` from root still passes.

---

## Task 2: Add `tab_documents` table + Drizzle migration

- **What:** Extend the schema with `tab_documents`, generate a sequential migration, run it.
- **Why:** Per-tab persistence target for Yjs binary state. Lives in this phase because only this phase actually writes to it (the `tabs` row was already created in auth-and-rooms; binary state is a separate table per the design doc's split).
- **How:**
  - Edit `apps/server/src/db/schema.ts`. Append:
    ```ts
    import { customType } from "drizzle-orm/pg-core";

    const bytea = customType<{ data: Uint8Array; default: false }>({
      dataType: () => "bytea",
    });

    export const tabDocuments = pgTable("tab_documents", {
      tabId: uuid("tab_id")
        .primaryKey()
        .references(() => tabs.id, { onDelete: "cascade" }),
      state: bytea("state").notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    });
    ```
  - Run `bun --cwd apps/server run db:generate` — produces a new sequential migration file (e.g., `src/db/migrations/0001_add_tab_documents.sql`). Inspect it; should only `CREATE TABLE tab_documents` and the FK, not modify the auth-and-rooms migration.
  - Run `bun --cwd apps/server run db:migrate`.
- **Verify:**
  - New migration file committed.
  - `tab_documents` table exists in Supabase Studio.
  - `bun --cwd apps/server run typecheck` passes.

---

## Task 3: Persistence wrapper (`db/documents.ts`)

- **What:** `fetchDocument(tabId)` and `storeDocument(tabId, state)` — keyed on **tab id**, not room id or slug.
- **Why:** Hocuspocus's `Database` extension calls these per document; tests substitute mocks.
- **How:**
  - Create `apps/server/src/db/documents.ts`:
    ```ts
    import { eq } from "drizzle-orm";
    import { db } from "./client";
    import { tabDocuments } from "./schema";

    export async function fetchDocument(tabId: string): Promise<Uint8Array | null> {
      const rows = await db
        .select({ state: tabDocuments.state })
        .from(tabDocuments)
        .where(eq(tabDocuments.tabId, tabId))
        .limit(1);
      return rows[0]?.state ?? null;
    }

    export async function storeDocument(tabId: string, state: Uint8Array): Promise<void> {
      await db
        .insert(tabDocuments)
        .values({ tabId, state, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: tabDocuments.tabId,
          set: { state, updatedAt: new Date() },
        });
    }
    ```
- **Verify:**
  - `bun --cwd apps/server run typecheck` passes.
  - `apps/server/src/db/documents-roundtrip.test.ts`:
    ```ts
    import { describe, expect, it } from "bun:test";
    import * as Y from "yjs";
    describe("Yjs encode/decode", () => {
      it("round-trips a Y.Text document", () => {
        const a = new Y.Doc();
        a.getText("content").insert(0, "hello world");
        const bytes = Y.encodeStateAsUpdate(a);
        const b = new Y.Doc();
        Y.applyUpdate(b, bytes);
        expect(b.getText("content").toString()).toBe("hello world");
      });
      it("round-trips a Y.Map document (drawing-shape)", () => {
        const a = new Y.Doc();
        const m = a.getMap("tldraw");
        m.set("shape:1", { type: "rect", x: 10, y: 20 });
        const bytes = Y.encodeStateAsUpdate(a);
        const b = new Y.Doc();
        Y.applyUpdate(b, bytes);
        expect((b.getMap("tldraw").get("shape:1") as any).type).toBe("rect");
      });
    });
    ```
  - `bun test apps/server/src/db/documents-roundtrip.test.ts` passes.

---

## Task 4: Protocol — Tab CRUD schemas

- **What:** Add request/response Zod schemas for `POST/PATCH/DELETE /api/rooms/:slug/tabs`.
- **Why:** Server (Task 6) and web (Task 10) both consume these. The `TabSummary` type was added in auth-and-rooms; this task adds the body/response schemas around it.
- **How:**
  - In `packages/protocol/src/rooms.ts`, append:
    ```ts
    // Tab CRUD shapes
    export const CreateTabBody = z.object({
      type: TabType,
      language: z.string().nullable().optional(),
      name: z.string().trim().min(1).max(100).optional(),
    });
    export const UpdateTabBody = z.object({
      name: z.string().trim().max(100).optional(),
      language: z.string().nullable().optional(),
    });
    export const TabIdParams = z.object({
      slug: z.string().regex(/^[a-z0-9-]+$/).max(64),
      tabId: z.string().uuid(),
    });
    export const CreateTabResponse = z.object({ tab: TabSummary });
    export const UpdateTabResponse = z.object({ tab: TabSummary });

    // Add to ErrorCode union: "tab_limit_reached" and "last_tab"
    // (extend the existing enum in errors.ts; see Task 4.5).
    ```
  - **Task 4.5 — extend `ErrorCode`.** Add to `packages/protocol/src/errors.ts` two new members in the `ErrorCode` enum: `"tab_limit_reached"` and `"last_tab"`.
- **Verify:**
  - `bun --cwd packages/protocol run typecheck` passes.
  - `bun test packages/protocol` passes.

---

## Task 5: Server — tabs service (`rooms/tabs.service.ts`)

- **What:** Service-layer CRUD for tabs; cap enforcement; ordinal management; first-tab-delete rejection.
- **Why:** Routes (Task 6) stay thin; tests mock the Drizzle client.
- **How:**
  - Create `apps/server/src/rooms/tabs.service.ts`:
    ```ts
    import { and, eq, sql } from "drizzle-orm";
    import type { DbClient } from "@/db/client";
    import { rooms, roomMembers, tabs } from "@/db/schema";
    import { AppError, AuthError } from "@/lib/errors";

    const TAB_CAP = 3;

    export type TabsService = ReturnType<typeof createTabsService>;

    export function createTabsService(db: DbClient) {
      // Helper: returns the room + member rows; throws not_found / forbidden.
      async function authorize(slug: string, userId: string) {
        const room = await db.query.rooms.findFirst({
          where: and(eq(rooms.slug, slug), sql`${rooms.deletedAt} IS NULL`),
        });
        if (!room) throw new AuthError("not_found", "Room not found");
        const member = await db.query.roomMembers.findFirst({
          where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)),
        });
        if (!member) throw new AuthError("forbidden", "Not a member");
        const canEdit =
          member.role === "owner" ||
          (room.visibility === "link" && room.linkCanEdit) ||
          room.visibility === "private"; // private rooms always grant edit to members
        return { room, member, canEdit };
      }

      return {
        async listTabs(slug: string, userId: string) {
          const { room } = await authorize(slug, userId);
          return db.query.tabs.findMany({
            where: eq(tabs.roomId, room.id),
            orderBy: (t, { asc }) => [asc(t.ordinal)],
          });
        },

        async createTab(
          slug: string,
          userId: string,
          body: { type: "tab" | "drawing"; language?: string | null; name?: string },
        ) {
          const { room, canEdit } = await authorize(slug, userId);
          if (!canEdit) throw new AuthError("forbidden", "Read-only access");

          // Reject language on drawing tabs.
          if (body.type === "drawing" && body.language) {
            throw new AppError("validation_failed", "Drawing tabs cannot have a language", 422);
          }

          return db.transaction(async (tx) => {
            const [{ count }] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(tabs)
              .where(eq(tabs.roomId, room.id))
              .for("update"); // SELECT FOR UPDATE serializes inserts

            if (count >= TAB_CAP) {
              throw new AppError("tab_limit_reached", `Max ${TAB_CAP} tabs per room`, 422);
            }

            const ordinal = count; // contiguous: 0, 1, 2
            const [tab] = await tx
              .insert(tabs)
              .values({
                roomId: room.id,
                type: body.type,
                language: body.type === "tab" ? body.language ?? null : null,
                name: body.name?.trim() || (body.type === "drawing" ? "Drawing" : "Untitled"),
                ordinal,
              })
              .returning();

            return tab;
          });
        },

        async updateTab(
          slug: string,
          userId: string,
          tabId: string,
          body: { name?: string; language?: string | null },
        ) {
          const { room, canEdit } = await authorize(slug, userId);
          if (!canEdit) throw new AuthError("forbidden", "Read-only access");

          const tab = await db.query.tabs.findFirst({
            where: and(eq(tabs.id, tabId), eq(tabs.roomId, room.id)),
          });
          if (!tab) throw new AuthError("not_found", "Tab not found");

          // Validate language against tab type.
          if (body.language !== undefined && tab.type === "drawing" && body.language !== null) {
            throw new AppError("validation_failed", "Drawing tabs cannot have a language", 422);
          }

          const next: Partial<typeof tabs.$inferInsert> = { updatedAt: new Date() };
          if (body.name !== undefined) {
            const trimmed = body.name.trim();
            next.name = trimmed.length > 0 ? trimmed : "Untitled";
          }
          if (body.language !== undefined) {
            next.language = body.language;
          }

          const [updated] = await db
            .update(tabs)
            .set(next)
            .where(and(eq(tabs.id, tabId), eq(tabs.roomId, room.id)))
            .returning();
          return updated;
        },

        async deleteTab(slug: string, userId: string, tabId: string) {
          const { room, canEdit } = await authorize(slug, userId);
          if (!canEdit) throw new AuthError("forbidden", "Read-only access");

          return db.transaction(async (tx) => {
            const target = await tx.query.tabs.findFirst({
              where: and(eq(tabs.id, tabId), eq(tabs.roomId, room.id)),
            });
            if (!target) throw new AuthError("not_found", "Tab not found");

            const [{ count }] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(tabs)
              .where(eq(tabs.roomId, room.id));

            if (count <= 1) {
              throw new AppError("last_tab", "Cannot delete the last remaining tab", 422);
            }

            await tx.delete(tabs).where(eq(tabs.id, tabId));

            // Re-pack ordinals so they stay contiguous.
            await tx.execute(sql`
              UPDATE ${tabs}
              SET ordinal = ordinal - 1
              WHERE room_id = ${room.id} AND ordinal > ${target.ordinal}
            `);

            return { tabId, roomId: room.id };
          });
        },
      };
    }
    ```
  - Wire `tabsService` into `server.ts` next to `service`:
    ```ts
    import { createTabsService } from "@/rooms/tabs.service";
    // ...after `app.decorate("service", createService(db));`
    app.decorate("tabsService", createTabsService(db));
    ```
  - Update `apps/server/src/types.d.ts`:
    ```ts
    interface FastifyInstance {
      service: Service;
      tabsService: TabsService;
      // ...existing entries
    }
    ```
- **Verify:**
  - `apps/server/src/rooms/tabs.service.test.ts` — mocks `db`; covers cap enforcement, ordinal contiguity on insert/delete, drawing-language rejection, last-tab rejection, not-found, forbidden.
  - `bun test apps/server/src/rooms/tabs.service.test.ts` passes.

---

## Task 6: Server — tabs routes (`rooms/tabs.routes.ts`)

- **What:** `POST /api/rooms/:slug/tabs`, `PATCH /api/rooms/:slug/tabs/:tabId`, `DELETE /api/rooms/:slug/tabs/:tabId`. Each calls `closeConnections(tabId)` for delete (so live WS connections drop) and emits log events for create/update/delete.
- **Why:** End-to-end CRUD plus the cross-phase `closeConnections` contract for tabs.
- **How:**
  - Create `apps/server/src/rooms/tabs.routes.ts`:
    ```ts
    import type { FastifyPluginAsync } from "fastify";
    import { ZodTypeProvider } from "fastify-type-provider-zod";
    import {
      CreateTabBody, UpdateTabBody, SlugParam, TabIdParams,
      type TabSummary,
    } from "@rumi/protocol";
    import type { tabs as tabsTable } from "@/db/schema";

    export const tabsRoutes: FastifyPluginAsync = async (app) => {
      const typed = app.withTypeProvider<ZodTypeProvider>();

      typed.post("/:slug/tabs", { schema: { params: SlugParam, body: CreateTabBody } }, async (req, reply) => {
        const tab = await app.tabsService.createTab(req.params.slug, req.user!.id, req.body);
        app.log.info({ userId: req.user!.id, tabId: tab.id, type: tab.type }, "tab created");
        return reply.code(201).send({ tab: serializeTab(tab) });
      });

      typed.patch("/:slug/tabs/:tabId", { schema: { params: TabIdParams, body: UpdateTabBody } }, async (req) => {
        const tab = await app.tabsService.updateTab(
          req.params.slug, req.user!.id, req.params.tabId, req.body,
        );
        app.log.info({ userId: req.user!.id, tabId: tab.id }, "tab updated");
        return { tab: serializeTab(tab) };
      });

      typed.delete("/:slug/tabs/:tabId", { schema: { params: TabIdParams } }, async (req, reply) => {
        const { tabId } = await app.tabsService.deleteTab(
          req.params.slug, req.user!.id, req.params.tabId,
        );
        // Drop any live WS connections to that tab id.
        app.closeTabConnections(tabId);
        app.log.info({ userId: req.user!.id, tabId }, "tab deleted");
        return reply.code(204).send();
      });
    };

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
    ```
  - Register in `server.ts` (under the existing `/api/rooms` prefix):
    ```ts
    app.register(async (scope) => {
      scope.register(roomsRoutes);
      scope.register(tabsRoutes);
    }, { prefix: "/api/rooms" });
    ```
  - **Add a stub `closeTabConnections` decorator now** so the routes from this task typecheck before Task 8 swaps it for the real Hocuspocus-backed implementation. In `apps/server/src/server.ts`, alongside the existing `dropRoomConnections` stub from auth-and-rooms Task 7:
    ```ts
    // Stub: replaced in realtime-markdown Task 8 by the Hocuspocus-backed
    // implementation that calls hocuspocus.closeConnections(tabId).
    app.decorate("closeTabConnections", (_tabId: string) => {
      // No-op until Task 8.
    });
    ```
    Update `apps/server/src/types.d.ts` to declare the field:
    ```ts
    declare module "fastify" {
      interface FastifyInstance {
        // ...existing entries (service, tabsService, dropRoomConnections)
        closeTabConnections: (tabId: string) => void;
      }
    }
    ```
    Task 8 step 2 finds this stub line and replaces it with the real implementation.
- **Verify:**
  - `apps/server/src/rooms/tabs.routes.test.ts` — Fastify `app.inject()` with mocked `tabsService` and `closeTabConnections`. Cases:
    - POST hits `tab_limit_reached` at the 3rd tab.
    - POST `type='drawing'` with `language: "markdown"` returns 422 `validation_failed`.
    - PATCH `language` rejected for `type='drawing'`.
    - DELETE rejected when only one tab remains (`last_tab`).
    - DELETE calls `closeTabConnections(tabId)` exactly once after commit.
    - PATCH `name`-only does NOT call `closeTabConnections`.
  - `bun test apps/server/src/rooms/tabs.routes.test.ts` passes.

---

## Task 7: Server — Hocuspocus + persistence + auth hook (per-tab)

- **What:** `sync/hocuspocus.ts`, `sync/authorize.ts`, `sync/persistence.ts`, `sync/presence.ts` (awareness types). Auth hook resolves `tab_id → room_id → membership` per connection.
- **Why:** Core of the realtime feature, scoped to per-tab documents.
- **How:**
  - **`apps/server/src/sync/persistence.ts`:**
    ```ts
    import { Database } from "@hocuspocus/extension-database";
    import { fetchDocument, storeDocument } from "@/db/documents";

    export function buildDatabaseExtension() {
      return new Database({
        async fetch({ context }) {
          const tabId = context.tabId as string | undefined;
          if (!tabId) return null;
          return fetchDocument(tabId);
        },
        async store({ context, state }) {
          const tabId = context.tabId as string | undefined;
          if (!tabId) return;
          await storeDocument(tabId, state);
        },
      });
    }
    ```
    Default Hocuspocus debounce (2s idle, 10s max wait) — no override.
  - **`apps/server/src/sync/authorize.ts`:**
    ```ts
    import { and, eq, isNull } from "drizzle-orm";
    import type { onAuthenticatePayload } from "@hocuspocus/server";
    import { db } from "@/db/client";
    import { rooms, roomMembers, tabs } from "@/db/schema";
    import { verifyJwt } from "@/auth/verify";
    import { AuthError } from "@/lib/errors";
    import { logger } from "@/lib/logger";

    export async function onAuthenticate(payload: onAuthenticatePayload) {
      const { token, documentName } = payload;
      try {
        const user = await verifyJwt(token);

        // documentName is either a tab id (uuid) or a control-doc id ("room:<roomId>").
        let tabId: string | null = null;
        let roomId: string;

        if (documentName.startsWith("room:")) {
          roomId = documentName.slice(5);
        } else {
          const tab = await db.query.tabs.findFirst({ where: eq(tabs.id, documentName) });
          if (!tab) throw new AuthError("not_found", "Tab not found");
          tabId = tab.id;
          roomId = tab.roomId;
        }

        const room = await db.query.rooms.findFirst({
          where: and(eq(rooms.id, roomId), isNull(rooms.deletedAt)),
        });
        if (!room) throw new AuthError("not_found", "Room not found");

        const member = await db.query.roomMembers.findFirst({
          where: and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, user.id)),
        });
        if (!member) throw new AuthError("forbidden", "Not a member");

        const readOnly =
          room.visibility === "link" &&
          !room.linkCanEdit &&
          member.role !== "owner";

        logger.info(
          { userId: user.id, roomId: room.id, tabId, documentName, readOnly },
          "ws authenticated",
        );

        return { user, roomId: room.id, tabId, readOnly };
      } catch (err) {
        if (err instanceof AuthError) throw err;
        logger.warn({ err, documentName }, "ws auth: jwt verify failed");
        throw new AuthError("unauthorized", "Invalid token");
      }
    }
    ```
  - **`apps/server/src/sync/presence.ts`:**
    ```ts
    export interface AwarenessPayloadClient {
      display_name?: string;
      avatar_url?: string | null;
    }
    export interface AwarenessPayloadServer extends AwarenessPayloadClient {
      user_id: string;   // server-stamped
      color: string;     // server-stamped
    }

    // Deterministic color hash from user_id; 5 presence colors from design tokens.
    export function colorFor(userId: string): string {
      let h = 0;
      for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
      const idx = Math.abs(h) % 5;
      return `hsl(var(--presence-${idx + 1}))`;
    }
    ```
  - **`apps/server/src/sync/hocuspocus.ts`:**
    ```ts
    import { Server } from "@hocuspocus/server";
    import { buildDatabaseExtension } from "./persistence";
    import { onAuthenticate } from "./authorize";
    import { colorFor } from "./presence";
    import { logger } from "@/lib/logger";

    export function buildHocuspocus() {
      return Server.configure({
        extensions: [buildDatabaseExtension()],

        onAuthenticate,

        async onAwarenessUpdate({ context, awareness }) {
          // Re-stamp identity-bearing fields from the auth context, on the
          // room control doc's awareness only. Per-tab connections don't
          // broadcast presence — presence lives on the control doc.
          const localState = awareness.getLocalState() as Record<string, unknown> | null;
          if (!localState) return;
          const expectedId = context.user?.id;
          if (!expectedId) return;
          if (localState.user_id !== expectedId) {
            if (localState.user_id !== undefined) {
              logger.warn(
                { claimed: localState.user_id, actual: expectedId },
                "awareness user_id mismatch — overwriting",
              );
            }
            awareness.setLocalState({
              ...localState,
              user_id: expectedId,
              color: colorFor(expectedId),
            });
          }
        },

        // Note: no top-level onLoadDocument — the Database extension's
        // `fetch` callback handles document loading. Configuring both
        // creates ambiguity about which source wins.

        async onStoreDocument({ context, state }) {
          logger.debug(
            { tabId: context.tabId, roomId: context.roomId, bytes: state.length },
            "store document",
          );
        },

        async onConnect({ context }) {
          logger.debug(
            { userId: context.user?.id, roomId: context.roomId, tabId: context.tabId },
            "ws connect",
          );
        },

        async onDisconnect({ context }) {
          logger.debug(
            { userId: context.user?.id, roomId: context.roomId, tabId: context.tabId },
            "ws disconnect",
          );
        },
      });
    }
    ```
- **Verify:**
  - `bun --cwd apps/server run typecheck` passes.
  - `apps/server/src/sync/authorize.test.ts` — mocks `verifyJwt` and `db.query.*`; covers:
    - Control doc (`room:<id>`) → resolves with `tabId: null`.
    - Tab id (uuid) → resolves with `tabId` set.
    - Owner on `link_can_edit=false` → `readOnly: false`.
    - Non-owner on `link_can_edit=false` → `readOnly: true`.
    - Non-owner on private (member) → `readOnly: false`.
    - Non-member → `forbidden`.
    - Soft-deleted room → `not_found`.
    - Missing tab → `not_found`.
    - JWT invalid → `unauthorized`.
  - `bun test apps/server/src/sync` passes.

---

## Task 8: Server — HTTP-upgrade hijack + connection-management decorators + control-doc broadcast

- **What:** Replace the no-op `dropRoomConnections` decorator from auth-and-rooms with the real Hocuspocus-backed implementation; add a sibling `closeTabConnections(tabId)` decorator used by tab DELETE; attach the upgrade listener after `app.ready()`; expose a small helper that pushes tab-list updates into the room control doc on tab CRUD.
- **Why:** Cross-phase contract: room PATCH/DELETE (auth-and-rooms) calls `dropRoomConnections(roomId)` which iterates the room's tabs and the control doc; tab DELETE (this phase, Task 6) calls `closeTabConnections(tabId)` for the single affected tab. The upgrade listener mounts WS on the same Fastify port; the control-doc broadcast keeps the tab list converged across clients (per the design's "Approach A — control Y.Doc per room").
- **How:**
  - **Step 1 — replace both stubs.** In `apps/server/src/server.ts`, find and remove **both** of these stub blocks (one added in auth-and-rooms Task 7, the other in this plan's Task 6):
    ```ts
    app.decorate("dropRoomConnections", async (_roomId: string) => {
      // No-op until realtime-markdown phase wires Hocuspocus.
    });
    ```
    ```ts
    app.decorate("closeTabConnections", (_tabId: string) => {
      // No-op until Task 8.
    });
    ```
    Replace with the real implementations in Step 2 below.
  - **Step 2 — add Hocuspocus + the real decorators + the upgrade listener.**
    ```ts
    // After buildHocuspocus() and app.decorate("hocuspocus", hocuspocus):
    app.decorate("closeTabConnections", (tabId: string) => {
      hocuspocus.closeConnections(tabId);
    });
    app.decorate("dropRoomConnections", async (roomId: string) => {
      // Close all live tab connections for this room AND the room control doc.
      const tabIds = await db
        .select({ id: tabsTable.id })
        .from(tabsTable)
        .where(eq(tabsTable.roomId, roomId));
      for (const { id } of tabIds) {
        hocuspocus.closeConnections(id);
      }
      hocuspocus.closeConnections(`room:${roomId}`);
    });
    ```
    Imports: `tabs as tabsTable` from `@/db/schema`, `eq` from `drizzle-orm`, `db` from `@/db/client`. The auth-and-rooms PATCH/DELETE callsites already invoke `dropRoomConnections(roomId)` — no callsite changes needed.
  - **Step 3 — server-side broadcast helper for tab list sync.** Hocuspocus exposes `hocuspocus.openDirectConnection(documentName)` returning a `DirectConnection` whose `transact(doc => …)` callback runs a Yjs transaction that Hocuspocus broadcasts to subscribers and persists. **All Y.Array mutations must happen inside `transact()`** — bare writes via `conn.document.getArray(...)` outside `transact` won't trigger the broadcast/persist pipeline. Add `apps/server/src/sync/control.ts`:
    ```ts
    import type { Hocuspocus } from "@hocuspocus/server";
    import type { TabSummary } from "@rumi/protocol";
    import { logger } from "@/lib/logger";

    export async function broadcastTabsCreated(
      h: Hocuspocus, roomId: string, tab: TabSummary,
    ) {
      try {
        const conn = await h.openDirectConnection(`room:${roomId}`);
        await conn.transact((doc) => {
          doc.getArray<TabSummary>("tabs").push([tab]);
        });
        await conn.disconnect();
      } catch (err) {
        logger.warn({ err, roomId, tabId: tab.id }, "broadcastTabsCreated failed");
      }
    }

    export async function broadcastTabsUpdated(
      h: Hocuspocus, roomId: string, tab: TabSummary,
    ) {
      try {
        const conn = await h.openDirectConnection(`room:${roomId}`);
        await conn.transact((doc) => {
          const arr = doc.getArray<TabSummary>("tabs");
          for (let i = 0; i < arr.length; i++) {
            if ((arr.get(i) as TabSummary).id === tab.id) {
              arr.delete(i, 1);
              arr.insert(i, [tab]);
              break;
            }
          }
        });
        await conn.disconnect();
      } catch (err) {
        logger.warn({ err, roomId, tabId: tab.id }, "broadcastTabsUpdated failed");
      }
    }

    export async function broadcastTabsDeleted(
      h: Hocuspocus, roomId: string, tabId: string,
    ) {
      try {
        const conn = await h.openDirectConnection(`room:${roomId}`);
        await conn.transact((doc) => {
          const arr = doc.getArray<TabSummary>("tabs");
          for (let i = 0; i < arr.length; i++) {
            if ((arr.get(i) as TabSummary).id === tabId) {
              arr.delete(i, 1);
              break;
            }
          }
        });
        await conn.disconnect();
      } catch (err) {
        logger.warn({ err, roomId, tabId }, "broadcastTabsDeleted failed");
      }
    }
    ```
  - **Step 4 — wire broadcasts into tab routes (Task 6).** After each successful POST/PATCH/DELETE, call the corresponding broadcast helper inside `tabs.routes.ts`. Broadcast failure logs a warn but **must not** break the API response — REST `GET /:slug` re-fetch is the source of truth on initial mount per the design doc.
  - **Step 5 — type augmentation.** `apps/server/src/types.d.ts`:
    ```ts
    import type { Service } from "@/rooms/service";
    import type { TabsService } from "@/rooms/tabs.service";
    import type { Hocuspocus } from "@hocuspocus/server";

    declare module "fastify" {
      interface FastifyInstance {
        service: Service;
        tabsService: TabsService;
        hocuspocus: Hocuspocus;
        dropRoomConnections: (roomId: string) => Promise<void>;
        closeTabConnections: (tabId: string) => void;
      }
    }
    ```
  - **Step 6 — attach the HTTP-upgrade listener after `app.ready()`.** In `apps/server/src/server.ts`, after the existing `await app.ready()` and before `app.listen(...)`, add:
    ```ts
    app.server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus's WS typings predate Node's strict types
      hocuspocus.handleConnection(socket as any, request, head);
    });
    ```
    Without this, no WebSocket connections are accepted and every provider in the manual flow will fail to connect.
  - **Step 7 — graceful shutdown.** Update the `SIGINT`/`SIGTERM` shutdown hook (added in auth-and-rooms Task 7) to drain Hocuspocus before closing Fastify so in-flight document saves complete:
    ```ts
    const shutdown = async () => {
      await hocuspocus.destroy();
      await app.close();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    ```
- **Verify:**
  - `bun --cwd apps/server run dev` boots; logs "listening on :3000".
  - `curl http://localhost:3000/health` still returns ok.
  - `bun --cwd apps/server run typecheck` passes.
  - `apps/server/src/sync/control.test.ts` — integration-style test of the control-doc broadcasts. Spin up a real `Hocuspocus` instance in-process, open a `room:<roomId>` doc directly via `hocuspocus.openDirectConnection(...)`, hold the resulting `DirectConnection` open as the "subscriber", call `broadcastTabsCreated` from a second openDirectConnection to push a tab, and assert the subscriber's `doc.getArray<TabSummary>("tabs").length` grows by exactly 1. Repeat for updated and deleted. This catches `transact()` wrapping mistakes and double-broadcast regressions — both are real risks of the openDirectConnection API.
  - End-to-end WS verification happens in Task 13 manual flow.

---

## Task 9: Web — language registry, Shiki bridge, markdown renderer

- **What:** `lib/markdown/languages.ts` (registry), `lib/shiki.ts` (singleton highlighter), `lib/markdown/render.ts` (CommonMark+GFM with rehype-sanitize + Shiki for fenced code).
- **Why:** Three orthogonal pieces of the Tab editor; cleaner to land them as one task before the editor mount in Task 11.
- **How:**
  - **`apps/web/src/lib/markdown/languages.ts`:**
    ```ts
    import { markdown } from "@codemirror/lang-markdown";
    import type { Extension } from "@codemirror/state";

    type LanguageEntry = {
      name: string;
      // CodeMirror language extension factory; can be sync or async (lazy-loaded).
      cmExtension: () => Extension | Promise<Extension>;
      // Shiki language id (used for the markdown preview's fenced code blocks).
      shiki: string;
    };

    export const LANGUAGES: Record<string, LanguageEntry> = {
      markdown: {
        name: "Markdown",
        cmExtension: () => markdown(),
        shiki: "markdown",
      },
      typescript: {
        name: "TypeScript",
        cmExtension: () =>
          import("@codemirror/lang-javascript").then((m) =>
            m.javascript({ typescript: true, jsx: true }),
          ),
        shiki: "typescript",
      },
      javascript: {
        name: "JavaScript",
        cmExtension: () =>
          import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
        shiki: "javascript",
      },
      python: {
        name: "Python",
        cmExtension: () => import("@codemirror/lang-python").then((m) => m.python()),
        shiki: "python",
      },
      go: {
        name: "Go",
        cmExtension: () => import("@codemirror/lang-go").then((m) => m.go()),
        shiki: "go",
      },
      rust: {
        name: "Rust",
        cmExtension: () => import("@codemirror/lang-rust").then((m) => m.rust()),
        shiki: "rust",
      },
      json: {
        name: "JSON",
        cmExtension: () => import("@codemirror/lang-json").then((m) => m.json()),
        shiki: "json",
      },
      html: {
        name: "HTML",
        cmExtension: () => import("@codemirror/lang-html").then((m) => m.html()),
        shiki: "html",
      },
      css: {
        name: "CSS",
        cmExtension: () => import("@codemirror/lang-css").then((m) => m.css()),
        shiki: "css",
      },
    };

    export type LanguageId = keyof typeof LANGUAGES;
    ```
  - **`apps/web/src/lib/shiki.ts`:**
    ```ts
    import { createHighlighter, type Highlighter } from "shiki";

    let instance: Promise<Highlighter> | null = null;
    const loadedLangs = new Set<string>();

    export async function getHighlighter() {
      if (!instance) {
        instance = createHighlighter({
          themes: ["github-light", "github-dark"],
          langs: ["markdown"], // others loaded on demand
        });
      }
      return instance;
    }

    export async function ensureLanguage(lang: string) {
      const h = await getHighlighter();
      if (loadedLangs.has(lang)) return h;
      try {
        await h.loadLanguage(lang as any);
        loadedLangs.add(lang);
      } catch {
        // Unknown language — silently fall through; Shiki renders as plain text.
      }
      return h;
    }
    ```
  - **`apps/web/src/lib/markdown/render.ts`:**
    ```ts
    import { unified } from "unified";
    import remarkParse from "remark-parse";
    import remarkGfm from "remark-gfm";
    import remarkRehype from "remark-rehype";
    import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
    import rehypeStringify from "rehype-stringify";
    import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
    import { getHighlighter } from "@/lib/shiki";

    // Sanitize schema: GFM defaults + allow class on code/pre + data-* attributes
    // (Shiki writes these for theme switching).
    const schema = {
      ...defaultSchema,
      attributes: {
        ...defaultSchema.attributes,
        code: [...(defaultSchema.attributes?.code ?? []), "className"],
        pre: [...(defaultSchema.attributes?.pre ?? []), "className", "style"],
        span: [...(defaultSchema.attributes?.span ?? []), "className", "style"],
      },
    };

    let processor: ReturnType<typeof buildProcessor> | null = null;
    function buildProcessor() {
      return getHighlighter().then((highlighter) =>
        unified()
          .use(remarkParse)
          .use(remarkGfm)
          .use(remarkRehype)
          .use(rehypeShikiFromHighlighter, highlighter, {
            themes: { light: "github-light", dark: "github-dark" },
            defaultColor: false, // we drive theme via CSS vars
          })
          .use(rehypeSanitize, schema)
          .use(rehypeStringify),
      );
    }

    export async function renderMarkdown(source: string): Promise<string> {
      processor ??= buildProcessor();
      const p = await processor;
      const file = await p.process(source);
      return String(file);
    }
    ```
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - `apps/web/src/lib/markdown/render.test.ts` — covers:
    - H1, list, fenced code (with language) → expected HTML structure.
    - GFM table renders with `<table>`.
    - GFM task list renders with `<input type="checkbox" disabled>`.
    - `<script>alert(1)</script>` is stripped.
    - Inline `<img onerror>` attribute is stripped.
  - `bun test apps/web/src/lib/markdown/render.test.ts` passes.

---

## Task 10: Web — collab plumbing (`use-tab-doc.ts`, `use-room-control-doc.ts`)

- **What:** Two hooks: `useTabDoc({ tabId })` for per-tab content sync, `useRoomControlDoc({ roomId })` for the room-level control doc that powers presence + tab list sync.
- **Why:** Both hooks own a Y.Doc + HocuspocusProvider lifecycle. Same shape; different `name` (tab id vs `room:<roomId>`).
- **How:**
  - **`apps/web/src/lib/collab/awareness.ts`:** as in the prior plan — exposes `LocalAwareness` (display_name, avatar_url) and `buildLocalAwareness(user)` helper.
  - **`apps/web/src/components/editor/use-tab-doc.ts`:**
    ```ts
    import { HocuspocusProvider } from "@hocuspocus/provider";
    import { useEffect, useMemo, useRef, useState } from "react";
    import * as Y from "yjs";
    import { useSession } from "@/lib/auth";
    import { buildLocalAwareness } from "@/lib/collab/awareness";

    type Status = "connecting" | "connected" | "disconnected";

    export function useTabDoc({ tabId }: { tabId: string }) {
      const session = useSession();
      const [status, setStatus] = useState<Status>("connecting");
      const [readOnly, setReadOnly] = useState(false);

      const ydoc = useMemo(() => new Y.Doc(), [tabId]);
      useEffect(() => () => ydoc.destroy(), [ydoc]);

      const providerRef = useRef<HocuspocusProvider | null>(null);

      useEffect(() => {
        if (!session.token) return;
        const provider = new HocuspocusProvider({
          url: import.meta.env.VITE_WS_URL,
          name: tabId,
          token: session.token,
          document: ydoc,
          onStatus: ({ status }: { status: Status }) => setStatus(status),
          onAuthenticated: ({ readOnly }: { readOnly?: boolean }) => setReadOnly(!!readOnly),
        });
        provider.awareness?.setLocalState(buildLocalAwareness(session.user));
        providerRef.current = provider;
        return () => {
          provider.destroy();
          providerRef.current = null;
        };
      }, [tabId, session.token, ydoc]);

      return { ydoc, provider: providerRef.current, status, readOnly };
    }
    ```
  - **`apps/web/src/components/editor/use-room-control-doc.ts`:** identical shape but with `name: \`room:${roomId}\``; returns the same `{ ydoc, provider, status, readOnly }` shape so the TopBar's presence avatars and `useTabs` can consume it. Drives presence awareness for the room.
  - **`apps/web/src/components/tabs/use-tabs.ts`:**
    ```ts
    // Subscribes to the control doc's "tabs" Y.Array and keeps local state in sync.
    // Initial state seeded from the loader's TabSummary[]; live updates from Y.Array.
    import { useEffect, useState } from "react";
    import * as Y from "yjs";
    import type { TabSummary } from "@rumi/protocol";

    export function useTabs(opts: {
      initialTabs: TabSummary[];
      controlDoc: Y.Doc | null;
    }) {
      const [tabs, setTabs] = useState<TabSummary[]>(opts.initialTabs);
      const [activeTabId, setActiveTabId] = useState<string | null>(
        opts.initialTabs[0]?.id ?? null,
      );

      useEffect(() => {
        if (!opts.controlDoc) return;
        const arr = opts.controlDoc.getArray<TabSummary>("tabs");
        const sync = () => {
          const next = arr.toArray();
          // Only adopt the control doc's view if non-empty (defensive: server
          // pushes happen after creation; if the control doc starts empty,
          // the REST initial load is authoritative).
          if (next.length > 0) {
            setTabs([...next].sort((a, b) => a.ordinal - b.ordinal));
          }
        };
        arr.observe(sync);
        sync();
        return () => arr.unobserve(sync);
      }, [opts.controlDoc]);

      return { tabs, activeTabId, setActiveTabId };
    }
    ```
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - `apps/web/src/components/editor/use-tab-doc.test.ts` — mocks `HocuspocusProvider`; tests status transitions, provider re-instantiation on token change, Y.Doc survives token refresh.

---

## Task 11: Web — tab editor, markdown toolbar, view-mode toggle

- **What:** `tab-editor.tsx` (entry point that routes by `tab.type`), `tab-cm.tsx` (CodeMirror mount with language Compartment), `markdown-tab.tsx` (markdown view-mode composer), `code-tab.tsx` (code chrome composer), `markdown-toolbar.tsx`, `markdown-preview.tsx`, `view-mode-toggle.tsx`, `language-picker.tsx`, `decorations.ts` (CodeMirror HighlightStyle for source-side typography), `editor-skeleton.tsx` (loading placeholder), `lib/welcome-content.ts` (the welcome markdown constant).
- **Why:** The user-facing surface for the unified Tab type. Drawing tabs are routed to `<DrawingTab />` per `drawing-plan.md`.
- **How:**
  - **`apps/web/src/components/editor/decorations.ts`:** `HighlightStyle.define([...])` per the design doc (sized headings, monospace inline code, muted markers, italic emphasis, primary-colored links).
  - **`apps/web/src/components/editor/extensions.ts`:** exports `markdownShortcutKeymap` — three CodeMirror commands wrapping selection for Cmd/Ctrl+B (`**…**`), Cmd/Ctrl+I (`*…*`), Cmd/Ctrl+K (`[…](url)` with a small inline URL prompt). Also exports the helpers `wrapSelection(view, prefix, suffix?)` and `prefixLine(view, prefix)` used by both the keymap and the toolbar.
  - **`apps/web/src/components/editor/tab-cm.tsx`:** the CodeMirror mount. Two `Compartment`s — `langCompartment` and `readOnlyCompartment` — reconfigured via `view.dispatch({ effects: c.reconfigure(...) })` when language or readOnly props change. The mount effect is keyed on `(ydoc, provider)` only.
    ```tsx
    // Critical: `language` and `readOnly` are NOT in the mount-effect dep array.
    // They reconfigure compartments via separate effects without rebuilding the view.

    function buildLangExtension(language: string | null): Extension | Promise<Extension> {
      if (!language) return [];
      return LANGUAGES[language]?.cmExtension() ?? [];
    }

    function TabCm({ ydoc, provider, language, readOnly }: Props) {
      const ref = useRef<HTMLDivElement>(null);
      const viewRef = useRef<EditorView | null>(null);
      const langCompartment = useRef(new Compartment());
      const readOnlyCompartment = useRef(new Compartment());

      // Mount once per (ydoc, provider).
      useEffect(() => {
        const ytext = ydoc.getText("content");
        const undoManager = new Y.UndoManager(ytext);
        const view = new EditorView({
          parent: ref.current!,
          state: EditorState.create({
            doc: ytext.toString(),
            extensions: [
              history(),
              keymap.of([...defaultKeymap, ...historyKeymap, ...markdownShortcutKeymap]),
              EditorView.lineWrapping,
              dropCursor(),
              drawSelection(),
              placeholder("Start writing…"),
              syntaxHighlighting(rumiHighlightStyle),
              rumiEditorTheme,
              langCompartment.current.of([]),
              readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
              yCollab(ytext, provider.awareness, { undoManager }),
            ],
          }),
        });
        viewRef.current = view;

        // Apply initial language async if needed.
        Promise.resolve(buildLangExtension(language)).then((ext) => {
          view.dispatch({ effects: langCompartment.current.reconfigure(ext) });
        });

        return () => { view.destroy(); viewRef.current = null; };
      }, [ydoc, provider]);

      // Reconfigure when language changes.
      useEffect(() => {
        const view = viewRef.current; if (!view) return;
        Promise.resolve(buildLangExtension(language)).then((ext) => {
          view.dispatch({ effects: langCompartment.current.reconfigure(ext) });
        });
      }, [language]);

      // Reconfigure when readOnly changes.
      useEffect(() => {
        viewRef.current?.dispatch({
          effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
        });
      }, [readOnly]);

      return (
        <div
          ref={ref}
          className="h-full font-mono text-[13.5px]"
          style={{ fontFeatureSettings: "var(--editor-font-feature-settings, normal)" }}
        />
      );
    }
    ```
  - **`apps/web/src/components/editor/markdown-preview.tsx`:** `<MarkdownPreview ytext>`; observes the Y.Text, debounces re-render via `useDeferredValue` + a 50ms `setTimeout` inside `renderMarkdown`, and writes the sanitized HTML via `dangerouslySetInnerHTML`.
  - **`apps/web/src/components/editor/markdown-toolbar.tsx`:** 8 buttons per the design doc (H1, H2, Bold, Italic, List, Quote, Inline code, Link). Each dispatches the same CodeMirror command as its keyboard shortcut. Right side: `<LanguagePicker />` + `<ViewModeToggle />`.
  - **`apps/web/src/components/editor/view-mode-toggle.tsx`:** cycles split → rendered → source → split via a single button. Icon swaps per state (`Columns2` / `Eye` / `FileText` lucide). Per-tab ephemeral state stored in a Zustand slice keyed on tab id.
  - **`apps/web/src/components/editor/language-picker.tsx`:** shadcn `DropdownMenu`, lists `LANGUAGES` + a "Plain text" entry mapped to `language: null`. On select → `apiFetch(\`/api/rooms/${slug}/tabs/${tabId}\`, { method: "PATCH", body: { language } })`. The control doc's `tabs.updated` event will reflect the new language back to all clients.
  - **`apps/web/src/components/editor/editor-skeleton.tsx`:** simple loading placeholder.
    ```tsx
    export function EditorSkeleton() {
      return (
        <div className="h-full grid place-items-center text-muted-foreground text-sm">
          Loading…
        </div>
      );
    }
    ```
  - **`apps/web/src/lib/welcome-content.ts`:** the welcome markdown constant, copied verbatim from the prototype's `docs/_refs/rumi-collab/src/lib/rumi-types.ts` (`DEFAULT_CONTENT.markdown`).
    ```ts
    export const WELCOME_MARKDOWN = `# Welcome to Rumi

    Share this link with anyone — they'll join instantly, no signup.

    ## What you can do here

    - Write **markdown** with a live preview
    - Sketch ideas on a shared canvas
    - Drop in a **code** snippet

    > Tip: rename this tab by double-clicking it.

    \`\`\`ts
    function greet(name: string) {
      return \`hello, \${name}\`;
    }
    \`\`\`
    `;
    ```
    (Strip the leading 4-space indentation; this snippet uses it for markdown rendering only.)
  - **`apps/web/src/components/editor/tab-editor.tsx`:**
    ```tsx
    import { lazy, Suspense } from "react";
    import { useTabDoc } from "./use-tab-doc";
    import { MarkdownTab } from "./markdown-tab";
    import { CodeTab } from "./code-tab";
    import { EditorSkeleton } from "./editor-skeleton";
    import type { TabSummary } from "@rumi/protocol";

    // Lazy-load the drawing tab — pulls tldraw's ~500KB bundle only when used.
    const DrawingTab = lazy(() => import("./drawing-tab"));

    export function TabEditor({ tab }: { tab: TabSummary }) {
      if (tab.type === "drawing") {
        return (
          <Suspense fallback={<EditorSkeleton />}>
            <DrawingTab tab={tab} />
          </Suspense>
        );
      }
      const { ydoc, provider, readOnly } = useTabDoc({ tabId: tab.id });
      if (!provider) return <EditorSkeleton />;
      if (tab.language === "markdown") {
        return <MarkdownTab ydoc={ydoc} provider={provider} tab={tab} readOnly={readOnly} />;
      }
      return <CodeTab ydoc={ydoc} provider={provider} tab={tab} readOnly={readOnly} />;
    }
    ```
  - **`apps/web/src/components/editor/markdown-tab.tsx`:** composes the toolbar, source pane, and preview pane per the current view-mode state.
    ```tsx
    import { useEffect } from "react";
    import * as Y from "yjs";
    import type { HocuspocusProvider } from "@hocuspocus/provider";
    import { TabCm } from "./tab-cm";
    import { MarkdownToolbar } from "./markdown-toolbar";
    import { MarkdownPreview } from "./markdown-preview";
    import { useViewMode } from "./view-mode-toggle";
    import { WELCOME_MARKDOWN } from "@/lib/welcome-content";
    import type { TabSummary } from "@rumi/protocol";

    interface Props {
      ydoc: Y.Doc;
      provider: HocuspocusProvider;
      tab: TabSummary;
      readOnly: boolean;
    }

    export function MarkdownTab({ ydoc, provider, tab, readOnly }: Props) {
      const ytext = ydoc.getText("content");
      const mode = useViewMode(tab.id); // "split" | "rendered" | "source"

      // Welcome content seed — runs once after the provider syncs.
      // Idempotent: a non-empty Y.Text means another client already seeded
      // (or the user has typed); subsequent calls no-op via the empty check.
      useEffect(() => {
        if (readOnly) return;
        if (tab.name !== "Welcome" || tab.language !== "markdown") return;
        const seedIfEmpty = () => {
          if (ytext.length === 0) ytext.insert(0, WELCOME_MARKDOWN);
        };
        if (provider.synced) {
          seedIfEmpty();
        } else {
          provider.on("synced", seedIfEmpty);
          return () => { provider.off("synced", seedIfEmpty); };
        }
      }, [provider, ytext, tab.name, tab.language, readOnly]);

      return (
        <div className="flex h-full flex-col">
          <MarkdownToolbar ydoc={ydoc} tab={tab} readOnly={readOnly} mode={mode} />
          <div
            className={
              mode === "split"
                ? "grid flex-1 min-h-0 grid-cols-1 md:grid-cols-2"
                : "flex flex-1 min-h-0"
            }
          >
            {/* Source pane: always mounted (preserves CodeMirror state across mode flips); hidden when mode === 'rendered' */}
            <div className={`min-h-0 ${mode === "rendered" ? "hidden" : "flex-1 md:border-r md:border-border"}`}>
              <TabCm ydoc={ydoc} provider={provider} language="markdown" readOnly={readOnly} />
            </div>
            {/* Preview pane: hidden when mode === 'source' */}
            <div className={`min-h-0 overflow-auto ${mode === "source" ? "hidden" : "flex-1"}`}>
              <MarkdownPreview ytext={ytext} />
            </div>
          </div>
        </div>
      );
    }
    ```
  - **`apps/web/src/components/editor/code-tab.tsx`:** chrome strip + `<TabCm>` for non-markdown languages (and plain text when `language === null`).
    ```tsx
    import * as Y from "yjs";
    import type { HocuspocusProvider } from "@hocuspocus/provider";
    import { TabCm } from "./tab-cm";
    import { LanguagePicker } from "./language-picker";
    import { LANGUAGES } from "@/lib/markdown/languages";
    import type { TabSummary } from "@rumi/protocol";

    interface Props {
      ydoc: Y.Doc;
      provider: HocuspocusProvider;
      tab: TabSummary;
      readOnly: boolean;
    }

    export function CodeTab({ ydoc, provider, tab, readOnly }: Props) {
      const ytext = ydoc.getText("content");
      const lineCount = ytext.toString().split("\n").length;
      const langName = tab.language ? LANGUAGES[tab.language]?.name ?? "Plain text" : "Plain text";

      return (
        <div className="flex h-full flex-col">
          <div className="h-10 bg-surface/60 border-b border-border px-3 flex items-center gap-3 shrink-0">
            <span className="text-[11px] font-medium text-muted-foreground truncate">
              {tab.name}
            </span>
            <LanguagePicker tabSlug={tab.roomId} tabId={tab.id} value={tab.language} />
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
              {lineCount} line{lineCount === 1 ? "" : "s"} · {langName}
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <TabCm ydoc={ydoc} provider={provider} language={tab.language} readOnly={readOnly} />
          </div>
        </div>
      );
    }
    ```
    Note: `<LanguagePicker>` accepts the room slug for the PATCH call; pass it through from the parent if not yet resolvable from `tab.roomId` alone. Adjust when wiring through `<TabBar>`'s context.
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - `apps/web/src/components/editor/tab-cm.test.ts` — switching language plain → markdown reconfigures the Compartment without rebuilding the view (assert `viewRef.current` is the same instance).
  - `apps/web/src/components/editor/markdown-toolbar.test.ts` — bold wraps selection; link prompt round-trip.
  - `apps/web/src/components/editor/view-mode.test.ts` — split → rendered → source cycle; default split.
  - `apps/web/src/components/editor/markdown-preview.test.ts` — render of headings/lists/tables/task lists; sanitization strips `<script>`.
  - `bun test apps/web/src/components/editor` passes.

---

## Task 12: Web — tab bar + add-tab popover + connection status + extended TopBar

- **What:** `tabs/tab-bar.tsx`, `tabs/add-tab-popover.tsx`, `tabs/tab-icons.ts`, `editor/connection-status.tsx`, plus extending the TopBar (built in auth-and-rooms) to consume `provider`/`status` from the room control doc.
- **Why:** End-to-end of the room shell.
- **How:**
  - **`tabs/tab-icons.ts`:** maps `(type, language)` → lucide icon.
    - `tab` + `language === "markdown"` → `FileText`
    - `tab` + any other / null language → `Code2`
    - `drawing` → `PenLine`
  - **`tabs/tab-bar.tsx`:** per the design doc "TabBar visual treatment" section. Strip layout, active-tab seam overlay, close-button visibility rules, double-click rename with auto-select-on-edit, Escape-resets-draft, empty-fallback `"Untitled"`. The `+` button is disabled at 3 with `title="Max 3 tabs (upgrade for more)"`. The active tab merges with the editor surface via the absolute `-bottom-px` overlay strip.
  - **`tabs/add-tab-popover.tsx`:** shadcn `Popover` content per the design doc — `w-64 p-1.5`, "New tab" header, two option rows (Tab / Drawing) with icon tile + label + description, `animate-scale-in` on open.
  - **`editor/connection-status.tsx`:** renders nothing on `connected`; small bottom-right pill with spinner + "Reconnecting..." on `connecting` (after the initial connect); amber pill "Disconnected — retrying" on `disconnected` plus a Sonner toast on the first transition into disconnected.
  - **TopBar extensions:** the TopBar from auth-and-rooms now consumes optional `status` and an optional `provider` for awareness reads. Pass `status === "connected"` to render the always-on "Live" pill (per `auth-and-rooms.md`); pass `provider` to render presence avatars from `provider.awareness.getStates()` (overlapping stack, 4 max, `+N` pip beyond 4, hover lift, name tooltip).
  - Update `apps/web/src/routes/_authed/r.$slug.tsx` to assemble the room view:
    ```tsx
    function RoomPage() {
      const { room, tabs: initialTabs } = Route.useLoaderData();
      const control = useRoomControlDoc({ roomId: room.id });
      const { tabs, activeTabId, setActiveTabId } = useTabs({
        initialTabs,
        controlDoc: control.ydoc,
      });
      const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

      return (
        <div className="flex h-screen flex-col">
          <TopBar
            room={room}
            provider={control.provider}
            status={control.status}
          />
          <TabBar
            tabs={tabs}
            activeTabId={activeTab?.id}
            roomSlug={room.slug}
            onSelect={setActiveTabId}
          />
          <div className="flex-1 min-h-0">
            {activeTab && <TabEditor tab={activeTab} key={activeTab.id} />}
          </div>
          <ConnectionStatus status={control.status} />
        </div>
      );
    }
    ```
- **Verify:**
  - `bun --cwd apps/web run typecheck` passes.
  - `bun --cwd apps/web run dev`; sign in; create a room; the welcome tab renders with seeded markdown content and split view.

---

## Task 13: Manual verification flow + pre-commit gate

- **What:** Run the verification flow from the design doc's Testing section, then the pre-commit gate.
- **Why:** Catches integration issues mocked tests miss.
- **How:**
  - With the dev server running and signed in:
    1. Create a room → Welcome tab renders with seeded content; markdown preview shows heading + list + blockquote + fenced TS code block (Shiki-highlighted).
    2. Cycle the view-mode toggle: split → rendered-only → source-only → split. Editor state survives.
    3. Click `+` → "Tab" → new "Untitled" tab; type plain text; no highlighting.
    4. Open the language picker on the new tab → "TypeScript". Source pane gets syntax colors. Switch to "Markdown" — toolbar appears, view-mode toggle appears, preview renders.
    5. Click `+` → "Drawing" → tldraw chrome appears (drawing-plan delivers this).
    6. Click `+` again → button is disabled with tooltip "Max 3 tabs (upgrade for more)".
    7. Open the same URL in a second browser as a second user (auto-joins as `link` default). Both windows show two avatars in the TopBar; "Live" pill green-pulses.
    8. Type in a Tab on window A; window B sees it within ~50ms.
    9. Window A creates a 3rd tab → window B sees it appear (control doc sync).
    10. Window A renames a tab (double-click) → window B sees the new label.
    11. Window A switches language to "Plain text" → window B's editor toolbar disappears; preview disappears; CodeMirror state preserved.
    12. Window A deletes a tab → window B sees it disappear; if it was active there, falls back to previous.
    13. Stop dev server → both clients show "Reconnecting..." pill; Live pill goes away. Restart → pills clear; tabs and content intact.
    14. Owner PATCHes `link_can_edit=false` (via curl):
        ```bash
        curl -X PATCH http://localhost:3000/api/rooms/<slug> \
          -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
          -d '{"linkCanEdit":false}'
        ```
        User B's tab connections drop and reconnect; editors flip to read-only without manual refresh; tab CRUD endpoints reject from B.
    15. Owner PATCHes `visibility=private`. Sign out user B; sign in as user C; paste URL → 403 redirect. Owner invites C → C's dashboard shows the room → joins → tabs work.
    16. Owner soft-deletes the room → both connected users get bounced to `/` on next reconnect with "Room deleted" toast.
    17. Leave a tab open with Supabase JWT TTL shortened to 2 minutes. Verify token refresh fires; providers reconnect; no visible state loss.
    18. Paste `<script>alert(1)</script>` into the markdown source pane. Verify the preview pane renders escaped text — no script execution.
  - From repo root:
    - `bun run check`
    - `bun run typecheck`
    - `bun test apps packages`
- **Verify:** All 18 manual steps succeed without errors. All three commands exit 0.

---

## Suggested commit points

- **After Task 8** (server end-to-end with Hocuspocus + tab CRUD + control-doc broadcasts) — backend ships independently.
- **After Task 11** (web editor stack landed, but tab bar / TopBar extensions still pending) — second checkpoint if you prefer smaller diffs.
- **After Task 13** (manual verification + pre-commit gate green) — full phase complete.

Single-commit also fine: this whole phase is "feat: realtime tab system (markdown + code + plain text)."
