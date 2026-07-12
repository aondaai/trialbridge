import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseConceptTsv, buildVocabIndexFromConcepts } from "@/lib/omop/buildVocabIndex";
import { loadVocabIndex, __resetVocabIndexCacheForTests } from "@/lib/omop/vocabIndex";
import { toOmopCriteria } from "@/lib/omop/transform";
import type { Criterion } from "@/lib/matcher/types";

// A tiny hand-built fixture in the real Athena CONCEPT.csv format
// (tab-delimited, header-driven) — proves the matcher without needing the
// real, large, licensed bundle.
const FIXTURE_TSV = [
  "concept_id\tconcept_name\tdomain_id\tvocabulary_id\tconcept_class_id\tstandard_concept\tconcept_code",
  "4009630\tEastern Cooperative Oncology Group Performance Status\tObservation\tLOINC\tClinical Observation\tS\t89247-1",
  "3016723\tSerum creatinine measurement\tMeasurement\tLOINC\tLab Test\tS\t2160-0",
  "999999\tSerum creatinine measurement legacy\tMeasurement\tLOINC\tLab Test\t\t0000-0", // non-standard, must be excluded
  "111\tEastern Cooperative Oncology Group Performance Status\tObservation\tICD10\tDiagnosis\tS\tX00", // wrong vocabulary, must be excluded
].join("\n");

describe("parseConceptTsv", () => {
  it("parses tab-delimited rows header-driven", () => {
    const rows = parseConceptTsv(FIXTURE_TSV);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      concept_id: "4009630",
      vocabulary_id: "LOINC",
      standard_concept: "S",
    });
  });
});

describe("buildVocabIndexFromConcepts", () => {
  const rows = parseConceptTsv(FIXTURE_TSV);

  it("matches an exact (case-insensitive) name against a standard concept", () => {
    const { index, unmatched } = buildVocabIndexFromConcepts(rows, [
      "EASTERN COOPERATIVE ONCOLOGY GROUP PERFORMANCE STATUS",
    ]);
    expect(unmatched).toEqual([]);
    expect(index["EASTERN COOPERATIVE ONCOLOGY GROUP PERFORMANCE STATUS"]).toMatchObject({
      conceptId: 4009630,
      vocabularyId: "LOINC",
      matchedOn: "exact",
    });
  });

  it("falls back to substring containment when there's no exact match", () => {
    const { index } = buildVocabIndexFromConcepts(rows, ["Serum creatinine"]);
    expect(index["Serum creatinine"]).toMatchObject({
      conceptId: 3016723,
      matchedOn: "substring",
    });
  });

  it("ignores non-standard rows and rows in a disallowed vocabulary", () => {
    // The ICD10 row would exact-match "Eastern Cooperative..." if vocabulary
    // filtering were broken; the LOINC/standard=S row must win instead.
    const { index } = buildVocabIndexFromConcepts(rows, [
      "Eastern Cooperative Oncology Group Performance Status",
    ]);
    expect(index["Eastern Cooperative Oncology Group Performance Status"].conceptId).toBe(4009630);
  });

  it("rejects a degenerate tiny substring match (regression: 'O'/'I' universal-substring bug)", () => {
    // A 1-char standard concept name is a substring of almost every long field
    // name; with 'shortest wins' it used to spuriously resolve everything.
    const degenerate = parseConceptTsv(
      [
        "concept_id\tconcept_name\tdomain_id\tvocabulary_id\tconcept_class_id\tstandard_concept\tconcept_code",
        "4106482\tO\tMeas Value\tSNOMED\tQualifier Value\tS\tX1",
        "4225195\tI\tMeas Value\tSNOMED\tQualifier Value\tS\tX2",
      ].join("\n"),
    );
    const { index, unmatched } = buildVocabIndexFromConcepts(degenerate, ["Hemoglobin", "HER2 status (IHC/ISH)"]);
    expect(index["Hemoglobin"]).toBeUndefined();
    expect(index["HER2 status (IHC/ISH)"]).toBeUndefined();
    expect(unmatched.sort()).toEqual(["HER2 status (IHC/ISH)", "Hemoglobin"]);
  });

  it("resolves only within the field's declared vocabulary (no cross-vocabulary contradiction)", () => {
    // "creatinine" exists in the fixture only as… nothing here, so build a
    // focused fixture: a RxNorm drug vs a LOINC lab, same-ish name.
    const rows2 = parseConceptTsv(
      [
        "concept_id\tconcept_name\tdomain_id\tvocabulary_id\tconcept_class_id\tstandard_concept\tconcept_code",
        "19071968\tcreatinine\tDrug\tRxNorm\tIngredient\tS\tD1",
        "3016723\tSerum creatinine measurement\tMeasurement\tLOINC\tLab Test\tS\t2160-0",
      ].join("\n"),
    );
    // Field declares LOINC → the RxNorm drug must not win, even though its name
    // is the shorter substring.
    const { index } = buildVocabIndexFromConcepts(rows2, [
      { conceptName: "Serum creatinine", vocabularyId: "LOINC" },
    ]);
    expect(index["Serum creatinine"]).toMatchObject({ vocabularyId: "LOINC", conceptId: 3016723 });
  });

  it("exact-only mode ignores substring candidates (deployed-index policy)", () => {
    const { index, unmatched } = buildVocabIndexFromConcepts(
      rows,
      ["Serum creatinine"],
      { allowSubstring: false },
    );
    expect(index["Serum creatinine"]).toBeUndefined();
    expect(unmatched).toEqual(["Serum creatinine"]);
  });

  it("never resolves a field whose declared vocabulary is None (e.g. age)", () => {
    const { index, unmatched } = buildVocabIndexFromConcepts(rows, [
      { conceptName: "Eastern Cooperative Oncology Group Performance Status", vocabularyId: "None" },
    ]);
    expect(index["Eastern Cooperative Oncology Group Performance Status"]).toBeUndefined();
    expect(unmatched).toHaveLength(1);
  });

  it("reports fields with no candidate as unmatched, not a false positive", () => {
    const { index, unmatched } = buildVocabIndexFromConcepts(rows, ["Totally absent concept xyz"]);
    expect(index["Totally absent concept xyz"]).toBeUndefined();
    expect(unmatched).toEqual(["Totally absent concept xyz"]);
  });
});

describe("loadVocabIndex + resolveConcept integration", () => {
  const REAL_PATH = resolve(process.cwd(), "data", "vocab-index.json");
  const preexisting = existsSync(REAL_PATH);

  afterEach(() => {
    __resetVocabIndexCacheForTests();
  });

  it("returns null when data/vocab-index.json does not exist (Phase 1 default)", () => {
    if (preexisting) return; // don't assert this on a machine that already built a real index
    __resetVocabIndexCacheForTests();
    expect(loadVocabIndex()).toBeNull();
  });

  it("resolveConcept() stays needsMapping: true with no index present (regression check)", () => {
    if (preexisting) return;
    __resetVocabIndexCacheForTests();
    const criteria: Criterion[] = [
      { id: "c1", kind: "inclusion", field: "her2_status", operator: "in", value: ["positive"], rawText: "x", confidence: 1 },
    ];
    const [omop] = toOmopCriteria(criteria);
    expect(omop.concept.conceptId).toBe(0);
    expect(omop.concept.needsMapping).toBe(true);
    expect(omop.concept.verified).toBe(false);
  });

  it("once an index file exists, resolveConcept() upgrades a matching field to verified: true", () => {
    if (preexisting) {
      // A real index already exists in this environment — don't clobber it,
      // just confirm the integration point behaves, using whatever is there.
      __resetVocabIndexCacheForTests();
      expect(loadVocabIndex()).not.toBeNull();
      return;
    }
    writeFileSync(
      REAL_PATH,
      JSON.stringify({
        "HER2 status (IHC/ISH)": {
          conceptId: 40757581,
          conceptName: "HER2 receptor status",
          vocabularyId: "LOINC",
          matchedOn: "exact",
        },
      }),
    );
    try {
      __resetVocabIndexCacheForTests();
      const criteria: Criterion[] = [
        { id: "c1", kind: "inclusion", field: "her2_status", operator: "in", value: ["positive"], rawText: "x", confidence: 1 },
      ];
      const [omop] = toOmopCriteria(criteria);
      expect(omop.concept).toMatchObject({
        conceptId: 40757581,
        conceptName: "HER2 receptor status",
        verified: true,
        needsMapping: false,
      });
    } finally {
      unlinkSync(REAL_PATH);
      __resetVocabIndexCacheForTests();
    }
  });
});
