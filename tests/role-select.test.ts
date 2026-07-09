import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import StartPage from "@/app/start/page";
import { ROLE_OPTIONS } from "@/app/start/roles";

describe("role-selection entry screen", () => {
  it("offers exactly Patrocinador and Site, routing to /sponsor and /site", () => {
    expect(ROLE_OPTIONS).toHaveLength(2);
    const byKey = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.key, r.href]));
    expect(byKey.sponsor).toBe("/sponsor");
    expect(byKey.site).toBe("/site");
  });

  it("renders both role cards with working navigation hrefs", () => {
    const html = renderToStaticMarkup(createElement(StartPage));
    expect(html).toContain('href="/sponsor"');
    expect(html).toContain('href="/site"');
    for (const r of ROLE_OPTIONS) {
      expect(html).toContain(r.title);
    }
  });
});
