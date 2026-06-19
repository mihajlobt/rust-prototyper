import { describe, it, expect } from "vitest";
import { PLANS_TOOL_FILTER_DEFAULT, PLANS_RESEARCH_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";

describe("PLANS_RESEARCH_TOOL_FILTER_DEFAULT", () => {
  it("includes everything Plans has, plus web_search", () => {
    for (const tool of PLANS_TOOL_FILTER_DEFAULT) {
      expect(PLANS_RESEARCH_TOOL_FILTER_DEFAULT).toContain(tool);
    }
    expect(PLANS_RESEARCH_TOOL_FILTER_DEFAULT).toContain("web_search");
  });

  it("Plans default already includes web_fetch (via GENERIC_AGENT_TOOLS)", () => {
    expect(PLANS_TOOL_FILTER_DEFAULT).toContain("web_fetch");
  });
});
