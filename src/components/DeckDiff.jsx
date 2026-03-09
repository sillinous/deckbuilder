/**
 * Animated side-by-side deck diff component.
 * Shows adds, removes, and changes between two decks.
 */
export default function DeckDiff({ deckA, deckB, nameA = "Deck A", nameB = "Deck B" }) {
  const mapCards = (cards) => {
    const m = {};
    cards.forEach(c => { m[c.name] = (m[c.name] || 0) + c.qty; });
    return m;
  };

  const mapA = mapCards(deckA.mainboard);
  const mapB = mapCards(deckB.mainboard);
  const allNames = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort();

  const diffs = allNames.map(name => {
    const qtyA = mapA[name] || 0;
    const qtyB = mapB[name] || 0;
    const delta = qtyB - qtyA;
    let type = "same";
    if (qtyA === 0) type = "added";
    else if (qtyB === 0) type = "removed";
    else if (delta !== 0) type = "changed";
    return { name, qtyA, qtyB, delta, type };
  });

  const added = diffs.filter(d => d.type === "added");
  const removed = diffs.filter(d => d.type === "removed");
  const changed = diffs.filter(d => d.type === "changed");
  const same = diffs.filter(d => d.type === "same");

  const DiffRow = ({ diff, i }) => {
    const color = diff.type === "added" ? "#4DB87A" : diff.type === "removed" ? "#E05A50" : diff.type === "changed" ? "#c9a84c" : "#555";
    const bg = diff.type === "added" ? "rgba(77,184,122,0.04)" : diff.type === "removed" ? "rgba(224,90,80,0.04)" : diff.type === "changed" ? "rgba(201,168,76,0.04)" : "transparent";
    const icon = diff.type === "added" ? "+" : diff.type === "removed" ? "−" : diff.type === "changed" ? "~" : "=";

    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "4px 8px",
        background: bg, borderRadius: 5, fontSize: 11,
        borderLeft: `2px solid ${color}33`,
        animation: `cardEntrance 0.2s ease ${i * 0.02}s both`,
      }}>
        <span style={{ color, fontWeight: 700, width: 14, textAlign: "center", fontSize: 13 }}>{icon}</span>
        <span style={{ color: "#aaa", flex: 1 }}>{diff.name}</span>
        {diff.type === "changed" ? (
          <span style={{ fontSize: 10, color }}>
            {diff.qtyA}x → {diff.qtyB}x
            <span style={{ marginLeft: 4, fontSize: 9 }}>({diff.delta > 0 ? "+" : ""}{diff.delta})</span>
          </span>
        ) : (
          <span style={{ fontSize: 10, color: "#666" }}>
            {diff.type === "removed" ? `${diff.qtyA}x` : `${diff.qtyB}x`}
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {/* Summary badges */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { label: "Added", count: added.length, color: "#4DB87A" },
          { label: "Removed", count: removed.length, color: "#E05A50" },
          { label: "Changed", count: changed.length, color: "#c9a84c" },
          { label: "Unchanged", count: same.length, color: "#555" },
        ].map(b => (
          <div key={b.label} style={{
            padding: "4px 12px", borderRadius: 6, background: `${b.color}08`,
            border: `1px solid ${b.color}22`, fontSize: 10, color: b.color, fontFamily: "'Cinzel', serif",
          }}>
            {b.label}: <strong>{b.count}</strong>
          </div>
        ))}
      </div>

      {/* Diff list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 400, overflowY: "auto" }}>
        {[...added, ...removed, ...changed, ...same].map((d, i) => (
          <DiffRow key={d.name} diff={d} i={i} />
        ))}
      </div>
    </div>
  );
}
