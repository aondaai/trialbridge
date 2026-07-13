import { describe, expect, it } from "vitest";
import { dispatchSelection } from "@/lib/feasibility-autofill/mcp/selectionServer";
import { runSiteShortlist, SITE_SHORTLIST_TOOL } from "@/lib/feasibility-autofill/mcp/siteShortlistTool";
import { SITE_SELECTION_AGENT } from "@/lib/feasibility-autofill/mcp/agentConfig";

const loader = async (id: string) => id === "known"
  ? { id, title: "Phase III HER2-positive breast cancer", nct: "NCT03529110", estimateResult: null }
  : null;

describe("site.shortlist deterministic tool boundary", () => {
  it("advertises only consultationId + bounded limit", () => {
    expect(SITE_SHORTLIST_TOOL.name).toBe("site.shortlist");
    expect(SITE_SHORTLIST_TOOL.inputSchema.required).toEqual(["consultationId"]);
    expect(SITE_SHORTLIST_TOOL.inputSchema.properties).not.toHaveProperty("regionalSupply");
    expect(SITE_SHORTLIST_TOOL.inputSchema.properties).not.toHaveProperty("scores");
  });

  it("requires a validated estimate and rejects unbounded output", async () => {
    await expect(runSiteShortlist({ consultationId: "known" }, loader)).rejects.toThrow(/validated regional eligibility estimate/);
    await expect(runSiteShortlist({ consultationId: "known", limit: 100 }, loader)).rejects.toThrow(/between 1 and 50/);
  });

  it("Managed Agents can call the tool but are forbidden to recompute selection", () => {
    expect(SITE_SELECTION_AGENT.tools.map((tool) => tool.name)).toEqual(["site.shortlist"]);
    expect(SITE_SELECTION_AGENT.systemPrompt).toMatch(/Never recompute, override, reorder/);
    expect(SITE_SELECTION_AGENT.systemPrompt).toMatch(/Human approval is mandatory/);
  });
});

describe("site-selection MCP transport", () => {
  it("lists site.shortlist", async () => {
    const response = await dispatchSelection({ jsonrpc: "2.0", id: 1, method: "tools/list" }, loader);
    const tools = (response as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(["site.shortlist"]);
  });

  it("returns a proposed, human-gated structured result", async () => {
    const runner = async () => ({
      schemaVersion: "site-selection-tool.v1" as const,
      consultationId: "known",
      nct: "NCT03529110",
      status: "proposed" as const,
      humanApprovalRequired: true as const,
      shortlist: { schemaVersion: "site-prequalification-shortlist.v1" as const, asOf: null, entries: [], methodology: [], limitations: [] },
    });
    const response = await dispatchSelection(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "site.shortlist", arguments: { consultationId: "known", limit: 10 } } },
      loader,
      runner,
    );
    const result = (response as { result: { structuredContent: { status: string; humanApprovalRequired: boolean }; isError: boolean } }).result;
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ status: "proposed", humanApprovalRequired: true });
  });
});
