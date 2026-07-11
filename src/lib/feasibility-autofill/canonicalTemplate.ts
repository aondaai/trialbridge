/**
 * The canonical feasibility form template (16 sections), embedded so ingestion can
 * recognize a sponsor form and route each section to its dominant archetype without a
 * filesystem read. Mirrors FormTemplate seeded from the QuestionBank "Modelo Canônico".
 * Generated from seeds/questionbank.seed.json — do not hand-edit.
 */

import type { Archetype } from "./fixtures/questionBankLabels";

export interface CanonicalSection {
  idx: number;
  name: string;
  /** Free-text description of typical content (from the workbook). */
  content: string;
  /** Dominant archetype(s), verbatim from the workbook (e.g. "A", "B / C", "D / A"). */
  archetype: string;
  variesPerStudy: string;
}

export const CANONICAL_FINGERPRINT = "questionbank-canonical-v1";
export const CANONICAL_NAME = "DoctorAssistant Feasibility — Canonical Model (16 sections)";

export const CANONICAL_SECTIONS: readonly CanonicalSection[] = [
  { idx: 1, name: "Informações Gerais", content: "Título do estudo, ID do estudo, nome/cargo/e-mail do respondente, data", archetype: "D / A", variesPerStudy: "Sim (título e ID)" },
  { idx: 2, name: "Informações da Instituição", content: "Nome, endereço, e-mail, telefone, site da instituição detentora", archetype: "A", variesPerStudy: "Não" },
  { idx: 3, name: "Responsável pela Base", content: "Nome, formação, cargo, contato, experiência do responsável principal", archetype: "A", variesPerStudy: "Não" },
  { idx: 4, name: "Descrição da Base", content: "Checkboxes do tipo de base: claims, EMR/EHR, farmácia, hospitalar, registro, laboratório...", archetype: "A / B", variesPerStudy: "Não" },
  { idx: 5, name: "Interesse em Participar", content: "Sim/Não + justificativa", archetype: "D", variesPerStudy: "Sim" },
  { idx: 6, name: "Desafios", content: "Principais desafios para a condução (volume, elegibilidade, prazo...)", archetype: "D", variesPerStudy: "Sim" },
  { idx: 7, name: "Bloco da Área Terapêutica", content: "Relevância/volume da base na TA; nº aprox. de pacientes; perguntas específicas (ASCVD, DII...)", archetype: "B / C", variesPerStudy: "Sim" },
  { idx: 8, name: "Matriz de Variáveis", content: "Grande grade: Disponível? / Fonte-Campo / Método / Completude / Observações — por variável, em ~9 categorias", archetype: "B", variesPerStudy: "Parcial (conced. clínicos mudam)" },
  { idx: 9, name: "Identificação da População", content: "Sim/Não/Parcial por critério de inclusão/exclusão (idade, diagnóstico, index date...)", archetype: "B / C", variesPerStudy: "Sim" },
  { idx: 10, name: "Contagens Preliminares", content: "Coorte/subgrupo -> N estimado para o período de interesse", archetype: "C", variesPerStudy: "Sim" },
  { idx: 11, name: "Equipe do Estudo", content: "Checkboxes de papéis disponíveis: PM, epidemiologista, bioestatístico, programador, SME...", archetype: "A", variesPerStudy: "Não" },
  { idx: 12, name: "Compliance / Privacidade / CEP", content: "Anonimização, aprovações necessárias, LGPD, comitê de ética", archetype: "A", variesPerStudy: "Não" },
  { idx: 13, name: "Contratação e Prazos", content: "Tempo de negociação, assinatura digital, sequência contrato x parecer CEP", archetype: "A", variesPerStudy: "Não" },
  { idx: 14, name: "Limitações Metodológicas", content: "Texto livre: principais limitações da base para o estudo", archetype: "D", variesPerStudy: "Sim" },
  { idx: 15, name: "Materiais Complementares", content: "Sim/Não: dicionário de dados, fluxograma, publicações, etc.", archetype: "A", variesPerStudy: "Não" },
  { idx: 16, name: "Comentários / Dúvidas", content: "Texto livre", archetype: "D", variesPerStudy: "Sim" },
];

/** Primary archetype for a section = the FIRST letter in its (possibly compound) archetype tag. */
export function primaryArchetype(section: CanonicalSection): Archetype {
  const m = section.archetype.match(/[ABCD]/);
  return (m ? m[0] : "D") as Archetype;
}
