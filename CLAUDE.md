# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Tekne" — a personal training app (Portuguese UI): weekly workout plan (editable), a running pace-zone calculator, a training diary with a daily check-in streak, and a profile screen. Static site (no build step, no framework, no `package.json`) backed by Supabase (Postgres + Auth) for cross-device sync, installable as a PWA. Deployed at `https://tekne-trainer.vercel.app`.

## Commands

There is no build, lint, or test tooling in this repo — it's plain HTML/CSS/JS served as static files.

Run the local dev server (required for testing, since the service worker needs `http://`, not `file://`):
```bash
node scripts/dev-server.js        # serves the repo root on http://localhost:5173
```

## Architecture

- **`index.html`** — all markup and CSS (dark/light theme via CSS vars + `prefers-color-scheme`; the dark theme is a near-black "premium SaaS dashboard" palette with a radial blue glow behind content). Two top-level screens toggled by `app.js`:
  - `#authScreen` — two separate forms, `#loginForm` and `#signupForm` (usuário/senha only; signup also asks for a display name), toggled via a text link rather than merged into one form.
  - `#appScreen` (`.app-shell`) — a sidebar (`.sidebar`) + content (`.main-content`) dashboard layout, not a top tab bar. Four tabs: Plano / Ritmos / Diário / Perfil.
- **`app.js`** — single IIFE containing all logic: auth, Supabase CRUD, rendering, chart, animations, and PWA service-worker registration. Nothing is exposed on `window`; state (`entries`, `ref`, `planoConcluido`, `planoData`, `checkins`, `currentUser`, `editingId`) lives in closure variables.
- **`config.js`** — `window.SUPABASE_CONFIG = { url, anonKey }`. Real credentials are committed here (this is a single-user personal project); the anon key is safe to expose because every table is RLS-scoped to `auth.uid()`. `app.js` checks `configOk()` before creating the Supabase client and shows a setup message in `#authScreen` if the placeholders haven't been replaced.
- **`schema.sql`** — source of truth for the Supabase schema, five tables all RLS-scoped to `auth.uid() = user_id`: `treinos` (diary entries), `referencia` (pace test / base pace, one row per user), `plano_progresso` (which of the 5 plan days are checked off, keyed by `user_id + semana_inicio + dia`), `plano` (the editable weekly plan itself, stored as one JSONB blob per user — see below), `checkins` (one row per user per calendar day, backs the Diário streak strip). The file is idempotent (`create table if not exists`, and `drop policy if exists` before every `create policy`) — safe to re-run wholesale after schema changes instead of hand-writing a migration.
- **`manifest.json` / `sw.js` / `icons/`** — PWA app-shell. `sw.js` is **network-first** for the app shell (deliberately not cache-first — see gotcha below) and always bypasses any URL containing `supabase.co` so data requests hit the network. `icons/tekne-mark.svg` is the source brand mark (the "K" glyph extracted from the real Tekne logo file, scaled to fill most of the icon, on a radial blue/black gradient); `icon-192.png`/`icon-512.png` are rasterized from it and used for the favicon, apple-touch-icon, and PWA manifest icons.

### Auth: username instead of email

Supabase Auth requires an email, but the UI only asks for **usuário/senha** (no email field; no email-confirmation flow makes sense for a personal app). `app.js`'s `usernameToEmail()` normalizes the entered username (Unicode-normalizes and strips accents via `\p{Diacritic}`, lowercases, drops disallowed chars) and appends `@treino.local` to build a synthetic email used for `signUp` / `signInWithPassword`. Because of this:
- **"Confirm email" must stay disabled** in the Supabase project (Authentication → Providers → Email) — the synthetic address can never receive a real confirmation email.
- Consider disabling "Allow new users to sign up" once the owner's account exists, since the signup form is public and anyone with the URL could otherwise self-register (harmless due to RLS, but pointless for a single-user app).
- Display name is separate from the login username: it's stored in Supabase Auth `user_metadata.nome` (set at signup, editable later from the Perfil tab) and falls back to the capitalized username if absent. The Perfil tab also renders a generated avatar (first letter of the display name, background color deterministically hashed from the user's id).

### Sidebar / dashboard layout

`.app-shell` is a flex row: `.sidebar` + `.main-content`. Below the 640px breakpoint the sidebar collapses to an 84px icon-only rail and becomes an off-canvas drawer (`#appScreen.sidebar-open`, with a backdrop and a hamburger button that morphs into an "×"); above 640px it's a persistent 232px icon+label sidebar. A sliding "pill" indicator (`#tabIndicator`) tracks the active nav item; `moveTabIndicator()` repositions it via a double-`requestAnimationFrame` (plus a `setTimeout` fallback) because it must measure the sidebar *after* it becomes visible/laid out — measuring synchronously right after `display` changes can read stale (zero) dimensions.

### Data flow

`initApp()` (called from the `onAuthStateChange` callback once a session exists) loads six things in parallel: `referencia`, `treinos`, this week's `plano_progresso`, the user's `plano`, the current user object, and recent `checkins`. `loadPlanoData()` and `loadCheckins()` are **non-fatal** — if those tables are missing or error out, they fall back to defaults (the hardcoded `DEFAULT_PLANO`, empty check-ins) and just `console.warn`, so an incomplete schema doesn't block the whole app. The other loads are fatal; a failure shows a toast **unless** the error is the transient "JWT issued at future" (client clock skew during token refresh), in which case `initApp()` silently retries itself once after ~1.2s before giving up and toasting.

Every mutation (save/edit/delete a diary entry, update pace reference, toggle a plan-day or check-in day, save the edited plan, update the display name) writes straight to Supabase first and only updates local state / re-renders on success — there's no offline write queue. Errors from these paths go through `showToast(friendlyError(err), 'error')`, not `alert()` (see Toasts below). The two genuinely destructive actions (remove a diary entry, restore the default plan) still use a native `confirm()`.

"This week" for `plano_progresso` is computed client-side as the ISO date of the most recent Monday (`weekStartISO()`); the Diário check-in strip instead runs Sunday→Saturday (`sundayOfCurrentWeek()`). Both use local time (not UTC) to avoid an off-by-one-day bug for the Brazil timezone — see `localISOFromDate()`.

### Editable weekly plan

`plano` stores one JSONB array per user: `[{ dia, daytype, titulo, exercicios: [...] }, ...]` for the 5 training days (the weekend rest day stays hardcoded in `index.html`, it's not tracked/editable). Exercise line strings may contain a `{{ritmo:Leve|Moderado|Longa|Intervalado400}}` token, which `renderExerciseLine()` replaces at render time with the live computed pace range (via `getPaceRanges()`) — so edited plan text keeps the "auto-fills from your pace test" behavior. `DEFAULT_PLANO` in `app.js` is the seed/fallback and what "Restaurar padrão" resets to; nothing is written to `plano` until the user explicitly saves an edit.

### Toasts, not alert()

`showToast(message, type)` renders a dismissing notification in `#toastContainer` instead of blocking the page with `alert()`. Every Supabase-error path in `app.js` uses this now. Native `confirm()` is still used for the two destructive confirmations (delete a diary entry, restore default plan) — those weren't converted since a toast can't collect a yes/no answer.

### Animations

Kept deliberately lightweight (CSS keyframes/transitions + a couple of small JS helpers), and all gated behind `prefers-reduced-motion: reduce`:
- `animateNumber(el, toValue, formatFn)` — count-up for the Diário stats and the streak number, using an ease-out over ~500ms; guards against overlapping calls on the same element via a `data-raw-value` attribute.
- Panel switches, entry add/remove, checkbox/check-in taps, and the sidebar indicator all use CSS `@keyframes` (`panelIn`, `highlight`, `checkPop`, `dayPop`) rather than JS-driven animation, except `animateEntryRemoval()` which measures the entry's real height and transitions it to 0 before the list re-renders (so removing a diary entry collapses smoothly instead of just vanishing).
- Chart.js gets an explicit `animation: { duration, easing }` (duration forced to 0 under reduced-motion) rather than relying on its default.

### Dev gotcha: service worker update strategy

`sw.js` is **network-first**, not cache-first — this was a deliberate fix: an earlier cache-first version meant anyone who had already installed the PWA would keep seeing a stale app shell forever, since the browser only re-checks a service worker's *own* bytes for updates, not the files it cached. Don't revert to cache-first for the app shell. It still falls back to the cache when the network fetch fails (offline support), and it never caches anything under `supabase.co`.

Separately, `sw.js` still caches by filename, so a browser tab that already registered the *old code* will keep serving whatever it cached until you unregister the service worker and clear caches (DevTools → Application, or `navigator.serviceWorker.getRegistrations()` + `caches.keys()` in the console) — needed when iterating locally, less of a concern in production now that clients self-heal via network-first.

## Deployment

Static site, deployed via GitHub → Vercel (no build command needed, Vercel just serves the repo root) at `https://tekne-trainer.vercel.app`. Repo: `https://github.com/pedrofgueira7/Sistema-de-Treino`. Pushing to `main` triggers an automatic Vercel deploy.
