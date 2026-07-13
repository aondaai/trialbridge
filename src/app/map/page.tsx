"use client";

import dynamic from "next/dynamic";
import { TopBar } from "@/components/ui";

const LatamSiteMap = dynamic(() => import("@/components/LatamSiteMap"), {
  ssr: false,
});

export default function MapPage() {
  return (
    <>
      <TopBar active="map" />
      <main className="wrap">
        <span className="eyebrow">Brazil · site intelligence</span>
        <h1>Clinical research site map</h1>
        <p className="sub">
          Explore registry presence, recent activity, and operational maturity signals.
          We are starting with Brazil; declared capabilities and official evidence are
          displayed separately to preserve provenance.
        </p>
        <LatamSiteMap />
      </main>
    </>
  );
}
