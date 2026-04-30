# Rumi

A real-time collaborative workspace built for developers. Create a room, share the link, and write code, markdown, and diagrams together — live.

![Rumi dashboard](docs/screenshots/ss1.png)

![Rumi editor](docs/screenshots/ss2.png)

---

## What you can do

**Write together in real time.**
Every keystroke is synced instantly. No refresh, no merge conflicts — just you and your collaborators in the same document.

**Tabs for every type of work.**
Each room supports up to 3 tabs. Pick the right surface for the job:

- **Markdown** — write docs, notes, or specs with a live rendered preview side by side. Full toolbar for formatting, syntax-highlighted code blocks.
- **Code** — a shared code editor with syntax highlighting across 150+ languages. Switch languages on the fly.
- **Drawing** — a collaborative infinite canvas powered by tldraw. Sketch diagrams, wireframes, or whatever you need.

**Flexible access control.**
Two room types, full control over who can see and edit:

| | Open | Private |
|---|---|---|
| Who can join | Anyone with the link | Invite by email only |
| Guests (no account) | Sign-in required by default | Sign-in required by default |
| Guest override | Allow guests to view or edit | Allow guests to view or edit |

**Live presence.**
See who's in the room with you via overlapping avatars in the top bar. Every user gets a unique color.

**Dark mode default, fully themeable.**
Light, dark, or system. Swap your editor font, adjust font size, toggle word wrap and compact mode — all per-device, no account required.

---

## Tech stack

| | |
|---|---|
| Frontend | React + Vite + TanStack Router |
| Backend | Bun + Fastify |
| Real-time sync | Hocuspocus + Yjs (CRDTs) |
| Auth | Supabase (GitHub + Google OAuth) |
| Database | Postgres via Supabase + Drizzle ORM |
| Editor | CodeMirror 6 |
| Drawing | tldraw v4 |
| Styling | Tailwind v4 |

---

## Sign in

Rumi uses GitHub or Google OAuth — no passwords, no email verification. Click **Sign in**, pick your provider, and you're in.

---

## Rooms

Create a room from the dashboard. Rooms get a generated name like `quiet-fox-42` — rename it anytime by clicking the title.

**Open rooms** — share the link and anyone signed in can join and edit immediately.

**Private rooms** — you control the list. Add collaborators by email from the room settings. They'll be let in when they sign in with that address.

For either type, you can optionally allow unauthenticated guests to view or edit — useful for sharing a read-only snapshot or a public scratchpad.

---

## Tabs

Each room has up to 3 tabs. Click **+** in the tab bar to add one — choose between a text/code tab or a drawing canvas.

- Rename a tab by double-clicking its name in the tab bar.
- Switch a code tab's language from the toolbar.
- Markdown tabs have three view modes: split (source + preview), rendered only, and source only.

---

## Sharing

Hit the **Share** button in the top bar to copy the room link. Anyone you send it to will land directly in the room.
