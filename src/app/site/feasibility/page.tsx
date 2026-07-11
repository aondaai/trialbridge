/**
 * Feasibility Autofill — review workspace (F4-3, Camila track).
 *
 * On-brand with the TrialBridge design system (claude.css tokens, the cl- and tb- component
 * classes, MetricChip provenance seals, cohort palette). Renders a LIVE autofill run: it reads
 * the persisted FieldAnswers for the site's latest request and lays them out section by section
 * — each with its archetype, provenance seal, DQ badge, status, and (for D) the LLM draft +
 * adversarial critique. Approve / edit / reject flow through server actions and the pure
 * review.ts HITL logic, where archetype-D is never auto-approved.
 */

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
import { approveField, rejectField, editField, approveHighConfidence } from "./actions";

export const dynamic = "force-dynamic";

const DEMO_SITE_ID = "site-ihealth-demo";
const gap = (n: number) => ({ display: "grid", gap: `var(--cl-space-${n})` }) as const;

export default async function FeasibilityWorkspace() {
  const request = await prisma.feasibilityRequest
    .findFirst({ where: { siteId: DEMO_SITE_ID }, orderBy: { createdAt: "desc" } })
    .catch(() => null);
  const answers = request ? await loadRenderAnswers(request.id) : [];

  // Group answers by section, preserving canonical order.
  const bySection = new Map<string, RenderAnswer[]>();
  for (const a of answers) {
    (bySection.get(a.section) ?? bySection.set(a.section, []).get(a.section)!).push(a);
  }
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
          <h1 style={{ margin: 0 }}>Feasibility autofill — bancada de revisão</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            Cada campo é roteado para um dos quatro arquétipos e respondido com proveniência.
            A, B e C são determinísticos; D é rascunho por LLM e exige aprovação humana — nunca
            aprovado automaticamente.
          </p>
        </header>

        <PrivacyBanner variant="site" />

        {answers.length === 0 || !request ? (
          <div className="cl-alert cl-alert--info">
            <span className="cl-alert__icon">📥</span>
            <div>
              <p className="cl-alert__title">Nenhuma solicitação preenchida ainda</p>
              <p className="cl-alert__body">
                Rode <span className="mono">npm run db:seed-demo-request</span> para carregar uma
                solicitação de exemplo, ou aguarde um patrocinador enviar um formulário.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Request summary */}
            <section className="cl-card">
              <div className="cl-card__header">
                <div>
                  <h2 className="cl-card__title">{request.studyTitle}</h2>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: "var(--cl-text-sm)" }}>
                    {request.sponsorId} · {request.therapeuticArea} ·{" "}
                    <span className="mono">{request.indexWindow}</span>
                  </p>
                </div>
                <form action={approveHighConfidence}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <button className="cl-btn cl-btn--primary cl-btn--sm" type="submit">
                    Aprovar alta confiança
                  </button>
                </form>
              </div>
              <div
                className="cl-card__body"
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--cl-space-5)", alignItems: "end" }}
              >
                <div>
                  <div className="tb-stat__label">Pacientes candidatos</div>
                  <div className="tb-stat">{cohort?.value ?? "—"}</div>
                  {cohort && <div style={{ marginTop: 6 }}><MetricChip metric={cohort} showValue={false} /></div>}
                </div>
                <div>
                  <div className="tb-stat__label">Revisão — {approved}/{total} aprovados</div>
                  <div className="cl-progress" style={{ marginTop: 8 }}>
                    <div className="cl-progress__bar" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            </section>

            {/* Answers grouped by canonical section */}
            {orderedSections.map((section) => (
              <section key={section} className="cl-card">
                <div className="cl-card__header">
                  <h2 className="cl-card__title" style={{ fontSize: "var(--cl-text-md)" }}>{section}</h2>
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
        <span style={{ flex: 1, minWidth: 180, fontSize: "var(--cl-text-sm)", fontWeight: 500 }}>{a.label}</span>
        <MetricChip metric={a.metric} />
        <DQBadge worst={a.dqWorst} title={`conformance ${a.dq.conformance} · completeness ${a.dq.completeness} · plausibility ${a.dq.plausibility}`} />
        <StatusBadge status={a.status} />
      </div>

      {/* D: show the draft + the adversarial critique */}
      {a.archetype === "D" && a.narrativeDraft && (
        <div style={gap(2)}>
          <p className="muted" style={{ margin: 0, fontSize: "var(--cl-text-sm)", lineHeight: 1.5 }}>{a.narrativeDraft}</p>
          {a.critique && (
            <div className={`cl-alert ${a.critique.grounded ? "cl-alert--success" : "cl-alert--warning"}`} style={{ fontSize: "var(--cl-text-xs)" }}>
              <span className="cl-alert__icon">{a.critique.grounded ? "✓" : "⚠"}</span>
              <div>
                <p className="cl-alert__title" style={{ fontSize: "var(--cl-text-xs)" }}>
                  Crítica de fundamentação: {a.critique.grounded ? "fundamentado" : "revisar"}
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

      {/* HITL actions */}
      {actionable && (
        <div style={{ display: "flex", gap: "var(--cl-space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <form action={approveField}>
            <input type="hidden" name="fieldId" value={a.fieldId} />
            <button className="cl-btn cl-btn--secondary cl-btn--sm" type="submit">Aprovar</button>
          </form>
          <form action={rejectField}>
            <input type="hidden" name="fieldId" value={a.fieldId} />
            <button className="cl-btn cl-btn--ghost cl-btn--sm" type="submit">Rejeitar</button>
          </form>
          {a.archetype === "D" && (
            <details style={{ marginLeft: "auto" }}>
              <summary className="cl-btn cl-btn--ghost cl-btn--sm" style={{ listStyle: "none" }}>Editar</summary>
              <form action={editField} style={{ marginTop: "var(--cl-space-2)", display: "grid", gap: "var(--cl-space-2)" }}>
                <input type="hidden" name="fieldId" value={a.fieldId} />
                <textarea className="cl-textarea" name="value" defaultValue={a.narrativeDraft ?? ""} rows={3} />
                <button className="cl-btn cl-btn--secondary cl-btn--sm" type="submit" style={{ justifySelf: "start" }}>
                  Salvar edição
                </button>
              </form>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
