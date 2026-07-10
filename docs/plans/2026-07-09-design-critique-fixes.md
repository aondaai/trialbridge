# Design-Critique Fixes — Implementation Plan

Source: design critique of the UI flow (2026-07-09). Five tasks, mostly independent.

## Global Constraints

- **UI language is English.** Keep "Elegível" wherever it already appears — it is the product's sub-brand name, not a string to translate. Keep proper nouns untranslated: site names (Hospital Bandeirantes Oncology Network, Instituto Sul de Oncologia, Clínica Norte Câncer), cities (São Paulo, Porto Alegre, Recife), persona names (Dra. Camila Rocha, Marcus), and Brazilian macro-region names (Norte, Nordeste, Centro-Oeste, Sudeste, Sul).
- **Number formatting:** `toLocaleString("en-US")` everywhere in the UI. No `"pt-BR"` locale calls may remain in `src/`.
- **Match existing patterns:** server components + server actions where the neighbors use them; existing CSS classes (`.card`, `.sub`, `.muted`, `.btn`, `.privacy`, `.wrap`, `TopBar`); inline styles like the neighbors; no new dependencies; no new CSS files.
- **Test/verify commands** (binaries must run via `./node_modules/.bin/…` because the repo path contains a colon; the npm scripts already do this): `npm test` (vitest), `npm run typecheck`. Run the full suite + typecheck once before committing.
- **Git hygiene:** the working tree contains UNRELATED uncommitted changes under `estimator/` (`estimator/trialbridge/data.py`, `estimator/data/datasus_base/`, `estimator/scripts/materialize_datasus.py`). NEVER stage them. Stage only files you edited, by explicit path (`git add <file>…`). Never use `git add -A`, `git add .`, or `git commit -a`.
- Work happens on the current branch of the `trialbridge/` repo (a nested git repo — run git commands from inside `trialbridge/`).

## Task 1: English pass on the UI

**Files:** `src/app/start/roles.ts`, `src/app/start/page.tsx`, `src/components/Landing.tsx`, `src/app/sponsor/page.tsx`

Translate the remaining Portuguese UI strings to English and unify number locale. Exact values, use verbatim:

1. `src/app/start/roles.ts` — replace the two `ROLE_OPTIONS` entries' strings (keys/hrefs unchanged):
   - sponsor: `title: "I'm a Sponsor"`, `blurb: "Post a protocol and see, per site and per Brazilian region, how many eligible patients exist — with a confidence interval."`, `cta: "Run feasibility →"`
   - site: `title: "I'm a Site / Center"`, `blurb: "List your center and respond to protocols with your real capacity — aggregate counts only, never patient data."`, `cta: "List my site →"`
2. `src/app/start/page.tsx`:
   - metadata title: `"TrialBridge — Choose your role"`
   - `<h1>`: `How do you want to start?`
   - subhead paragraph: `Choose your role to follow the right journey. You can switch later from the top bar.`
   - The eyebrow `TrialBridge · Elegível` stays as-is (brand).
3. `src/components/Landing.tsx`:
   - Line ~116: nav CTA `Entrar no app` → `Open the app` (same `href="/start"`).
   - Mobile menu (`#mobile-menu`): change the primary CTA from `<Link href="/sponsor" …>Run a feasibility check</Link>` to `<Link href="/start" …>Open the app</Link>` so mobile and desktop share the same role-neutral entry point. Other landing CTAs are intentionally role-specific — leave them.
4. `src/app/sponsor/page.tsx`: change all three `toLocaleString("pt-BR")` calls in `NationalCard` to `toLocaleString("en-US")`.

**Tests:** existing `tests/role-select.test.ts` asserts via `ROLE_OPTIONS` values, so it keeps passing. Add one assertion there: no `ROLE_OPTIONS` title/blurb/cta contains any of the characters `ãáâéêíóôõúç` (a cheap regression guard against re-introducing Portuguese). Run full suite + typecheck.

**Acceptance:** `grep -rn 'pt-BR' src/` returns nothing; `/start` renders fully in English; landing has no Portuguese button.

## Task 2: Site onboarding page (`/site/new`)

**Files:** new `src/app/site/new/page.tsx`, new `src/app/site/new/actions.ts`, new `tests/site-onboarding.test.ts`, edits to `src/app/site/page.tsx` and `src/app/scorecard/page.tsx` (empty states only).

**Problem being fixed:** the app starts with an empty database by design, but `upsertSite`/`replacePatients` in `src/lib/data/sites.ts` have no callers — a user choosing the site journey hits a dead end ("No site found for `site-a`…") with no way to list a site.

**Build:**

1. `src/app/site/new/actions.ts` — a `"use server"` action `listSite(formData: FormData)`:
   - Fields: `name` (required, non-empty), `city` (required), `region` (required, one of `Norte | Nordeste | Centro-Oeste | Sudeste | Sul`), `monthlyIncidence` (required, integer ≥ 0), `patientsJson` (required, string).
   - Derive `id` by slugifying the name: lowercase, strip diacritics, non-alphanumeric runs → `-`, trim `-`; export the slugify helper as a named function so it is unit-testable.
   - `country` is fixed `"BR"`; `persona` is the empty string (the demo personas are seed-data flavor, not user input).
   - Parse `patientsJson`: accept either a bare JSON array of patients or an object with a `patients` array (the shape of the generated `data/site-*.json` files). Validate: array, non-empty, every element has a string `id`; on invalid input throw an `Error` with a clear message. Before storing, set each patient's `siteId` to the derived site id (overwriting whatever the JSON carried — same normalization `replacePatients` relies on).
   - Call `upsertSite(meta)` then `replacePatients(id, patients)` from `@/lib/data/sites`, then `revalidatePath("/site")` and `redirect(`/site?site=${id}`)` (use `redirect` from `next/navigation`).
2. `src/app/site/new/page.tsx` — server component, same visual skeleton as the other app screens (`TopBar active="site"`, `main.wrap`, `.card`s):
   - `<h1>List your site</h1>`, subhead: `Declare your center once — patient records stay local; sponsors only ever see aggregate counts.`
   - Include the existing `<PrivacyBanner variant="site" />`.
   - One `.card` with the form (plain `<form action={listSite}>`): text inputs for name and city, a `<select>` for the five regions, a number input for monthly incidence (label: `Monthly incidence (new eligible patients/month)`), and a `<textarea>` for `patientsJson` labelled `Patient records (JSON)` with a `.muted` hint: `Paste a JSON array of patient records, or the contents of a generated data/site-*.json file. Rows never leave this server.`
   - Submit button: `List site →` (class `btn primary`).
3. Empty-state links:
   - `src/app/site/page.tsx`: in the "No site found" branch, link to `/site/new` (e.g. `List your site →`). Also handle the no-consultation branch text staying as-is.
   - `src/app/scorecard/page.tsx`: in the "No site data available yet" branch, link to `/site/new`.
4. `tests/site-onboarding.test.ts` — unit tests for the slugify helper (diacritics: `Clínica Norte Câncer` → `clinica-norte-cancer`) and for the patients-JSON parsing/validation (bare array accepted, `{site, patients}` object accepted, invalid shapes rejected, `siteId` overwritten). Structure the parsing as a pure exported function so tests don't need a DB. Do NOT test the Prisma writes (no DB in CI) — keep DB calls inside the action, thin.

**Acceptance:** from an empty DB, a user can go `/site` → "List your site →" → fill the form (pasting `data/site-a.json` contents) → land on `/site?site=<slug>` and see the matcher run. Tests green.

## Task 3: Sponsor console honest-empty-state polish

**Files:** `src/app/sponsor/page.tsx`

Two changes to `NationalCard`:

1. **Offline state** (`!national`): replace the current dev-instruction copy with user-worded copy, keeping the dev hint visible only outside production:
   - Always shown: `The national estimator service isn't reachable right now — the standardized DataSUS estimate will appear here once it's back online.`
   - Below it, wrapped in `{process.env.NODE_ENV !== "production" && (…)}`: the existing hint (`Start it (uvicorn api:app on port 8421, see .claude/launch.json).`) styled `.muted`, font-size 12.
2. **Zero-cohort state** (`national && national.baseCohort === 0`): today the card headlines `0` with `95% CI 0–0`, which reads as "no patients in Brazil". Restructure so this state never headlines a zero:
   - When `baseCohort === 0`, render the "Observed (direct count…)" figure as the single large stat, and in place of the estimated-eligible stat show a `.muted` block: `No matching cohort in the connected sample` plus the existing explanation paragraph (the `TB_DATASUS_DIR` sentence) kept as-is below.
   - When `baseCohort > 0`, keep the current two-column layout exactly.

**Tests:** none of the existing tests cover this component; keep it that way (server component, presentational). Run full suite + typecheck to prove no regressions.

**Acceptance:** with the estimator offline, no `uvicorn` text in production builds; with the sample dataset (baseCohort 0), the card leads with the observed count, not a red 0.

## Task 4: Human step numbering on /sponsor/new

**Files:** `src/app/sponsor/new/page.tsx`

Rename the step headings (exact values):
- `0 · Fetch from ClinicalTrials.gov (optional)` → `Step 1 · Fetch from ClinicalTrials.gov (optional)`
- `1 · Protocol text` → `Step 2 · Protocol text`
- `2 · Verify parsed criteria` → `Step 3 · Verify parsed criteria`
- `2b · OMOP mapping preview` → `Step 3b · OMOP mapping preview`
- `3 · Post` → `Step 4 · Post`

No other changes. Run full suite + typecheck.

## Task 5: Move the softening panel up on /sponsor

**Files:** `src/app/sponsor/page.tsx`

Reorder the cards in the populated branch so the hero feature isn't below two tables. New order:
1. Responding sites (unchanged)
2. **Protocol softening** (moved up)
3. Deliverable estimate
4. Breakdown by region (Brazil)
5. Modeled-prevalence funnel (conditional, unchanged position relative to criteria)
6. Protocol criteria (parsed & verified)

Move the JSX blocks only — no copy or logic changes. `NationalCard` and the privacy banner stay above the responding-sites card. Run full suite + typecheck.
