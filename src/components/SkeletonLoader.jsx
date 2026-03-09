/**
 * Skeleton loading placeholders for deck cards and analytics.
 */

export function CardRowSkeleton({ count = 8 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
            borderRadius: 5, animation: `shimmer 1.5s ease-in-out ${i * 0.06}s infinite`,
          }}
        >
          <div style={{ width: 20, height: 10, borderRadius: 3, background: "rgba(255,255,255,0.04)" }} />
          <div style={{ flex: 1, height: 10, borderRadius: 3, background: "rgba(255,255,255,0.04)" }} />
          <div style={{ width: 30, height: 10, borderRadius: 3, background: "rgba(255,255,255,0.03)" }} />
        </div>
      ))}
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeIn 0.3s ease" }}>
      {/* Curve skeleton */}
      <div style={{ padding: "10px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.03)" }}>
        <div style={{ width: 60, height: 8, borderRadius: 3, background: "rgba(255,255,255,0.04)", marginBottom: 12 }} />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
          {[30, 50, 70, 45, 25, 15, 8, 5].map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1, height: `${h}%`, background: "rgba(201,168,76,0.06)",
                borderRadius: "3px 3px 1px 1px",
                animation: `shimmer 1.5s ease-in-out ${i * 0.1}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Types skeleton */}
      <div style={{ padding: "10px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.03)" }}>
        <div style={{ width: 55, height: 8, borderRadius: 3, background: "rgba(255,255,255,0.04)", marginBottom: 12 }} />
        {[80, 60, 40, 30, 20].map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <div style={{ width: 60, height: 8, borderRadius: 3, background: "rgba(255,255,255,0.03)" }} />
            <div style={{ flex: 1, height: 7, background: "rgba(255,255,255,0.02)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                width: `${w}%`, height: "100%", background: "rgba(255,255,255,0.04)", borderRadius: 4,
                animation: `shimmer 1.5s ease-in-out ${i * 0.12}s infinite`,
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DeckGridSkeleton({ count = 4 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: "rgba(0,0,0,0.25)", borderRadius: 12, padding: 14,
            border: "1px solid rgba(255,255,255,0.04)", height: 140,
            animation: `shimmer 1.5s ease-in-out ${i * 0.1}s infinite`,
          }}
        >
          <div style={{ width: "60%", height: 12, borderRadius: 4, background: "rgba(255,255,255,0.04)", marginBottom: 10 }} />
          <div style={{ width: "40%", height: 8, borderRadius: 3, background: "rgba(255,255,255,0.03)", marginBottom: 16 }} />
          <div style={{ width: "80%", height: 6, borderRadius: 3, background: "rgba(255,255,255,0.02)", marginBottom: 4 }} />
          <div style={{ width: "70%", height: 6, borderRadius: 3, background: "rgba(255,255,255,0.02)" }} />
        </div>
      ))}
    </div>
  );
}
