import type { Metadata } from "next";
import { Newsreader, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./claude.css";
import "./landing.css";

/* Substitute brand faces, self-hosted by next/font (no external CDN). These map
   to the design-system tokens: Newsreader → display, Hanken Grotesk → body,
   JetBrains Mono → data. Exposed as CSS vars consumed by claude.css --cl-font-*. */
const displayFont = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-display-sub",
  display: "swap",
});
const bodyFont = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-sub",
  display: "swap",
});
const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-sub",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrialBridge — Elegível",
  description:
    "Two-sided clinical-trial site-feasibility: deterministic matching, protocol softening, counts-not-rows aggregation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
