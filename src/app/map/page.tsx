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
        <h1>LatAm Site Map</h1>
        <p className="sub">
          Physical clinical-trial sites across Brazil, Mexico, Chile, and
          Argentina, from ClinicalTrials.gov registry data. Color shows current
          activity; locations are city-level approximations.
        </p>
        <LatamSiteMap />
      </main>
    </>
  );
}
