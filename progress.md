# TrialBridge — build progress log

Format: `[step] STATUS feature — note`

- [scaffold] DONE project scaffold — package.json, tsconfig, next.config, vitest.config, .gitignore, features.json created; git init done. Node v22.22.2, npm 10.9.7. Building into ./trialbridge (parent path has a colon+spaces, avoided by using clean subdir).
- [engine] DONE F001-F007,F010 — pure matcher core (types/units/engine/soften/aggregate/feasibility) + hero protocol fixture + 19 unit tests. `npm test` = 19/19 green. Covered: pass/fail/unknown, D3 exclusion-unknown→possible, D5 unit conversion, D2 softening split (fromFail vs fromUnknown), D4 composite-group toggle, <5 suppression, R1/R2 feasibility.
- [infra] FIX colon-in-path — the project path contains `Claude:` which corrupts npm's colon-separated PATH injection → `vitest: command not found`. Fixed by calling bins via explicit ./node_modules/.bin/ paths in package.json scripts. Still need to confirm `next dev` tolerates the colon path.
