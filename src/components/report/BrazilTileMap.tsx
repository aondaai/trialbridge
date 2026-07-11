/**
 * BrazilTileMap — a geographic tile-grid of Brazil's 27 federative units.
 *
 * From the TrialBridge Design System's feasibility-report templates (KolMap /
 * SupplyDemand): each state sits in an approximate geographic cell of a 7×8 grid,
 * shaded by an intensity value (darker = denser). "Sweet-spot" states get a
 * terracotta outline. Pure/server — takes a UF→value map in, renders a static map
 * (no client JS), so it works in print. The value scale is caller-supplied so the
 * same map renders KOL density, eligible-patient pools, or competition.
 */

/** Approximate geographic grid position (col 1–7, row 1–8) for every UF. */
const UF_GRID: Record<string, { col: number; row: number }> = {
  RR: { col: 3, row: 1 }, AP: { col: 5, row: 1 },
  AM: { col: 2, row: 2 }, PA: { col: 4, row: 2 }, MA: { col: 5, row: 2 }, CE: { col: 6, row: 2 }, RN: { col: 7, row: 2 },
  AC: { col: 1, row: 3 }, RO: { col: 2, row: 3 }, TO: { col: 4, row: 3 }, PI: { col: 5, row: 3 }, PE: { col: 6, row: 3 }, PB: { col: 7, row: 3 },
  MT: { col: 3, row: 4 }, GO: { col: 4, row: 4 }, BA: { col: 5, row: 4 }, AL: { col: 6, row: 4 }, SE: { col: 7, row: 4 },
  MS: { col: 3, row: 5 }, DF: { col: 4, row: 5 }, MG: { col: 5, row: 5 }, ES: { col: 6, row: 5 },
  PR: { col: 3, row: 6 }, SP: { col: 4, row: 6 }, RJ: { col: 5, row: 6 },
  SC: { col: 3, row: 7 },
  RS: { col: 3, row: 8 },
};

/** All 27 UF codes, in the grid's reading order. */
export const ALL_UFS = Object.keys(UF_GRID);

export interface TileDatum {
  /** Raw value driving the shade (KOL count, eligible pool, …). */
  value: number;
  /** What to print inside the tile (e.g. "46", "<5", "—"). Defaults to the value. */
  display?: string;
  /** Outline this state as an opportunity sweet-spot. */
  sweet?: boolean;
  /** Extra tooltip context appended after the UF + value. */
  tip?: string;
}

export function BrazilTileMap({
  data,
  rgb,
  legend,
  maxValue,
  caption,
}: {
  /** UF code → datum. UFs absent from the map render as empty (faint) tiles. */
  data: Record<string, TileDatum>;
  /** Base "r,g,b" the shade ramps toward (e.g. the seal colour). */
  rgb: string;
  /** One-line scale explanation under the map. */
  legend: string;
  /** Value that maps to full intensity; defaults to the observed max. */
  maxValue?: number;
  /** Optional caption element (e.g. a seal pill) rendered under the legend. */
  caption?: React.ReactNode;
}) {
  const values = ALL_UFS.map((uf) => data[uf]?.value ?? 0);
  const max = Math.max(1, maxValue ?? Math.max(...values));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        role="img"
        aria-label={`Brazil map by state — ${legend}`}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 44px)",
          gridTemplateRows: "repeat(8, 44px)",
          gap: 4,
        }}
      >
        {ALL_UFS.map((uf) => {
          const pos = UF_GRID[uf];
          const d = data[uf];
          const val = d?.value ?? 0;
          const intensity = val <= 0 ? 0.05 : Math.min(1, 0.15 + 0.85 * (val / max));
          const label = d?.display ?? (val > 0 ? String(val) : "—");
          const light = intensity > 0.55;
          return (
            <div
              key={uf}
              title={`${uf} — ${d?.tip ?? (val > 0 ? String(val) : "no data")}`}
              style={{
                gridColumn: pos.col,
                gridRow: pos.row,
                borderRadius: 8,
                background: `rgba(${rgb}, ${intensity.toFixed(2)})`,
                color: light ? "#FFFFFF" : "var(--cl-text-secondary)",
                boxShadow: d?.sweet
                  ? "0 0 0 2px var(--cl-accent-active)"
                  : "inset 0 0 0 1px var(--cl-border)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>{uf}</span>
              <span
                style={{
                  fontFamily: "var(--cl-font-mono)",
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: "var(--cl-text-muted)", maxWidth: 330, lineHeight: 1.5 }}>
        {legend}
      </p>
      {caption}
    </div>
  );
}
