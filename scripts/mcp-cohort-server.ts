/**
 * Entry point for the site-side `cohort.preview` MCP server (ADR-002 M0).
 *
 * Runs on the site's own infrastructure. Loads patients from the site's DB and serves the
 * cohort.preview tool over stdio. An MCA cloud orchestrator connects here and gets aggregates
 * only. Start with: `npm run mcp:cohort`.
 */

import { loadSite } from "@/lib/data/sites";
import { serve } from "@/lib/feasibility-autofill/mcp/cohortServer";

serve(async (siteId) => {
  const ds = await loadSite(siteId);
  return ds?.patients ?? null;
});
