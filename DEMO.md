# TrialBridge — demo script (3–4 min)

Mapped to actual UI clicks. Stats below are the **defensible** versions from
[`docs/citations.md`](docs/citations.md) — the original spec's "86%" is dropped
(it's a documented misattribution). Rehearse off the seeded snapshot; optionally
set `ANTHROPIC_API_KEY` so the parse step runs live.

**Before you start:** `npm run db:seed` (clean state) → `npm run dev`. Have three
tabs ready: `/sponsor`, `/site`, `/sponsor/new`.

---

## 0 · The thesis — before any software (30–45s)

> "AI is accelerating drug discovery — AI-discovered molecules entering trials went
> from **3 in 2016 to 67 by 2023** (Jayatunga et al., *Drug Discovery Today* 2024).
> More trials are now chasing a shrinking US/EU patient pool, and **roughly one in
> five trials still fails to enroll** (Carlisle et al. 2015). So sponsors are turning
> to emerging markets — clinical trials registered in **Brazil grew ~16×, from about
> 25 in 2000 to ~403 in 2024** (WHO ICTRP), at **40–60% lower cost**. But both sides
> are stuck: sites can't *prove* their patient capacity fast enough, and sponsors have
> no structured way to discover who can actually deliver. TrialBridge is that
> two-sided discovery layer."

*(Say the numbers as ranges/attributed — see citations.md. Do NOT say "86%.")*

---

## 1 · Marcus posts his protocol (20s) — tab `/sponsor/new`

- Text box is pre-filled with the **DESTINY-Breast03** (NCT03529110) eligibility text.
- Click **"Parse with Claude →"**. Claude returns typed, machine-checkable criteria.
  *(No key? It shows the cached verified parse — same verify step, labelled.)*
- Point at a **low-confidence highlighted row** ("≥1 prior line" — the parser flags
  what it can't express cleanly). **"The model tells us where it's unsure, and a
  human confirms — the LLM's weakest step is the one we make auditable."**
- Click **Post**. → lands on the aggregated view for the new consultation.

*(For the rest of the demo, use the seeded hero consultation at `/sponsor` — it has
the two-sided loop with Camila. The post flow above shows the capability.)*

---

## 2 · Camila discovers + responds (20s) — tab `/site`

- "Camila's hospital in São Paulo sees the open consultation." The matcher has run
  over her **220 patients** — show the **per-patient breakdown**: pass / fail /
  **unknown**, each with the source sentence and observed value. **"Deterministic —
  no black box. And 'we don't have her HER2 result' is a first-class answer, not a
  silent no."**
- Click **Submit proof of capacity**. **"One click — only counts leave her site,
  never patient rows."**

---

## 3 · Marcus sees aggregated capacity (60s) — tab `/sponsor` (refresh)

- **3 sites responded**, Hospital Bandeirantes now flagged **live**.
- Point at the **Definite column showing `<5`**: **"Small cells are suppressed —
  the sponsor sees counts, never patients, and can't re-identify a 1–3-patient
  subgroup."**
- **Deliverable estimate**: **"55 in the screening pool, but a match isn't an
  enrollment — funnel-discounted and read as a rate, that's ~47 enrollable over six
  months. We refuse to overstate capacity — that's the industry's whole trust problem."**

---

## 4 · Protocol softening — the hero moment (45s) — same page, scroll to softening

- Click **★ HER2 status = positive**.
- The confirmed-eligible pool jumps **4 → 48**. Then point at the split:
  - **+26** genuinely newly eligible (were HER2-negative/low)
  - **+18** "newly definite *only because HER2 was unknown*" — the caveat bucket
- **"This is the honest version of what TriNetX does behind a consultant. Loosen a
  criterion and the pool grows live — but we split the gain, so a jump driven by
  *missing data* can never be mistaken for real capacity."**

---

## 5 · Close (15s)

> "That's the two-sided discovery layer the market data says is missing: sponsors
> post, sites prove capacity privately, everyone sees counts-not-rows. Deterministic
> and auditable end to end, with Claude only where it belongs — reading the protocol.
> Built in a week, and it's running right now."

---

## Q&A landmines (rehearsed answers)

- **"Is it really federated?"** — "No, and we don't claim it. It's counts-not-rows
  plus small-cell suppression — structural, not differential privacy. True federation
  (data never leaving origin) is the v2 rebuild of the aggregation layer."
- **"Are these the real trial criteria?"** — "Modeled on DESTINY-Breast03 and
  simplified; HER2, ECOG, LVEF and prior-therapy are genuine gates. The organ-function
  cutoffs are illustrative." (See citations.md.)
- **"Where's the source for [stat]?"** — see `docs/citations.md`; use the attributed line.
- **"Isn't your match count the same overcount coordinators distrust?"** — "It's an
  upper-bound screening layer, explicitly discounted for the screen-to-enrol funnel
  and read as a monthly rate. Match ≠ enrollable is on the screen."
