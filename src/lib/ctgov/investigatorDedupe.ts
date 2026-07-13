import { stableHash } from "@/lib/facilities/master";
import type { CtgovInvestigatorProfile } from "@/lib/ctgov/investigatorRosterModel";
import { normalizeCtgovText } from "@/lib/ctgov/investigatorRosterModel";

export type DedupeDecision = "auto_merge" | "review" | "quality_exclusion";

export interface InvestigatorDedupePair {
  pairId: string;
  leftProfileId: string;
  rightProfileId: string;
  leftName: string;
  rightName: string;
  leftAffiliation: string | null;
  rightAffiliation: string | null;
  score: number;
  decision: DedupeDecision;
  reasons: string[];
  sharedNctIds: string[];
  nameSimilarity: number;
  affiliationSimilarity: number;
}

export interface InvestigatorDedupeCluster {
  clusterId: string;
  profileIds: string[];
  names: string[];
  affiliations: string[];
  nctIds: string[];
  suggestedCanonicalName: string;
}

export interface InvestigatorDedupeAudit {
  schemaVersion: "ctgov-investigator-dedupe-audit.v1";
  generatedAt: string;
  inputProfiles: number;
  thresholds: { autoMerge: number; review: number };
  summary: {
    candidatePairs: number;
    autoMergePairs: number;
    reviewPairs: number;
    qualityExclusionPairs: number;
    autoMergeClusters: number;
    profilesInAutoMergeClusters: number;
    suggestedProfileReduction: number;
    suspectedNonPersonProfiles: number;
  };
  autoMergePairs: InvestigatorDedupePair[];
  reviewPairs: InvestigatorDedupePair[];
  qualityExclusionPairs: InvestigatorDedupePair[];
  autoMergeClusters: InvestigatorDedupeCluster[];
  suspectedNonPersonProfiles: Array<Pick<CtgovInvestigatorProfile, "profileId" | "name" | "affiliation" | "nctIds"> & { reasons: string[] }>;
}

const CREDENTIALS = new Set([
  "dr", "dra", "md", "phd", "ph", "d", "msc", "ms", "mba", "mph", "mbbs", "facc", "prof", "professor", "investigator", "pharmaceutical",
]);

const INSTITUTION_QUALIFIERS = new Set([
  "federal", "estadual", "state", "municipal", "catholic", "catolica", "pontifical", "paulista", "campinas",
  "brasilia", "paraiba", "fluminense", "parana", "pernambuco", "bahia", "ceara", "goias",
]);

const AFFILIATION_STOPWORDS = new Set([
  "hospital", "hospitals", "center", "centre", "centro", "clinica", "clinical", "research", "pesquisa",
  "instituto", "institute", "universidade", "university", "faculdade", "foundation", "fundacao", "department",
  "departamento", "school", "medical", "medicine", "medicina", "ltda", "inc", "sa", "de", "da", "do", "das",
  "dos", "e", "of", "the", "and", "for", "brazil", "brasil",
]);

const NON_PERSON_PATTERNS: Array<[RegExp, string]> = [
  [/\b(trial|study|project|site|clinical) (manager|coordinator|team|office)\b/, "operational role used as a name"],
  [/\b(pharmaceuticals?|pharma|company|laborator(?:y|ies)|laboratorios?|hospital|university|universidade|institute|instituto)\b/, "organization used as a name"],
  [/\b(contact|sponsor|medical information|medinfo)\b/, "generic contact used as a name"],
];

export function canonicalInvestigatorName(value: string): string {
  return normalizeCtgovText(value)
    .split(" ")
    .filter((token) => token && !CREDENTIALS.has(token))
    .map((token) => token === "jr" ? "junior" : token === "sr" ? "senior" : token)
    .join(" ");
}

function affiliationTokens(value: string): string[] {
  return normalizeCtgovText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !AFFILIATION_STOPWORDS.has(token));
}

function jaccard(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const a = new Set(left), b = new Set(right);
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

export function jaroWinkler(left: string, right: string): number {
  if (left === right) return 1;
  if (!left.length || !right.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatches = new Array(left.length).fill(false);
  const rightMatches = new Array(right.length).fill(false);
  let matches = 0;
  for (let i = 0; i < left.length; i += 1) {
    const start = Math.max(0, i - range), end = Math.min(i + range + 1, right.length);
    for (let j = start; j < end; j += 1) {
      if (rightMatches[j] || left[i] !== right[j]) continue;
      leftMatches[i] = true;
      rightMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (!matches) return 0;
  const leftChars = left.split("").filter((_char, index) => leftMatches[index]);
  const rightChars = right.split("").filter((_char, index) => rightMatches[index]);
  let transpositions = 0;
  for (let i = 0; i < leftChars.length; i += 1) if (leftChars[i] !== rightChars[i]) transpositions += 1;
  const jaro = (matches / left.length + matches / right.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, left.length, right.length) && left[prefix] === right[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function nonPersonReasons(profile: CtgovInvestigatorProfile): string[] {
  const normalized = canonicalInvestigatorName(profile.name);
  const reasons = NON_PERSON_PATTERNS.filter(([pattern]) => pattern.test(normalized)).map(([, reason]) => reason);
  return [...new Set(reasons)];
}

function addPairs(ids: string[], pairs: Set<string>) {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) pairs.add([ids[i], ids[j]].sort().join("|"));
  }
}

function middleInitials(tokens: string[]): string[] {
  return tokens.slice(1, -1).flatMap((token) => token.length <= 2 ? token.split("") : [token[0]]);
}

function isSubsequence(shorter: string[], longer: string[]): boolean {
  let index = 0;
  for (const token of longer) if (token === shorter[index]) index += 1;
  return index === shorter.length;
}

function middleNamesConflict(left: string[], right: string[]): boolean {
  const a = middleInitials(left), b = middleInitials(right);
  if (!a.length || !b.length) return false;
  return !isSubsequence(a.length <= b.length ? a : b, a.length <= b.length ? b : a);
}

function groupBy(profiles: CtgovInvestigatorProfile[], keyFor: (profile: CtgovInvestigatorProfile) => string) {
  const groups = new Map<string, string[]>();
  for (const profile of profiles) {
    const key = keyFor(profile);
    if (!key) continue;
    const ids = groups.get(key) ?? [];
    ids.push(profile.profileId);
    groups.set(key, ids);
  }
  return groups;
}

function candidatePairs(profiles: CtgovInvestigatorProfile[]): Set<string> {
  const pairs = new Set<string>();
  for (const ids of groupBy(profiles, (profile) => canonicalInvestigatorName(profile.name)).values()) if (ids.length > 1) addPairs(ids, pairs);
  for (const ids of groupBy(profiles, (profile) => profile.normalizedAffiliation).values()) {
    if (ids.length < 2) continue;
    const byEdgeName = new Map<string, string[]>();
    for (const id of ids) {
      const profile = profiles.find((item) => item.profileId === id)!;
      const tokens = canonicalInvestigatorName(profile.name).split(" ").filter(Boolean);
      const key = tokens.length >= 2 ? `${tokens[0][0]}|${tokens.at(-1)}` : "";
      if (!key) continue;
      const bucket = byEdgeName.get(key) ?? [];
      bucket.push(id);
      byEdgeName.set(key, bucket);
    }
    for (const bucket of byEdgeName.values()) if (bucket.length > 1) addPairs(bucket, pairs);
  }
  for (const ids of groupBy(profiles.flatMap((profile) => profile.nctIds.map((nctId) => ({ ...profile, profileId: `${profile.profileId}@@${nctId}` }))), (profile) => profile.profileId.split("@@")[1]).values()) {
    const profileIds = [...new Set(ids.map((id) => id.split("@@")[0]))];
    if (profileIds.length > 1 && profileIds.length <= 30) addPairs(profileIds, pairs);
  }
  return pairs;
}

function scorePair(left: CtgovInvestigatorProfile, right: CtgovInvestigatorProfile): InvestigatorDedupePair | null {
  const leftCanonical = canonicalInvestigatorName(left.name), rightCanonical = canonicalInvestigatorName(right.name);
  const canonicalExact = leftCanonical === rightCanonical;
  const normalizedExact = left.normalizedName === right.normalizedName;
  const nameSimilarity = jaroWinkler(leftCanonical, rightCanonical);
  const affiliationSimilarity = jaccard(affiliationTokens(left.affiliation ?? ""), affiliationTokens(right.affiliation ?? ""));
  const exactAffiliation = Boolean(left.normalizedAffiliation && left.normalizedAffiliation === right.normalizedAffiliation);
  const sharedNctIds = left.nctIds.filter((nctId) => right.nctIds.includes(nctId));
  const leftQualifiers = new Set(affiliationTokens(left.affiliation ?? "").filter((token) => INSTITUTION_QUALIFIERS.has(token)));
  const rightQualifiers = new Set(affiliationTokens(right.affiliation ?? "").filter((token) => INSTITUTION_QUALIFIERS.has(token)));
  const affiliationQualifierConflict = [...new Set([...leftQualifiers, ...rightQualifiers])]
    .some((token) => leftQualifiers.has(token) !== rightQualifiers.has(token));
  const leftTokens = leftCanonical.split(" ").filter(Boolean), rightTokens = rightCanonical.split(" ").filter(Boolean);
  const sameEdgeNames = leftTokens.length >= 2 && rightTokens.length >= 2
    && leftTokens[0][0] === rightTokens[0][0] && leftTokens.at(-1) === rightTokens.at(-1);
  const middleNameConflict = sameEdgeNames && middleNamesConflict(leftTokens, rightTokens);
  const reasons: string[] = [];
  let score = 0;
  if (canonicalExact) { score += 70; reasons.push("credential-insensitive name match"); }
  else if (nameSimilarity >= 0.98) { score += 58; reasons.push("near-exact name similarity"); }
  else if (nameSimilarity >= 0.95) { score += 50; reasons.push("strong name similarity"); }
  else if (nameSimilarity >= 0.91) { score += 38; reasons.push("moderate name similarity"); }
  if (normalizedExact) { score += 14; reasons.push("exact normalized display name"); }
  if (sameEdgeNames && !canonicalExact) { score += 7; reasons.push("compatible first initial and surname"); }
  if (exactAffiliation) { score += 25; reasons.push("exact affiliation"); }
  else if (affiliationSimilarity >= 0.65) { score += 20; reasons.push("strong affiliation overlap"); }
  else if (affiliationSimilarity >= 0.4) { score += 14; reasons.push("moderate affiliation overlap"); }
  else if (affiliationSimilarity >= 0.2) { score += 7; reasons.push("weak affiliation overlap"); }
  if (sharedNctIds.length) { score += 25; reasons.push("shared ClinicalTrials.gov study"); }
  score = Math.min(100, score);
  const qualityReasons = [...nonPersonReasons(left), ...nonPersonReasons(right)];
  let decision: DedupeDecision | null = null;
  if (qualityReasons.length) decision = "quality_exclusion";
  else if (score >= 90 && (sharedNctIds.length > 0 || exactAffiliation || affiliationSimilarity >= 0.4)
    && (!affiliationQualifierConflict || sharedNctIds.length > 0)
    && (!middleNameConflict || sharedNctIds.length > 0)) decision = "auto_merge";
  else if (score >= 72) decision = "review";
  if (!decision) return null;
  if (affiliationQualifierConflict) reasons.push("institution qualifier mismatch");
  if (middleNameConflict) reasons.push("conflicting middle initials");
  if (qualityReasons.length) reasons.push(...qualityReasons);
  const pairKey = [left.profileId, right.profileId].sort().join("|");
  return {
    pairId: `ctgov-pair-${stableHash(pairKey)}`,
    leftProfileId: left.profileId,
    rightProfileId: right.profileId,
    leftName: left.name,
    rightName: right.name,
    leftAffiliation: left.affiliation,
    rightAffiliation: right.affiliation,
    score,
    decision,
    reasons: [...new Set(reasons)],
    sharedNctIds,
    nameSimilarity: Number(nameSimilarity.toFixed(4)),
    affiliationSimilarity: Number(affiliationSimilarity.toFixed(4)),
  };
}

function clustersFromPairs(profiles: CtgovInvestigatorProfile[], pairs: InvestigatorDedupePair[]): InvestigatorDedupeCluster[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (!parent.has(id)) parent.set(id, id);
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a), rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const pair of pairs) union(pair.leftProfileId, pair.rightProfileId);
  const grouped = new Map<string, CtgovInvestigatorProfile[]>();
  const byId = new Map(profiles.map((profile) => [profile.profileId, profile]));
  for (const id of parent.keys()) {
    const profile = byId.get(id);
    if (!profile) continue;
    const bucket = grouped.get(find(id)) ?? [];
    bucket.push(profile);
    grouped.set(find(id), bucket);
  }
  return [...grouped.values()].filter((items) => items.length > 1).map((items) => {
    const profileIds = items.map((item) => item.profileId).sort();
    const bestName = [...items].sort((a, b) => b.nctIds.length - a.nctIds.length || b.name.length - a.name.length)[0].name;
    return {
      clusterId: `ctgov-cluster-${stableHash(profileIds.join("|"))}`,
      profileIds,
      names: [...new Set(items.map((item) => item.name))].sort(),
      affiliations: [...new Set(items.map((item) => item.affiliation).filter((value): value is string => Boolean(value)))].sort(),
      nctIds: [...new Set(items.flatMap((item) => item.nctIds))].sort(),
      suggestedCanonicalName: bestName,
    };
  }).sort((a, b) => b.profileIds.length - a.profileIds.length || a.suggestedCanonicalName.localeCompare(b.suggestedCanonicalName));
}

export function buildInvestigatorDedupeAudit(profiles: CtgovInvestigatorProfile[], generatedAt = new Date().toISOString()): InvestigatorDedupeAudit {
  const byId = new Map(profiles.map((profile) => [profile.profileId, profile]));
  const scored = [...candidatePairs(profiles)].map((key) => {
    const [leftId, rightId] = key.split("|");
    return scorePair(byId.get(leftId)!, byId.get(rightId)!);
  }).filter((pair): pair is InvestigatorDedupePair => Boolean(pair));
  const autoMergePairs = scored.filter((pair) => pair.decision === "auto_merge").sort((a, b) => b.score - a.score);
  const reviewPairs = scored.filter((pair) => pair.decision === "review").sort((a, b) => b.score - a.score);
  const qualityExclusionPairs = scored.filter((pair) => pair.decision === "quality_exclusion").sort((a, b) => b.score - a.score);
  const autoMergeClusters = clustersFromPairs(profiles, autoMergePairs);
  const suspectedNonPersonProfiles = profiles.map((profile) => ({ profile, reasons: nonPersonReasons(profile) }))
    .filter(({ reasons }) => reasons.length)
    .map(({ profile, reasons }) => ({ profileId: profile.profileId, name: profile.name, affiliation: profile.affiliation, nctIds: profile.nctIds, reasons }));
  const profilesInAutoMergeClusters = autoMergeClusters.reduce((total, cluster) => total + cluster.profileIds.length, 0);
  return {
    schemaVersion: "ctgov-investigator-dedupe-audit.v1",
    generatedAt,
    inputProfiles: profiles.length,
    thresholds: { autoMerge: 90, review: 72 },
    summary: {
      candidatePairs: scored.length,
      autoMergePairs: autoMergePairs.length,
      reviewPairs: reviewPairs.length,
      qualityExclusionPairs: qualityExclusionPairs.length,
      autoMergeClusters: autoMergeClusters.length,
      profilesInAutoMergeClusters,
      suggestedProfileReduction: profilesInAutoMergeClusters - autoMergeClusters.length,
      suspectedNonPersonProfiles: suspectedNonPersonProfiles.length,
    },
    autoMergePairs,
    reviewPairs,
    qualityExclusionPairs,
    autoMergeClusters,
    suspectedNonPersonProfiles,
  };
}
