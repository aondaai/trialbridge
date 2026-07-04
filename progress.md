# TrialBridge — build progress log

Format: `[step] STATUS feature — note`

- [scaffold] DONE project scaffold — package.json, tsconfig, next.config, vitest.config, .gitignore, features.json created; git init done. Node v22.22.2, npm 10.9.7. Building into ./trialbridge (parent path has a colon+spaces, avoided by using clean subdir).
- [engine] DONE F001-F007,F010 — pure matcher core (types/units/engine/soften/aggregate/feasibility) + hero protocol fixture + 19 unit tests. `npm test` = 19/19 green. Covered: pass/fail/unknown, D3 exclusion-unknown→possible, D5 unit conversion, D2 softening split (fromFail vs fromUnknown), D4 composite-group toggle, <5 suppression, R1/R2 feasibility.
- [infra] FIX colon-in-path — the project path contains `Claude:` which corrupts npm's colon-separated PATH injection → `vitest: command not found`. Fixed by calling bins via explicit ./node_modules/.bin/ paths in package.json scripts.
- [infra] DECIDED stay in place — verified `next dev` (Next 15.5) boots from the colon path and serves HTTP 200. Colon only broke bin-PATH lookup (now fixed); Next itself tolerates it. No relocation. App shell (layout/globals/page) added.
- [data+demo] DONE F008,F009,F011 + service/loader — hybrid seeded generator (3 sites, 220/185/150 pts, mixed lab units→canonicalized, 30-40% HER2 missingness among breast), `npm run demo` prints the full proof: per-site tri-state, aggregate+suppression, HER2 softening split (definite 4→48; +26 genuine / +18 was-unknown caveat), funnel-discounted ~47 enrollable/6mo, <5 suppression fires on definite subgroup. tests 19/19, typecheck clean. `@/` alias resolves under tsx.
- NOTE: verify NCT03529110 + criteria vs ClinicalTrials.gov before pitch (flagged in hero-protocol.ts + demo output).
