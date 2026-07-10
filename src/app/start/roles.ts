/**
 * The role-selection routing contract — the single source of truth for the
 * "choose your journey" entry screen (src/app/start/page.tsx). Kept as plain
 * data so the routing is unit-testable without rendering.
 */

export interface RoleOption {
  key: "sponsor" | "site";
  title: string;
  blurb: string;
  cta: string;
  href: string;
}

export const ROLE_OPTIONS: RoleOption[] = [
  {
    key: "sponsor",
    title: "I'm a Sponsor",
    blurb:
      "Post a protocol and see, per site and per Brazilian region, how many eligible patients exist — with a confidence interval.",
    cta: "Run feasibility →",
    href: "/sponsor",
  },
  {
    key: "site",
    title: "I'm a Site / Center",
    blurb:
      "List your center and respond to protocols with your real capacity — aggregate counts only, never patient data.",
    cta: "List my site →",
    href: "/site",
  },
];
