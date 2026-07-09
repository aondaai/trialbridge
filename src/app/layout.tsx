import type { Metadata } from "next";
import "./globals.css";
import "./claude.css";
import "./landing.css";

export const metadata: Metadata = {
  title: "TrialBridge — Elegível",
  description:
    "Two-sided clinical-trial site-feasibility: deterministic matching, protocol softening, counts-not-rows aggregation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
