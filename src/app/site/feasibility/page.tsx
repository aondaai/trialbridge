/**
 * Feasibility Autofill — review workspace (F4-3, Camila track).
 *
 * On-brand with the TrialBridge design system (claude.css tokens, the cl- and tb- component
 * classes, MetricChip provenance seals, cohort palette). Reads the seeded canonical template + the
 * site's catalog/profile and lays out each section with its archetype and how it's answered.
 * The HITL invariant (D is LLM-drafted and never auto-approved) is stated in the UI and
 * enforced in src/lib/feasibility-autofill/review.ts.
 */

import { prisma } from "@/lib/db";
import { TopBar, PrivacyBanner, MetricChip, ArchetypeTag } from "@/components/ui";
import { CANONICAL_SECTIONS, primaryArchetype } from "@/lib/feasibility-autofill/canonicalTemplate";
import { siteDeclared, modeled, Confidence, type Metric } from "@/lib/metric";
import type { Archetype } from "@/lib/feasibility-autofill/fixtures/questionBankLabels";

export const dynamic = "force-dynamic";

const DEMO_SITE_ID = "site-ihealth-demo";

/** How each archetype is answered — the routing legend (site-declared vs modeled). */
const ARCHETYPES: Array<{ code: Archetype; role: string; how: string; sample: Metric }> = [
  { code: "A", role: "Perfil da instituição", how: "Lookup determinístico no cadastro.",
    sample: siteDeclared("profile.institution_name", "iHealth (demo)", Confidence.HIGH, { note: "Perfil da instituição" }) },
  { code: "B", role: "Catálogo de capacidade", how: "Lookup por conceito clínico; não mapeado é sinalizado.",
    sample: siteDeclared("capability.ibd", "yes", Confidence.HIGH, { note: "NLP (NER) + assertion detection" }) },
  { code: "C", role: "Contagem de pacientes", how: "Query na base — agregada, <5 suprimido.",
    sample: modeled("cohort.candidates", "42", Confidence.HIGH, { unit: "pacientes", note: "definite + possible, agregada" }) },
  { code: "D", role: "Narrativa", how: "Rascunho por LLM, ancorado em respostas anteriores. Revisão humana obrigatória.",
    sample: modeled("narrative.limitacoes", "rascunho", Confidence.LOW, { note: "Proposto — nunca aprovado automaticamente" }) },
];

/** A representative (value-less) provenance seal per archetype, for the section table. */
const ARCH_SEAL: Record<Archetype, Metric> = {
  A: siteDeclared("s", null, Confidence.HIGH),
  B: siteDeclared("s", null, Confidence.HIGH),
  C: modeled("s", null, Confidence.HIGH),
  D: modeled("s", null, Confidence.LOW),
};
const ARCH_HOW: Record<Archetype, string> = {
  A: "Lookup no perfil",
  B: "Lookup no catálogo",
  C: "Contagem na base",
  D: "Rascunho por LLM",
};

const gap = (n: number) => ({ display: "grid", gap: `var(--cl-space-${n})` }) as const;

export default async function FeasibilityWorkspace() {
  const [requests, catalogCount, profile, template] = await Promise.all([
    prisma.feasibilityRequest.findMany({ where: { siteId: DEMO_SITE_ID }, orderBy: { createdAt: "desc" } }),
    prisma.capabilityCatalog.count({ where: { siteId: DEMO_SITE_ID } }),
    prisma.institutionProfile.findFirst({ where: { siteId: DEMO_SITE_ID } }),
    prisma.formTemplate.findFirst({ orderBy: { createdAt: "desc" } }),
  ]).catch(() => [[], 0, null, null] as const);

  const stats: Array<{ label: string; value: string }> = [
    { label: "Perfil da instituição", value: profile ? "Configurado" : "Pendente" },
    { label: "Catálogo de capacidade", value: `${catalogCount} conceitos` },
    { label: "Template reconhecido", value: template ? "Modelo canônico" : "—" },
    { label: "Solicitações na caixa", value: String(requests.length) },
  ];

  return (
    <>
      <TopBar active="site" />
      <main className="wrap" style={{ ...gap(6) }}>
        <header style={gap(2)}>
          <h1 style={{ margin: 0 }}>Feasibility autofill — bancada de revisão</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            Cada campo do formulário é roteado para um dos quatro arquétipos. A, B e C são
            determinísticos e carregam proveniência; D é rascunho por LLM e exige aprovação
            humana — nunca aprovado automaticamente.
          </p>
        </header>

        <PrivacyBanner variant="site" />

        {/* Summary stats */}
        <section
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--cl-space-3)" }}
        >
          {stats.map((s) => (
            <div key={s.label} className="cl-card cl-card--flat" style={{ padding: "var(--cl-space-4) var(--cl-space-5)" }}>
              <div className="tb-stat__label">{s.label}</div>
              <div className="tb-stat tb-stat--sm">{s.value}</div>
            </div>
          ))}
        </section>

        {/* Archetype legend */}
        <section style={gap(3)}>
          <h2 className="cl-h3" style={{ margin: 0 }}>Como cada campo é respondido</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "var(--cl-space-3)" }}>
            {ARCHETYPES.map((a) => (
              // overflow:visible so the MetricChip's provenance tooltip can escape the card.
              <div key={a.code} className="cl-card" style={{ overflow: "visible" }}>
                <div className="cl-card__body" style={gap(3)}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--cl-space-2)" }}>
                    <ArchetypeTag archetype={a.code} />
                    <strong style={{ fontSize: "var(--cl-text-sm)" }}>{a.role}</strong>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: "var(--cl-text-sm)", lineHeight: 1.45 }}>{a.how}</p>
                  <MetricChip metric={a.sample} size="md" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Inbox / empty state */}
        {requests.length === 0 && (
          <div className="cl-alert cl-alert--info">
            <span className="cl-alert__icon">📥</span>
            <div>
              <p className="cl-alert__title">Nenhuma solicitação de feasibility ainda</p>
              <p className="cl-alert__body">
                Quando um patrocinador enviar um formulário, ele aparece aqui para revisão seção a
                seção — com proveniência, contagens agregadas e rascunhos para aprovar.
              </p>
            </div>
          </div>
        )}

        {/* Canonical model */}
        <section style={gap(3)}>
          <h2 className="cl-h3" style={{ margin: 0 }}>
            Modelo canônico <span className="muted mono" style={{ fontSize: "var(--cl-text-sm)" }}>({CANONICAL_SECTIONS.length} seções)</span>
          </h2>
          <div className="cl-table-wrap">
            <table className="cl-table cl-table--hover">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>Seção</th>
                  <th style={{ width: 96 }}>Arquétipo</th>
                  <th style={{ width: 260 }}>Proveniência</th>
                </tr>
              </thead>
              <tbody>
                {CANONICAL_SECTIONS.map((s) => {
                  const a = primaryArchetype(s);
                  return (
                    <tr key={s.idx}>
                      <td className="mono" style={{ color: "var(--cl-text-muted)" }}>{s.idx}</td>
                      <td style={{ fontWeight: 500 }}>{s.name}</td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <ArchetypeTag archetype={a} />
                          <span className="muted" style={{ fontSize: "var(--cl-text-xs)" }}>{ARCH_HOW[a]}</span>
                        </span>
                      </td>
                      <td><MetricChip metric={ARCH_SEAL[a]} showValue={false} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
