import Anthropic from "@anthropic-ai/sdk";
import type { Criterion } from "@/lib/matcher/types";
import type { ElasticsearchBoolQuery, ElasticsearchQueryPlan, ElasticsearchStage } from "./types";
import { validateElasticsearchQuery, validateElasticsearchPlan } from "./validate";

const MODEL = "claude-opus-4-8";

// Adapted from the sponsor-provided Elasticsearch instructions. The response is
// structured for persistence rather than Markdown so it can be sent directly to
// the funnel database after human review.
const SYSTEM_PROMPT = `Você é um especialista em Elasticsearch para uma base clínica. Transforme cada critério de elegibilidade em UM estágio de funil independente.

REGRAS OBRIGATÓRIAS
- Retorne uma query por critério. O stage_type é INCLUSION para inclusão e EXCLUSION para exclusão.
- A query deve ter somente {"bool":{"must":[],"filter":[],"should":[]}} na raiz. Nunca inclua query, size ou aggs.
- Exclusão é aplicada pelo pipeline como subtração. Nunca use must_not; produza normalmente a condição que identifica os pacientes a remover.
- Campos permitidos no topo: created_at, gender, birthdate. Texto livre: preds.text.
- Nested permitidos: preds.clinical_entities, preds.lab_tests, preds.biomarkers, preds.vital_signs, preds.entities_relations.
- Sempre use nested para clinical_entities, lab_tests, biomarkers e vital_signs; nunca consulte seus campos fora de nested.
- match é a escolha principal para text. Use operator or para sinônimos independentes e operator and para palavras da mesma expressão. Use match_phrase com slop em preds.text. Use term/terms para keyword, range para datas/números e regexp somente se necessário.
- Assuma lowercase e asciifolding; não crie variações de caixa ou acentuação. Considere c/ç apenas quando clinicamente útil.
- Expanda obrigatoriamente termos clínicos com sinônimos, siglas, abreviações e grafias plausíveis, sem termos genéricos.
- clinical_entities: filtre por entity e label. Labels: DISEASE, PROCEDURE, PHARM_SUBSTANCE, SYMPTOM, FINDING, INJURY, SCALE, STAGE, VENT_SUPPORT, MEDICAL_DEVICE, BODY_PART, BODY_LOC.
- Assertion só existe em clinical_entities e só para DISEASE, PROCEDURE, PHARM_SUBSTANCE, SYMPTOM, FINDING, INJURY, VENT_SUPPORT, MEDICAL_DEVICE. Nesses labels use PRESENTE e HISTORICO, salvo negação/incerteza explícita. SCALE, STAGE, BODY_PART e BODY_LOC não recebem assertion.
- lab_tests, biomarkers e vital_signs: nested correto, match em entity e range em result.numeric_value quando houver valor. Nunca use assertion.
- Idade: X anos ou mais => birthdate lte now-Xy/d; menos de X => birthdate gt now-Xy/d.
- Período: range em created_at. Filtros estruturados de idade, sexo e data vão em filter.
- Se should representar alternativas, inclua minimum_should_match: 1 no bool correspondente.
- Nunca invente campo. Prefira uma busca simples em preds.text se o critério não puder ser representado com segurança nos campos estruturados.

CLASSIFICAÇÃO DE AUTOMAÇÃO
- AUTOMATED: o critério inteiro está representado por campos estruturados e limites inequívocos.
- ASSISTED: a query localiza evidência candidata, mas texto clínico, NLP, unidade ou contexto precisa de confirmação humana.
- MANUAL_REVIEW: qualquer parte decisiva não pode ser comprovada pelos campos permitidos (por exemplo consentimento assinado, intenção futura, expectativa de vida ou relação temporal não estruturada). A query pode localizar documentos candidatos, mas não deve ser tratada como gate automático.

Para cada estágio retorne: criterion_id idêntico ao recebido, automation, uma justificativa clínica curta, limitations como lista de ressalvas objetivas e query_json contendo JSON válido. A consulta deve representar somente aquele critério.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          criterion_id: { type: "string" },
          automation: { type: "string", enum: ["AUTOMATED", "ASSISTED", "MANUAL_REVIEW"] },
          rationale: { type: "string" },
          limitations: { type: "array", items: { type: "string" } },
          query_json: { type: "string" },
        },
        required: ["criterion_id", "automation", "rationale", "limitations", "query_json"],
      },
    },
  },
  required: ["stages"],
} as const;

function emptyBool(must: Record<string, unknown>[] = [], filter: Record<string, unknown>[] = []): ElasticsearchBoolQuery {
  return { bool: { must, filter, should: [] } };
}

function phrase(c: Criterion): string {
  return (c.nlpTerms?.length ? c.nlpTerms.join(" ") : c.rawText).trim();
}

/** Safe offline fallback. It favors recall in free text over guessing nonexistent structured fields. */
export function deterministicStage(c: Criterion): ElasticsearchStage {
  let query: ElasticsearchBoolQuery;
  let rationale: string;
  let automation: ElasticsearchStage["automation"];
  let limitations: string[];
  const field = c.field.toLowerCase();
  if (field === "age" && typeof c.value === "number") {
    const older = c.operator === "gte" || c.operator === "gt";
    const boundary = `now-${c.value}y/d`;
    query = emptyBool([], [{ range: { birthdate: { [older ? "lte" : "gt"]: boundary } } }]);
    rationale = "Idade convertida em limite relativo de data de nascimento.";
    automation = "AUTOMATED";
    limitations = [];
  } else if (field === "sex" && typeof c.value === "string") {
    const normalized = /female|feminino|mulher|f$/i.test(c.value) ? "FEMALE" : "MALE";
    query = emptyBool([], [{ term: { gender: normalized } }]);
    rationale = "Sexo aplicado como filtro estruturado exato.";
    automation = "AUTOMATED";
    limitations = [];
  } else {
    query = emptyBool([{ match_phrase: { "preds.text": { query: phrase(c), slop: 3 } } }]);
    rationale = "Busca conservadora no texto clínico, sem presumir um campo estruturado inexistente.";
    automation = !c.baseFit || c.baseFit === "not_answerable" ? "MANUAL_REVIEW" : "ASSISTED";
    limitations = [
      automation === "MANUAL_REVIEW"
        ? "O critério não é comprovável integralmente pelos campos disponíveis; valide no documento-fonte."
        : "A correspondência textual localiza evidência candidata e requer confirmação clínica.",
    ];
  }
  return {
    criterionId: c.id,
    criterionText: c.rawText,
    stageType: c.kind === "exclusion" ? "EXCLUSION" : "INCLUSION",
    automation,
    rationale,
    limitations,
    query,
  };
}

export function deterministicPlan(criteria: Criterion[], note: string): ElasticsearchQueryPlan {
  return { schemaVersion: "elasticsearch-funnel.v1", source: "deterministic", note, stages: criteria.map(deterministicStage) };
}

export async function buildElasticsearchPlan(criteria: Criterion[]): Promise<ElasticsearchQueryPlan> {
  if (!criteria.length) throw new Error("At least one reviewed criterion is required");
  if (!process.env.ANTHROPIC_API_KEY) {
    return deterministicPlan(criteria, "Validated local plan generated from the reviewed criteria.");
  }
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(criteria.map((c) => ({
        criterion_id: c.id, kind: c.kind, field: c.field, operator: c.operator,
        value: c.value, unit: c.unit ?? null, raw_text: c.rawText, nlp_terms: c.nlpTerms ?? [],
      })), null, 2) }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);
    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") throw new Error("Claude returned no text block");
    const raw = JSON.parse(block.text) as { stages: Array<{
      criterion_id: string;
      automation: ElasticsearchStage["automation"];
      rationale: string;
      limitations: string[];
      query_json: string;
    }> };
    const rawById = new Map(raw.stages.map((item) => [item.criterion_id, item]));
    if (raw.stages.length !== criteria.length || rawById.size !== criteria.length) {
      throw new Error("Claude did not return exactly one stage per criterion");
    }
    // The funnel is sequential. Preserve the sponsor-reviewed criterion order
    // even if the model happens to return its objects in a different order.
    const stages = criteria.map((criterion) => {
      const item = rawById.get(criterion.id);
      if (!item) throw new Error(`Claude omitted criterion: ${criterion.id}`);
      const query = JSON.parse(item.query_json) as unknown;
      validateElasticsearchQuery(query);
      return {
        criterionId: criterion.id,
        criterionText: criterion.rawText,
        stageType: criterion.kind === "exclusion" ? "EXCLUSION" as const : "INCLUSION" as const,
        automation: item.automation,
        rationale: item.rationale,
        limitations: item.limitations,
        query,
      };
    });
    const plan: ElasticsearchQueryPlan = {
      schemaVersion: "elasticsearch-funnel.v1", source: "claude", model: response.model,
      note: "Search plan generated from the reviewed criteria and structurally validated.", stages,
    };
    validateElasticsearchPlan(plan);
    return plan;
  } catch {
    return deterministicPlan(criteria, "Validated local plan generated from the reviewed criteria.");
  }
}
