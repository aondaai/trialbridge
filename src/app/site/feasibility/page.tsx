/**
 * Feasibility Autofill — review workspace (F4-3, Camila track).
 *
 * On-brand with the TrialBridge design system (claude.css tokens, the cl- and tb- component
 * classes, MetricChip provenance seals, cohort palette). Full loop: a sponsor form is uploaded
 * (US-1) → lands in the inbox → auto-filled (US-2) → reviewed here section by section with
 * provenance seals, DQ badges, status, and (for D) the LLM draft + adversarial critique. Approve /
 * edit / reject flow through server actions and the pure review.ts HITL logic (D never auto-approved).
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  TopBar,
  PrivacyBanner,
  MetricChip,
  ArchetypeTag,
  DQBadge,
  StatusBadge,
} from "@/components/ui";
import { loadRenderAnswers, type RenderAnswer } from "@/lib/feasibility-autofill/persist";
import { CANONICAL_SECTIONS } from "@/lib/feasibility-autofill/canonicalTemplate";
import { approveField, rejectField, editField, approveHighConfidence, runAutofill } from "./actions";
import { IntakePanel } from "./IntakePanel";

export const dynamic = "force-dynamic";

const DEMO_SITE_ID = "site-ihealth-demo";
const gap = (n: number) => ({ display: "grid", gap: `var(--cl-space-${n})` }) as const;

const SECTION_LABELS: Record<string, string> = {
  "Informações Gerais": "General Information",
  "Informações da Instituição": "Institution Information",
  "Responsável pela Base": "Database Owner",
  "Descrição da Base": "Database Description",
  "Interesse em Participar": "Interest in Participating",
  Desafios: "Challenges",
  "Bloco da Área Terapêutica": "Therapeutic Area",
  "Matriz de Variáveis": "Variable Matrix",
  "Identificação da População": "Population Identification",
  "Contagens Preliminares": "Preliminary Counts",
  "Equipe do Estudo": "Study Team",
  "Compliance / Privacidade / CEP": "Compliance / Privacy / Ethics Committee",
  "Contratação e Prazos": "Contracting and Timelines",
  "Limitações Metodológicas": "Methodological Limitations",
  "Materiais Complementares": "Supporting Materials",
  "Comentários / Dúvidas": "Comments / Questions",
};

function displaySection(section: string) {
  return SECTION_LABELS[section] ?? section;
}

const FIELD_LABELS: Record<string, string> = {
  "Título do estudo": "Study title",
  "ID do estudo (ex. NIS100547)": "Study ID (e.g. NIS100547)",
  "Nome/cargo/e-mail do respondente": "Respondent name, role, and email",
  "Nome / endereço / e-mail / site": "Name, address, email, and website",
  "Nome, formação, cargo do responsável pela base": "Database owner name, qualifications, and role",
  "Tipo de base (claims / EMR / farmácia / NLP de texto clínico...)": "Database type (claims / EMR / pharmacy / clinical-text NLP...)",
  "Interesse em participar (Sim/Não) + justificativa": "Interest in participating (Yes/No) and rationale",
  "Principais desafios (volume, elegibilidade, prazo)": "Main challenges (volume, eligibility, timeline)",
  "Base é referência/volume relevante na área terapêutica?": "Is the database a reference or relevant-volume source in the therapeutic area?",
  "Idade": "Age",
  "Sexo / gênero": "Sex / gender",
  "Etnia / raça / cor": "Ethnicity / race / color",
  "Tipo de cobertura / pagador": "Coverage type / payer",
  "Diagnóstico principal (ex. DII, dislipidemia)": "Primary diagnosis (e.g. IBD, dyslipidemia)",
  "Diagnóstico ativo confirmável": "Confirmable active diagnosis",
  "Data do diagnóstico": "Diagnosis date",
  "Comorbidades (IAM, AVC, DAP, DM2, HAS, DRC, IC)": "Comorbidities (MI, stroke, PAD, T2D, hypertension, CKD, HF)",
  "Resultados laboratoriais (LDL, HbA1c, PCR...)": "Laboratory results (LDL, HbA1c, CRP...)",
  "Medicamentos (classe/molécula/dose/via)": "Medications (class/molecule/dose/route)",
  "Padrão/sequência de tratamento (switch, persistência)": "Treatment pattern/sequence (switch, persistence)",
  "Utilização de recursos (hospitalização, PS, óbito, custo)": "Resource use (hospitalization, emergency care, death, cost)",
  "Texto livre / NLP (tipos de doc, conceitos extraíveis)": "Free text / NLP (document types, extractable concepts)",
  "Idade >=18 (ou >=16) no index date": "Age ≥18 (or ≥16) on the index date",
  "Diagnóstico no período de interesse (index 2019-2025)": "Diagnosis in the period of interest (index 2019–2025)",
  "N por coorte/subgrupo (ex. adultos com dislipidemia)": "N by cohort/subgroup (e.g. adults with dyslipidemia)",
  "Papéis disponíveis (PM, epi, bioest., programador, SME)": "Available roles (PM, epidemiologist, biostatistician, programmer, SME)",
  "Base anonimizada / pseudo / identificável": "Anonymized / pseudonymized / identifiable database",
  "Aprovações necessárias (CEP/CONEP, LGPD)": "Required approvals (CEP/CONEP, LGPD)",
  "Prazos de negociação / assinatura digital": "Negotiation timelines / digital signature",
  "Principais limitações metodológicas da base": "Main methodological limitations of the database",
  "Dicionário de dados / fluxograma disponível?": "Data dictionary / flowchart available?",
};

function displayFieldLabel(label: string) {
  return FIELD_LABELS[label] ?? label;
}

export default async function FeasibilityWorkspace({
  searchParams,
}: {
  searchParams: Promise<{ req?: string }>;
}) {
  const { req } = await searchParams;
  const requests = await prisma.feasibilityRequest
    .findMany({ where: { siteId: DEMO_SITE_ID }, orderBy: { createdAt: "desc" } })
    .catch(() => []);
  const selected = requests.find((r) => r.id === req) ?? requests[0] ?? null;
  const answers = selected ? await loadRenderAnswers(selected.id) : [];

  // Group answers by section, preserving canonical order.
  const bySection = new Map<string, RenderAnswer[]>();
  for (const a of answers) (bySection.get(a.section) ?? bySection.set(a.section, []).get(a.section)!).push(a);
  const orderedSections = CANONICAL_SECTIONS.map((s) => s.name).filter((n) => bySection.has(n));

  const cohort = answers.find((a) => a.archetype === "C")?.metric;
  const total = answers.length;
  const approved = answers.filter((a) => a.status === "approved").length;
  const pct = total ? Math.round((approved / total) * 100) : 0;

  return (
    <>
      <TopBar active="site" />
      <main className="wrap" style={gap(6)}>
        <header style={gap(2)}>
          <h1 style={{ margin: 0 }}>Feasibility autofill — review workspace</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            Upload a sponsor form, autofill it, and review each field. A, B, and C are
            deterministic; D is an LLM draft that requires human approval and is never
            approved automatically.
          </p>
        </header>

        <PrivacyBanner variant="site" />

        {/* US-1 upload + inbox */}
        <section className="cl-card">
          <div className="cl-card__header">
            <h2 className="cl-card__title" style={{ fontSize: "var(--cl-text-md)" }}>Inbox</h2>
            <IntakePanel />
          </div>
          <div className="cl-card__body">
            {requests.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: "var(--cl-text-sm)" }}>
                No requests yet. Upload a form above, or run{" "}
                <span className="mono">npm run db:seed-demo-request</span>.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, ...gap(2) }}>
                {requests.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/site/feasibility?req=${r.id}`}
                      style={{
                        display: "flex", alignItems: "center", gap: "var(--cl-space-3)", textDecoration: "none",
                        padding: "8px 12px", borderRadius: "var(--cl-radius-md)", color: "var(--cl-text)",
                        background: selected?.id === r.id ? "var(--cl-accent-subtle)" : "transparent",
                        border: "1px solid var(--cl-border)",
                      }}
                    >
                      <span style={{ flex: 1, fontWeight: 500, fontSize: "var(--cl-text-sm)" }}>{r.studyTitle}</span>
                      {r.sponsorId && <span className="muted" style={{ fontSize: "var(--cl-text-xs)" }}>{r.sponsorId}</span>}
                      <StatusBadge status={r.status === "received" ? "proposed" : r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {selected && answers.length === 0 && (
          <section className="cl-card">
            <div className="cl-card__body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--cl-space-4)", flexWrap: "wrap" }}>
              <div>
                <p style={{ margin: 0, fontWeight: 500 }}>{selected.studyTitle}</p>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: "var(--cl-text-sm)" }}>Received — not yet autofilled.</p>
              </div>
              <form action={runAutofill}>
                <input type="hidden" name="requestId" value={selected.id} />
                <button className="cl-btn cl-btn--primary cl-btn--sm" type="submit">Autofill</button>
              </form>
            </div>
          </section>
        )}

        {selected && answers.length > 0 && (
          <>
            {/* Request summary */}
            <section className="cl-card">
              <div className="cl-card__header">
                <div>
                  <h2 className="cl-card__title">{selected.studyTitle}</h2>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: "var(--cl-text-sm)" }}>
                    {selected.sponsorId} · {selected.therapeuticArea} ·{" "}
                    <span className="mono">{selected.indexWindow}</span>
                  </p>
                </div>
                <div style={{ display: "flex", gap: "var(--cl-space-2)" }}>
                  <form action={runAutofill}>
                    <input type="hidden" name="requestId" value={selected.id} />
                    <button className="cl-btn cl-btn--ghost cl-btn--sm" type="submit">Refill</button>
                  </form>
                  <form action={approveHighConfidence}>
                    <input type="hidden" name="requestId" value={selected.id} />
                    <button className="cl-btn cl-btn--primary cl-btn--sm" type="submit">Approve high-confidence fields</button>
                  </form>
                </div>
              </div>
              <div className="cl-card__body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--cl-space-5)", alignItems: "end" }}>
                <div>
                  <div className="tb-stat__label">Candidate patients</div>
                  <div className="tb-stat">{cohort?.value ?? "—"}</div>
                  {cohort && <div style={{ marginTop: 6 }}><MetricChip metric={cohort} showValue={false} /></div>}
                </div>
                <div>
                  <div className="tb-stat__label">Review — {approved}/{total} approved</div>
                  <div className="cl-progress" style={{ marginTop: 8 }}>
                    <div className="cl-progress__bar" style={{ width: `${pct}%` }} />
                  </div>
                  <form action={`/site/feasibility/export`} method="get" style={{ marginTop: "var(--cl-space-3)" }}>
                    <input type="hidden" name="req" value={selected.id} />
                    <button className="cl-btn cl-btn--secondary cl-btn--sm" type="submit" formTarget="_blank">
                      Export .docx (approved fields)
                    </button>
                  </form>
                </div>
              </div>
            </section>

            {orderedSections.map((section) => (
              <section key={section} className="cl-card">
                <div className="cl-card__header">
                  <h2 className="cl-card__title" style={{ fontSize: "var(--cl-text-md)" }}>{displaySection(section)}</h2>
                </div>
                <div style={gap(0)}>
                  {bySection.get(section)!.map((a) => (
                    <FieldRow key={a.fieldId} a={a} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </>
  );
}

function FieldRow({ a }: { a: RenderAnswer }) {
  const actionable = a.status === "proposed" || a.status === "edited";
  return (
    <div style={{ padding: "var(--cl-space-4) var(--cl-space-5)", borderTop: "1px solid var(--cl-border)", display: "grid", gap: "var(--cl-space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--cl-space-3)", flexWrap: "wrap" }}>
        <ArchetypeTag archetype={a.archetype} />
        <span style={{ flex: 1, minWidth: 180, fontSize: "var(--cl-text-sm)", fontWeight: 500 }}>{displayFieldLabel(a.label)}</span>
        <MetricChip metric={a.metric} />
        <DQBadge worst={a.dqWorst} title={`conformance ${a.dq.conformance} · completeness ${a.dq.completeness} · plausibility ${a.dq.plausibility}`} />
        <StatusBadge status={a.status} />
      </div>

      {a.archetype === "D" && a.narrativeDraft && (
        <div style={gap(2)}>
          <p className="muted" style={{ margin: 0, fontSize: "var(--cl-text-sm)", lineHeight: 1.5 }}>{a.narrativeDraft}</p>
          {a.critique && (
            <div className={`cl-alert ${a.critique.grounded ? "cl-alert--success" : "cl-alert--warning"}`} style={{ fontSize: "var(--cl-text-xs)" }}>
              <span className="cl-alert__icon">{a.critique.grounded ? "✓" : "⚠"}</span>
              <div>
                <p className="cl-alert__title" style={{ fontSize: "var(--cl-text-xs)" }}>
                  Grounding review: {a.critique.grounded ? "grounded" : "needs review"}
                </p>
                {a.critique.issues.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                    {a.critique.issues.map((iss, i) => (
                      <li key={i}>{iss}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {actionable && (
        <div style={{ display: "flex", gap: "var(--cl-space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <form action={approveField}>
            <input type="hidden" name="fieldId" value={a.fieldId} />
            <button className="cl-btn cl-btn--secondary cl-btn--sm" type="submit">Approve</button>
          </form>
          <form action={rejectField}>
            <input type="hidden" name="fieldId" value={a.fieldId} />
            <button className="cl-btn cl-btn--ghost cl-btn--sm" type="submit">Reject</button>
          </form>
          {a.archetype === "D" && (
            <details style={{ marginLeft: "auto" }}>
              <summary className="cl-btn cl-btn--ghost cl-btn--sm" style={{ listStyle: "none" }}>Edit</summary>
              <form action={editField} style={{ marginTop: "var(--cl-space-2)", display: "grid", gap: "var(--cl-space-2)" }}>
                <input type="hidden" name="fieldId" value={a.fieldId} />
                <textarea className="cl-textarea" name="value" defaultValue={a.narrativeDraft ?? ""} rows={3} />
                <button className="cl-btn cl-btn--secondary cl-btn--sm" type="submit" style={{ justifySelf: "start" }}>
                  Save edit
                </button>
              </form>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
