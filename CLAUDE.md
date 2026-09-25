# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal training app (Portuguese UI): weekly workout plan, running pace-zone calculator, and a training diary. Static site (no build step, no framework, no `package.json`) backed by Supabase (Postgres + Auth) for cross-device sync, installable as a PWA.

## Commands

There is no build, lint, or test tooling in this repo — it's plain HTML/CSS/JS served as static files.

Run the local dev server (required for testing, since the service worker needs `http://`, not `file://`):
```bash
node scripts/dev-server.js        # serves the repo root on http://localhost:5173
```

## Architecture

- **`index.html`** — all markup and CSS (dark/light theme via CSS vars + `prefers-color-scheme`). Two top-level screens toggled by `app.js`: `#authScreen` (login/signup) and `#appScreen` (the three tabs: Plano / Ritmos / Diário).
- **`app.js`** — single IIFE containing all logic: auth, Supabase CRUD, rendering, chart, and PWA service-worker registration. Nothing is exposed on `window`; state (`entries`, `ref`, `planoConcluido`, `editingId`) lives in closure variables.
- **`config.js`** — `window.SUPABASE_CONFIG = { url, anonKey }`. Real credentials are committed here (this is a single-user personal project); the anon key is safe to expose because every table is RLS-scoped to `auth.uid()`. `app.js` checks `configOk()` before creating the Supabase client and shows a setup message in `#authScreen` if the placeholders haven't been replaced.
- **`schema.sql`** — source of truth for the Supabase schema: `treinos` (diary entries), `referencia` (pace test / base pace, one row per user), `plano_progresso` (which plan days are checked off, keyed by `user_id + semana_inicio + dia`). All three tables have RLS enabled with `auth.uid() = user_id` policies.
- **`manifest.json` / `sw.js` / `icons/`** — PWA app-shell. `sw.js` is cache-first for static files and explicitly bypasses any URL containing `supabase.co` so data requests always hit the network.

### Auth: username instead of email

Supabase Auth requires an email, but the UI only asks for **usuário/senha** (no email field, no email-confirmation flow makes sense for a personal app). `app.js`'s `usernameToEmail()` normalizes the entered username (strip accents, lowercase, drop disallowed chars) and appends `@treino.local` to build a synthetic email used for `signUp` / `signInWithPassword`. Because of this, **"Confirm email" must be disabled** in the Supabase project (Authentication → Providers → Email) — the synthetic address can never receive a real confirmation email.

### Data flow

`initApp()` (called from the `onAuthStateChange` callback once a session exists) loads `referencia`, `treinos`, and this week's `plano_progresso` in parallel, then renders everything. Every mutation (save/edit/delete an entry, update pace reference, toggle a plan-day checkbox) writes straight to Supabase first and only updates local state / re-renders on success — there's no offline write queue.

"This week" for `plano_progresso` is computed client-side as the ISO date of the most recent Monday (`weekStartISO()`), using local time (not UTC) to avoid an off-by-one-day bug for the Brazil timezone — see `localISOFromDate()`.

### Dev gotcha: service worker caches aggressively

`sw.js` cache-firsts the app shell (`index.html`, `app.js`, `config.js`, `manifest.json`, icons). When iterating locally, a browser tab that already registered the SW will keep serving the *old* files even after you edit them and reload. Unregister the service worker and clear caches (DevTools → Application, or `navigator.serviceWorker.getRegistrations()` + `caches.keys()` in the console) before verifying a change, or hard-reload with devtools open and "Update on reload" enabled.

## Deployment

Static site, deployed via GitHub → Vercel (no build command needed, Vercel just serves the repo root). Repo: `https://github.com/pedrofgueira7/Sistema-de-Treino`.
