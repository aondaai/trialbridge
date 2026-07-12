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
          <h1 style={{ margin: 0 }}>Feasibility autofill — bancada de revisão</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            Envie um formulário do patrocinador, preencha automaticamente e revise campo a campo.
            A, B e C são determinísticos; D é rascunho por LLM e exige aprovação humana — nunca
            aprovado automaticamente.
          </p>
        </header>

        <PrivacyBanner variant="site" />

        {/* US-1 upload + inbox */}
        <section className="cl-card">
          <div className="cl-card__header">
            <h2 className="cl-card__title" style={{ fontSize: "var(--cl-text-md)" }}>Caixa de entrada</h2>
            <IntakePanel />
          </div>
          <div className="cl-card__body">
            {requests.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: "var(--cl-text-sm)" }}>
                Nenhuma solicitação ainda. Envie um formulário acima, ou rode{" "}
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
                <p className="muted" style={{ margin: "2px 0 0", fontSize: "var(--cl-text-sm)" }}>Recebido — ainda não preenchido.</p>
              </div>
              <form action={runAutofill}>
                <input type="hidden" name="requestId" value={selected.id} />
                <button className="cl-btn cl-btn--primary cl-btn--sm" type="submit">Preencher automaticamente</button>
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
                    <button className="cl-btn cl-btn--ghost cl-btn--sm" type="submit">Repreencher</button>
                  </form>
                  <form action={approveHighConfidence}>
                    <input type="hidden" name="requestId" value={selected.id} />
                    <button className="cl-btn cl-btn--primary cl-btn--sm" type="submit">Aprovar alta confiança</button>
                  </form>
                </div>
              </div>
              <div className="cl-card__body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--cl-space-5)", alignItems: "end" }}>
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
                  <form action={`/site/feasibility/export`} method="get" style={{ marginTop: "var(--cl-space-3)" }}>
                    <input type="hidden" name="req" value={selected.id} />
                    <button className="cl-btn cl-btn--secondary cl-btn--sm" type="submit" formTarget="_blank">
                      Exportar .docx (aprovados)
                    </button>
                  </form>
                </div>
              </div>
            </section>

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
