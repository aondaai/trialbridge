import type { ElasticsearchBoolQuery, ElasticsearchQueryPlan } from "./types";

const ROOT_FIELDS = new Set(["created_at", "gender", "birthdate", "preds.text"]);
const NESTED_PATHS = new Set([
  "preds.clinical_entities",
  "preds.lab_tests",
  "preds.biomarkers",
  "preds.vital_signs",
  "preds.entities_relations",
]);

const EXACT_NESTED_FIELDS = new Set([
  "preds.clinical_entities.entity",
  "preds.clinical_entities.label",
  "preds.clinical_entities.assertion",
  "preds.lab_tests.entity",
  "preds.lab_tests.result.numeric_value",
  "preds.biomarkers.entity",
  "preds.biomarkers.result.numeric_value",
  "preds.vital_signs.entity",
  "preds.vital_signs.result.numeric_value",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateField(field: string, nestedPath?: string): void {
  if (ROOT_FIELDS.has(field)) {
    if (nestedPath) throw new Error(`Root field ${field} cannot be queried inside nested path ${nestedPath}`);
    return;
  }
  if (!nestedPath) throw new Error(`Nested field ${field} must be queried inside a nested clause`);
  if (!field.startsWith(`${nestedPath}.`)) throw new Error(`Field ${field} does not belong to nested path ${nestedPath}`);
  if (nestedPath !== "preds.entities_relations" && !EXACT_NESTED_FIELDS.has(field)) {
    throw new Error(`Elasticsearch field is not allowed: ${field}`);
  }
}

function validateLeaf(name: string, value: unknown, nestedPath?: string): void {
  if (!isObject(value) || Object.keys(value).length !== 1) throw new Error(`${name} must target exactly one field`);
  validateField(Object.keys(value)[0], nestedPath);
}

function walkClause(clause: unknown, nestedPath?: string): void {
  if (!isObject(clause) || Object.keys(clause).length !== 1) throw new Error("Each Elasticsearch clause must contain exactly one query operator");
  const [operator, value] = Object.entries(clause)[0];
  if (operator === "must_not") throw new Error("Use an EXCLUSION stage instead of must_not");
  if (operator === "nested") {
    if (!isObject(value) || typeof value.path !== "string" || !NESTED_PATHS.has(value.path) || !value.query) {
      throw new Error("nested requires an allowed path and query");
    }
    walkClause(value.query, value.path);
    return;
  }
  if (operator === "bool") {
    if (!isObject(value)) throw new Error("bool must be an object");
    for (const key of ["must", "filter", "should"] as const) {
      const clauses = value[key];
      if (clauses === undefined) continue;
      if (!Array.isArray(clauses)) throw new Error(`bool.${key} must be an array`);
      clauses.forEach((item) => walkClause(item, nestedPath));
    }
    if ("must_not" in value) throw new Error("Use an EXCLUSION stage instead of bool.must_not");
    return;
  }
  if (["match", "match_phrase", "term", "terms", "range", "regexp"].includes(operator)) {
    validateLeaf(operator, value, nestedPath);
    return;
  }
  throw new Error(`Unsupported Elasticsearch operator: ${operator}`);
}

export function validateElasticsearchQuery(query: unknown): asserts query is ElasticsearchBoolQuery {
  if (!isObject(query) || Object.keys(query).length !== 1 || !isObject(query.bool)) {
    throw new Error("Query must have bool as its only root key");
  }
  for (const key of ["must", "filter", "should"] as const) {
    if (!Array.isArray(query.bool[key])) throw new Error(`Root bool.${key} must be an array`);
    query.bool[key].forEach((clause) => walkClause(clause));
  }
  if ("must_not" in query.bool) throw new Error("Use an EXCLUSION stage instead of bool.must_not");
}

export function validateElasticsearchPlan(plan: unknown): asserts plan is ElasticsearchQueryPlan {
  if (!isObject(plan) || plan.schemaVersion !== "elasticsearch-funnel.v1" || !Array.isArray(plan.stages)) {
    throw new Error("Invalid Elasticsearch funnel plan");
  }
  for (const stage of plan.stages) {
    if (!isObject(stage) || typeof stage.criterionId !== "string") throw new Error("Every stage needs a criterionId");
    if (stage.stageType !== "INCLUSION" && stage.stageType !== "EXCLUSION") throw new Error("Invalid stage type");
    if (!["AUTOMATED", "ASSISTED", "MANUAL_REVIEW"].includes(String(stage.automation))) {
      throw new Error("Invalid stage automation level");
    }
    if (!Array.isArray(stage.limitations) || stage.limitations.some((item) => typeof item !== "string")) {
      throw new Error("Every stage needs a limitations array");
    }
    if (stage.automation !== "AUTOMATED" && stage.limitations.length === 0) {
      throw new Error("Assisted and manual-review stages must explain their limitations");
    }
    validateElasticsearchQuery(stage.query);
  }
  if (plan.reviewedAt !== undefined && (typeof plan.reviewedAt !== "string" || Number.isNaN(Date.parse(plan.reviewedAt)))) {
    throw new Error("reviewedAt must be a valid ISO date");
  }
}
