/**
 * Feasibility Autofill — review workspace (F4-3, Camila track).
 *
 * The site-side inbox + review surface. Reads the seeded canonical template and the
 * site's capability catalog / institution profile, and renders each section with its
 * dominant archetype and provenance rules. Incoming FeasibilityRequests (once sponsors
 * dispatch them, F6) list here for section-by-section review.
 *
 * The HITL invariant is stated in the UI and enforced in src/lib/feasibility-autofill/review.ts:
 * archetype-D (LLM) answers are pre-flagged and never auto-approved.
 */

import { prisma } from "@/lib/db";
import { TopBar } from "@/components/ui";
import { CANONICAL_SECTIONS, primaryArchetype } from "@/lib/feasibility-autofill/canonicalTemplate";

export const dynamic = "force-dynamic";

const DEMO_SITE_ID = "site-ihealth-demo";

const ARCHETYPE_UI: Record<string, { color: string; label: string }> = {
  A: { color: "#6A1B9A", label: "A · Perfil (lookup)" },
  B: { color: "#1565C0", label: "B · Catálogo (lookup)" },
  C: { color: "#E08A2B", label: "C · Contagem (query)" },
  D: { color: "#C62828", label: "D · Narrativa (LLM, revisão)" },
};

export default async function FeasibilityWorkspace() {
  const [requests, catalogCount, profile, template] = await Promise.all([
    prisma.feasibilityRequest.findMany({ where: { siteId: DEMO_SITE_ID }, orderBy: { createdAt: "desc" } }),
    prisma.capabilityCatalog.count({ where: { siteId: DEMO_SITE_ID } }),
    prisma.institutionProfile.findFirst({ where: { siteId: DEMO_SITE_ID } }),
    prisma.formTemplate.findFirst({ orderBy: { createdAt: "desc" } }),
  ]).catch(() => [[], 0, null, null] as const);

  return (
    <>
      <TopBar active="site" />
      <main className="wrap" style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem" }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700 }}>Feasibility Autofill — Bancada de revisão</h1>
        <p style={{ color: "#555", marginTop: 4 }}>
          Cada campo do formulário é roteado para um dos quatro arquétipos. A/B/C são
          determinísticos e carregam proveniência; D é rascunho por LLM e exige aprovação
          humana — nunca aprovado automaticamente.
        </p>

        <section style={{ display: "flex", gap: 12, margin: "1rem 0", flexWrap: "wrap" }}>
          <StatCard label="Perfil da instituição" value={profile ? "configurado" : "pendente"} />
          <StatCard label="Catálogo de capacidade" value={`${catalogCount} conceitos`} />
          <StatCard label="Template reconhecido" value={template?.name ?? "—"} />
          <StatCard label="Solicitações na caixa" value={String(requests.length)} />
        </section>

        {requests.length === 0 && (
          <div
            style={{ border: "1px dashed #cbd5e1", borderRadius: 8, padding: "1rem", background: "#f8fafc", color: "#475569" }}
          >
            Nenhuma solicitação de feasibility ainda. Quando um patrocinador enviar um
            formulário, ele aparece aqui para revisão seção a seção.
          </div>
        )}

        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "1.5rem 0 .5rem" }}>
          Modelo canônico ({CANONICAL_SECTIONS.length} seções)
        </h2>
        <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {CANONICAL_SECTIONS.map((s) => {
            const a = primaryArchetype(s);
            const ui = ARCHETYPE_UI[a];
            return (
              <li
                key={s.idx}
                style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px" }}
              >
                <span style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums", width: 20 }}>{s.idx}</span>
                <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                <span
                  style={{ background: ui.color, color: "white", fontSize: ".72rem", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}
                >
                  {ui.label}
                </span>
              </li>
            );
          })}
        </ol>
      </main>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", minWidth: 140 }}>
      <div style={{ fontSize: ".72rem", color: "#64748b", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}
