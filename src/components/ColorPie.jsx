import { useMemo } from "react";

const CLR = { W: "#F0E6B2", U: "#4DA3D4", B: "#A68DA0", R: "#E05A50", G: "#4DB87A", C: "#555" };

/**
 * Donut chart showing color distribution of a deck.
 */
export default function ColorPie({ cards, size = 80 }) {
  const data = useMemo(() => {
    const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    cards.forEach(c => {
      const mc = c.cardData?.mana_cost || "";
      if (!mc || (c.cardData?.type_line || "").includes("Land")) return;
      for (const ch of mc.replace(/[{}]/g, "")) {
        if (counts[ch] !== undefined) counts[ch] += c.qty;
      }
      // If no color pips, count as colorless
      if (!/[WUBRG]/.test(mc)) counts.C += c.qty;
    });
    return Object.entries(counts).filter(([, v]) => v > 0);
  }, [cards]);

  const total = data.reduce((a, [, v]) => a + v, 0) || 1;
  const r = size / 2;
  const innerR = r * 0.55;

  let cumAngle = -Math.PI / 2;
  const arcs = data.map(([color, count]) => {
    const angle = (count / total) * Math.PI * 2;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;

    const x1 = r + r * Math.cos(startAngle);
    const y1 = r + r * Math.sin(startAngle);
    const x2 = r + r * Math.cos(endAngle);
    const y2 = r + r * Math.sin(endAngle);
    const ix1 = r + innerR * Math.cos(endAngle);
    const iy1 = r + innerR * Math.sin(endAngle);
    const ix2 = r + innerR * Math.cos(startAngle);
    const iy2 = r + innerR * Math.sin(startAngle);

    const largeArc = angle > Math.PI ? 1 : 0;

    const path = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      "Z",
    ].join(" ");

    return { color, count, path, pct: Math.round((count / total) * 100) };
  });

  if (data.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg width={size} height={size} style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.4))" }}>
        {arcs.map((arc, i) => (
          <path
            key={arc.color}
            d={arc.path}
            fill={CLR[arc.color] || "#555"}
            stroke="#0a0a0a"
            strokeWidth="1"
            style={{
              opacity: 0.85,
              transition: "opacity 0.2s",
              animation: `cardEntrance 0.4s ease ${i * 0.06}s both`,
            }}
            onMouseOver={e => e.currentTarget.style.opacity = 1}
            onMouseOut={e => e.currentTarget.style.opacity = 0.85}
          >
            <title>{arc.color}: {arc.count} pips ({arc.pct}%)</title>
          </path>
        ))}
        <text x={r} y={r} textAnchor="middle" dominantBaseline="central" fill="#666" fontSize="9" fontFamily="'Cinzel', serif">
          {total}
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {arcs.map(arc => (
          <div key={arc.color} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: CLR[arc.color], flexShrink: 0 }} />
            <span style={{ color: "#666", fontFamily: "'Cinzel', serif" }}>{arc.color}</span>
            <span style={{ color: "#444" }}>{arc.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
