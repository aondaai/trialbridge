/**
 * Classifier label fixture (F0-3) — the 32 pre-labelled fields from the QuestionBank
 * "Banco de Perguntas" sheet. Each row is ground truth for the archetype router and
 * concept classifier: field text → {archetype, canonical concept, source, strategy}.
 * Generated from seeds/questionbank.seed.json; the F1-2 precision/recall test grades
 * the classifier against these labels. Do not hand-edit — re-run the extractor.
 */

/** One of the four answer archetypes (spec §1). */
export type Archetype = "A" | "B" | "C" | "D";

export interface QuestionBankLabel {
  /** Stable QuestionBank id, e.g. "V-05". */
  id: string;
  section: string;
  /** The field / question text as it appears on the form. */
  field: string;
  archetype: Archetype;
  /** Canonical concept / ontology hint ("—" when not concept-bound). */
  concept: string;
  /** Source system in the DA pipeline (Perfil da Instituição, Catálogo de Capacidade, Query na base, …). */
  source: string;
  strategy: string;
  /** Author-declared auto-answer confidence (Alta/Média/Baixa). */
  autoConfidence: string;
}

export const QUESTION_BANK_LABELS: readonly QuestionBankLabel[] = [
  { id: "G-01", section: "Inf. Gerais", field: "Título do estudo", archetype: "D", concept: "—", source: "Formulário recebido", strategy: "Extrair do próprio doc recebido (parsing)", autoConfidence: "Alta" },
  { id: "G-02", section: "Inf. Gerais", field: "ID do estudo (ex. NIS100547)", archetype: "A", concept: "—", source: "Formulário recebido", strategy: "Extrair; se ausente, \"Concept under review\"", autoConfidence: "Alta" },
  { id: "G-03", section: "Inf. Gerais", field: "Nome/cargo/e-mail do respondente", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Lookup fixo", autoConfidence: "Alta" },
  { id: "I-01", section: "Instituição", field: "Nome / endereço / e-mail / site", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Lookup fixo", autoConfidence: "Alta" },
  { id: "R-01", section: "Responsável", field: "Nome, formação, cargo do responsável pela base", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Lookup fixo", autoConfidence: "Alta" },
  { id: "D-01", section: "Descrição", field: "Tipo de base (claims / EMR / farmácia / NLP de texto clínico...)", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Checkbox pré-configurado", autoConfidence: "Alta" },
  { id: "P-01", section: "Interesse", field: "Interesse em participar (Sim/Não) + justificativa", archetype: "D", concept: "—", source: "Regra + template", strategy: "Regra de negócio; narrativa por LLM", autoConfidence: "Média" },
  { id: "X-01", section: "Desafios", field: "Principais desafios (volume, elegibilidade, prazo)", archetype: "D", concept: "—", source: "Templates + histórico", strategy: "LLM ancorado em formulários anteriores", autoConfidence: "Média" },
  { id: "TA-01", section: "Bloco TA", field: "Base é referência/volume relevante na área terapêutica?", archetype: "B", concept: "—", source: "Catálogo de Capacidade", strategy: "Lookup + contagem de suporte", autoConfidence: "Média" },
  { id: "TA-02", section: "Bloco TA", field: "Nº aproximado de pacientes na base", archetype: "C", concept: "—", source: "Query na base", strategy: "COUNT(distinct patient)", autoConfidence: "Alta" },
  { id: "V-01", section: "Variáveis", field: "Idade", archetype: "B", concept: "Demográfico: idade (birthdate)", source: "Catálogo de Capacidade", strategy: "Lookup: Disponível/Fonte/Completude", autoConfidence: "Alta" },
  { id: "V-02", section: "Variáveis", field: "Sexo / gênero", archetype: "B", concept: "Demográfico: sexo", source: "Catálogo de Capacidade", strategy: "Lookup", autoConfidence: "Alta" },
  { id: "V-03", section: "Variáveis", field: "Etnia / raça / cor", archetype: "B", concept: "Demográfico: raça", source: "Catálogo de Capacidade", strategy: "Lookup (frequentemente \"Parcial\")", autoConfidence: "Alta" },
  { id: "V-04", section: "Variáveis", field: "Tipo de cobertura / pagador", archetype: "B", concept: "Demográfico: payer", source: "Catálogo de Capacidade", strategy: "Lookup", autoConfidence: "Alta" },
  { id: "V-05", section: "Variáveis", field: "Diagnóstico principal (ex. DII, dislipidemia)", archetype: "B", concept: "CID-10 (K50/K51; E78)", source: "Catálogo de Capacidade", strategy: "Lookup por term_code + método (NLP/CID)", autoConfidence: "Alta" },
  { id: "V-06", section: "Variáveis", field: "Diagnóstico ativo confirmável", archetype: "B", concept: "Assertion = PRESENTE", source: "Catálogo de Capacidade", strategy: "Lookup: NER + assertion detection", autoConfidence: "Alta" },
  { id: "V-07", section: "Variáveis", field: "Data do diagnóstico", archetype: "B", concept: "Temporal: document_date", source: "Catálogo de Capacidade", strategy: "Lookup", autoConfidence: "Alta" },
  { id: "V-08", section: "Variáveis", field: "Comorbidades (IAM, AVC, DAP, DM2, HAS, DRC, IC)", archetype: "B", concept: "CID-10 múltiplos", source: "Catálogo de Capacidade", strategy: "Lookup por lista de conceitos", autoConfidence: "Alta" },
  { id: "V-09", section: "Variáveis", field: "Resultados laboratoriais (LDL, HbA1c, PCR...)", archetype: "B", concept: "LOINC / lab estruturado", source: "Catálogo de Capacidade", strategy: "Lookup: valor/unidade/data/frequência", autoConfidence: "Alta" },
  { id: "V-10", section: "Variáveis", field: "Medicamentos (classe/molécula/dose/via)", archetype: "B", concept: "ATC / prescrição-dispensação", source: "Catálogo de Capacidade", strategy: "Lookup: tipo de fonte do dado de medicação", autoConfidence: "Alta" },
  { id: "V-11", section: "Variáveis", field: "Padrão/sequência de tratamento (switch, persistência)", archetype: "B", concept: "Derivada de medicação", source: "Catálogo de Capacidade", strategy: "Lookup: capacidade de derivação", autoConfidence: "Média" },
  { id: "V-12", section: "Variáveis", field: "Utilização de recursos (hospitalização, PS, óbito, custo)", archetype: "B", concept: "Encontro / evento", source: "Catálogo de Capacidade", strategy: "Lookup por tipo de evento", autoConfidence: "Alta" },
  { id: "V-13", section: "Variáveis", field: "Texto livre / NLP (tipos de doc, conceitos extraíveis)", archetype: "B", concept: "NLP / NER", source: "Catálogo de Capacidade", strategy: "Lookup: capacidade de NLP validada", autoConfidence: "Alta" },
  { id: "POP-01", section: "População", field: "Idade >=18 (ou >=16) no index date", archetype: "C", concept: "Critério de inclusão", source: "Query na base", strategy: "Filtro + COUNT", autoConfidence: "Alta" },
  { id: "POP-02", section: "População", field: "Diagnóstico no período de interesse (index 2019-2025)", archetype: "C", concept: "Critério + janela", source: "Query na base", strategy: "Filtro + COUNT", autoConfidence: "Alta" },
  { id: "CNT-01", section: "Contagens", field: "N por coorte/subgrupo (ex. adultos com dislipidemia)", archetype: "C", concept: "Coorte definida", source: "Query na base", strategy: "Coorte parametrizada -> N estimado", autoConfidence: "Alta" },
  { id: "EQ-01", section: "Equipe", field: "Papéis disponíveis (PM, epi, bioest., programador, SME)", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Checkbox fixo", autoConfidence: "Alta" },
  { id: "CP-01", section: "Compliance", field: "Base anonimizada / pseudo / identificável", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Lookup fixo", autoConfidence: "Alta" },
  { id: "CP-02", section: "Compliance", field: "Aprovações necessárias (CEP/CONEP, LGPD)", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Lookup fixo", autoConfidence: "Alta" },
  { id: "CT-01", section: "Contratação", field: "Prazos de negociação / assinatura digital", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Lookup fixo", autoConfidence: "Alta" },
  { id: "LIM-01", section: "Limitações", field: "Principais limitações metodológicas da base", archetype: "D", concept: "—", source: "Templates + histórico", strategy: "LLM ancorado; revisão humana obrigatória", autoConfidence: "Baixa" },
  { id: "MAT-01", section: "Materiais", field: "Dicionário de dados / fluxograma disponível?", archetype: "A", concept: "—", source: "Perfil da Instituição", strategy: "Checkbox fixo", autoConfidence: "Alta" },
];

/** Count of labels per archetype — a quick sanity anchor (A:10 B:14 C:4 D:4). */
export const ARCHETYPE_COUNTS: Record<Archetype, number> = QUESTION_BANK_LABELS.reduce(
  (acc, l) => ({ ...acc, [l.archetype]: acc[l.archetype] + 1 }),
  { A: 0, B: 0, C: 0, D: 0 } as Record<Archetype, number>,
);
