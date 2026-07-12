/**
 * US-6 learning loop — persistence. Wires the pure learn.ts builders to Prisma: a human concept
 * mapping becomes a ConceptSynonym the classifier reads next run; an approved D answer becomes a
 * PriorFormAnswer the RAG resolver retrieves. loadLearnedSynonyms feeds the classifier.
 */

import { prisma } from "@/lib/db";
import { synonymWriteback, indexApprovedNarrative, type ApprovedNarrative } from "./learn";

/** All learned synonyms as a concept→terms map, merged into the classifier at autofill time. */
export async function loadLearnedSynonyms(): Promise<Record<string, string[]>> {
  const rows = await prisma.conceptSynonym.findMany();
  const map: Record<string, string[]> = {};
  for (const r of rows) (map[r.conceptId] ??= []).push(r.term);
  return map;
}

/** Persist a human concept mapping (label phrasing → concept) as a ConceptSynonym. */
export async function persistLearnedSynonym(conceptId: string, labelPhrasing: string): Promise<boolean> {
  const learned = synonymWriteback(conceptId, labelPhrasing, "human");
  if (!learned) return false;
  await prisma.conceptSynonym.upsert({
    where: { conceptId_term: { conceptId: learned.conceptId, term: learned.term } },
    update: {},
    create: { conceptId: learned.conceptId, term: learned.term, lang: learned.lang, source: learned.source },
  });
  return true;
}

/** Index an approved narrative answer as a PriorFormAnswer (RAG memory). Idempotent on id. */
export async function persistApprovedNarrative(answer: ApprovedNarrative, approvedAt: string): Promise<boolean> {
  const rec = indexApprovedNarrative(answer, approvedAt);
  if (!rec) return false;
  await prisma.priorFormAnswer.upsert({
    where: { id: rec.id },
    update: { answerText: rec.answerText, section: rec.section, label: rec.label },
    create: { id: rec.id, siteId: rec.siteId, section: rec.section, label: rec.label, conceptId: rec.conceptId ?? null, answerText: rec.answerText, approvedAt: new Date(rec.approvedAt) },
  });
  return true;
}
