import { useState, useMemo } from "react";
import { xBtn } from "../constants";

/**
 * Hypergeometric probability: P(X >= successes | pop, hits, draws)
 */
function hypergeom(population, successes, draws, minHits) {
  // P(X >= minHits)
  let prob = 0;
  for (let k = minHits; k <= Math.min(successes, draws); k++) {
    prob += (choose(successes, k) * choose(population - successes, draws - k)) / choose(population, draws);
  }
  return Math.min(Math.max(prob, 0), 1);
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

export default function DrawProbability({ deck, onClose }) {
  const [targetCard, setTargetCard] = useState("");
  const [byTurn, setByTurn] = useState(4);

  const deckSize = useMemo(() => deck.mainboard.reduce((a, c) => a + c.qty, 0), [deck]);

  const results = useMemo(() => {
    if (!targetCard.trim()) return null;
    const q = targetCard.toLowerCase();
    const copies = deck.mainboard
      .filter(c => c.name.toLowerCase().includes(q))
      .reduce((a, c) => a + c.qty, 0);

    if (copies === 0) return null;

    const rows = [];
    for (let turn = 1; turn <= 10; turn++) {
      const cardsDrawn = 7 + (turn - 1); // opening hand + draws
      const prob1 = hypergeom(deckSize, copies, Math.min(cardsDrawn, deckSize), 1);
      const prob2 = copies >= 2 ? hypergeom(deckSize, copies, Math.min(cardsDrawn, deckSize), 2) : 0;
      rows.push({ turn, cardsDrawn: Math.min(cardsDrawn, deckSize), prob1, prob2 });
    }
    return { cardName: targetCard, copies, rows };
  }, [deck, targetCard, byTurn, deckSize]);

  // Land probability for mulligan analysis
  const landCount = useMemo(() =>
    deck.mainboard.filter(c => (c.cardData?.type_line || "").includes("Land")).reduce((a, c) => a + c.qty, 0),
    [deck]
  );

  const mulliganStats = useMemo(() => {
    const stats = [];
    for (let handSize = 7; handSize >= 4; handSize--) {
      const lands = [];
      for (let l = 0; l <= handSize; l++) {
        const prob = hypergeom(deckSize, landCount, handSize, l) -
          (l < handSize ? hypergeom(deckSize, landCount, handSize, l + 1) : 0);
        lands.push({ count: l, prob: Math.max(prob, 0) });
      }
      const ideal = lands.filter(l => l.count >= 2 && l.count <= 4).reduce((a, l) => a + l.prob, 0);
      stats.push({ handSize, lands, idealProb: ideal });
    }
    return stats;
  }, [deck, deckSize, landCount]);

  return (
    <div className="glass-panel" style={{
      marginTop: 20, padding: 18, border: "1px solid rgba(77,163,212,0.15)",
      background: "rgba(10,10,10,0.4)", borderRadius: 12, animation: "slideUp 0.3s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#4DA3D4", letterSpacing: 2, fontFamily: "'Cinzel', serif" }}>📐 DRAW PROBABILITY</div>
        <button onClick={onClose} style={{ ...xBtn, fontSize: 10, borderRadius: 6 }}>✕</button>
      </div>

      {/* Card search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={targetCard}
          onChange={e => setTargetCard(e.target.value)}
          placeholder="Search for a card in your deck..."
          style={{
            flex: 1, padding: "8px 12px", background: "#0a0a0a", border: "1px solid #1a1a1a",
            borderRadius: 6, color: "#ccc", fontSize: 12, fontFamily: "'Crimson Text', serif", outline: "none",
          }}
        />
      </div>

      {/* Results table */}
      {results && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8 }}>
            <strong style={{ color: "#4DA3D4" }}>{results.copies}x</strong> copies in {deckSize} cards
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
            {results.rows.slice(0, 10).map(r => {
              const pct = Math.round(r.prob1 * 100);
              const color = pct >= 80 ? "#4DB87A" : pct >= 50 ? "#c9a84c" : pct >= 25 ? "#E0895A" : "#E05A50";
              return (
                <div key={r.turn} style={{
                  padding: "6px 4px", background: "rgba(0,0,0,0.3)", borderRadius: 6, textAlign: "center",
                  border: r.turn === byTurn ? "1px solid #4DA3D433" : "1px solid transparent",
                  cursor: "pointer",
                }}
                  onClick={() => setByTurn(r.turn)}
                >
                  <div style={{ fontSize: 8, color: "#444", letterSpacing: 1, marginBottom: 3 }}>T{r.turn}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "'Cinzel', serif" }}>{pct}%</div>
                  <div style={{ height: 2, background: "#151515", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mulligan analysis */}
      <div>
        <div style={{ fontSize: 9, color: "#c9a84c88", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>
          MULLIGAN ANALYSIS ({landCount} LANDS / {deckSize} CARDS)
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {mulliganStats.map(ms => {
            const pct = Math.round(ms.idealProb * 100);
            return (
              <div key={ms.handSize} style={{
                flex: 1, padding: "8px 6px", background: "rgba(0,0,0,0.25)", borderRadius: 8, textAlign: "center",
                border: "1px solid rgba(255,255,255,0.03)",
              }}>
                <div style={{ fontSize: 8, color: "#555", letterSpacing: 1, marginBottom: 4 }}>
                  {ms.handSize === 7 ? "KEEP 7" : `MULL→${ms.handSize}`}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: pct >= 70 ? "#4DB87A" : pct >= 50 ? "#c9a84c" : "#E05A50", fontFamily: "'Cinzel', serif" }}>
                  {pct}%
                </div>
                <div style={{ fontSize: 8, color: "#444" }}>2-4 lands</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
