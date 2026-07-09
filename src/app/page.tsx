import type { Metadata } from "next";
import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: "TrialBridge — Match global sponsors with trial-ready sites",
  description:
    "TrialBridge connects clinical trial sponsors with emerging-market sites that proactively declare real recruitment capacity — starting in Brazil.",
};

export default function Home() {
  return <Landing />;
}
