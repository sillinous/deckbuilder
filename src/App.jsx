import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  sfSearch,
  sfNamed,
  getCardImage,
  parseDecklist,
  hasDeck,
  computeCurve,
  computeTypes,
  manaColor,
  computePrice,
  analyzeManaBase,
  generateDeckArray,
  shuffleArray,
  drawHand,
  exportDeck,
  runGoldfishSim,
  loadProviderConfig,
  saveProviderConfig,
  getApiHeaders,
  deckColorIds,
  deckToText,
  loadVault,
  saveVault,
  serializeDeck,
  runToolLoop,
  generateOptimalLands,
  aiIdentifySynergies
} from "./utils";
import {
  AI_PROVIDERS,
  FORMATS,
  COLORS,
  ARCHETYPES,
  AGENT_SYSTEM,
  QUICK_PROMPTS,
  SB_GUIDE_SYSTEM,
  BUDGET_SYSTEM,
  SIM_SYSTEM,
  VAULT_KEY,
  IMPORT_ANALYSIS_PROMPT,
  xBtn,
  GLASS_STYLE
} from "./constants";

// ═══════════════════════════════════════════════════════════
// SHARED AI HELPERS
// ═══════════════════════════════════════════════════════════

async function aiGenerateGuide(deck, providerCfg) {
  try {
    const list = deckToText(deck);
    const res = await runToolLoop(SB_GUIDE_SYSTEM, [{ role: "user", content: `Generate a sideboard guide for this deck:\n${list}` }], providerCfg, () => { });
    const textBlob = (res.content || []).map(b => b.text || "").join("");
    const jsonMatch = textBlob.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch { return null; }
}

async function aiBudgetize(deck, providerCfg, mode = "budget") {
  try {
    const list = deckToText(deck);
    const totalPrice = computePrice([...deck.mainboard, ...(deck.sideboard || [])]);
    const prompt = (mode === "budget" || totalPrice > 100) ? "Suggest budget replacements for this deck." : "Suggest 'Power Up' / high-end replacements for this deck.";
    const res = await runToolLoop(BUDGET_SYSTEM, [{ role: "user", content: `${prompt}\n\nDECK:\n${list}` }], providerCfg, () => { });
    const textBlob = (res.content || []).map(b => b.text || "").join("");
    const jsonMatch = textBlob.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch { return null; }
}

async function aiEnrichDeck(parsed, setStatus) {
  const cache = {};
  const all = [...parsed.mainboard, ...parsed.sideboard, ...(parsed.commander || [])];
  let done = 0;
  for (const entry of all) {
    const k = entry.name.toLowerCase();
    if (cache[k]) {
      entry.cardData = cache[k];
      done++;
      setStatus(`Loading card data (${done}/${all.length})...`);
      continue;
    }
    try {
      const cd = await sfNamed(entry.name);
      if (cd) { cache[k] = cd; entry.cardData = cd; }
    } catch (e) {
      console.error(`Failed to load ${entry.name}:`, e);
    }
    done++;
    setStatus(`Loading card data (${done}/${all.length})...`);
    await new Promise(r => setTimeout(r, 65));
  }
  return {
    mainboard: parsed.mainboard.map(e => ({ ...e, cardData: e.cardData || cache[e.name.toLowerCase()] || null })),
    sideboard: parsed.sideboard.map(e => ({ ...e, cardData: e.cardData || cache[e.name.toLowerCase()] || null })),
    commander: (parsed.commander || []).map(e => ({ ...e, cardData: e.cardData || cache[e.name.toLowerCase()] || null })),
    analysis: parsed.analysis,
  };
}


function ManaBackground({ colors }) {
  const hexMap = { W: "#F0E6B2", U: "#4DA3D4", B: "#A68DA0", R: "#E05A50", G: "#4DB87A", C: "#181818" };
  const activeBlobs = colors && colors.length > 0 ? colors : ["C"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", background: "#040404" }}>
      <svg style={{ width: "100%", height: "100%", opacity: 0.2, filter: "blur(120px)" }}>
        {activeBlobs.map((c, i) => (
          <circle
            key={i}
            cx={`${20 + (i * 55) / activeBlobs.length}%`}
            cy={`${30 + (i * 35) / activeBlobs.length}%`}
            r="30%"
            fill={hexMap[c] || hexMap.C}
            style={{
              animation: `orbital ${25 + i * 7}s linear infinite`,
              transformOrigin: "center",
              opacity: 0.5,
            }}
          />
        ))}
      </svg>
      {/* Subtle grain overlay */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 30% 20%, rgba(201,168,76,0.02), transparent 60%), radial-gradient(circle at center, transparent 30%, #040404 95%)" }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════

function CurveChart({ data }) {
  const max = Math.max(...Object.values(data), 1);
  const keys = ["0","1","2","3","4","5","6","7+"];
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80, padding: "0 2px" }}>
      {keys.map((k, i) => {
        const val = data[k] || 0;
        const pct = Math.round((val / total) * 100);
        const barH = Math.max((val / max) * 54, 0);
        const isHighest = val === max && val > 0;
        return (
          <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: 2 }}>
            <span style={{ fontSize: 9, color: isHighest ? "#c9a84c" : "#555", fontWeight: isHighest ? 700 : 400, transition: "color 0.3s" }}>{val || ""}</span>
            <div style={{ width: "100%", position: "relative" }}>
              <div style={{
                width: "100%", minWidth: 14,
                height: `${barH}px`,
                background: isHighest ? "linear-gradient(to top, #c9a84c66, #c9a84c)" : "linear-gradient(to top, #c9a84c33, #c9a84c88)",
                borderRadius: "3px 3px 1px 1px",
                transition: "height 0.5s cubic-bezier(0.19, 1, 0.22, 1)",
                transformOrigin: "bottom",
                animation: `barGrow 0.6s ease-out ${i * 0.05}s both`,
                boxShadow: isHighest ? "0 -2px 8px rgba(201,168,76,0.2)" : "none",
              }} />
            </div>
            <span style={{ fontSize: 8, color: "#3a3a3a", fontFamily: "'Cinzel', serif" }}>{k}</span>
          </div>
        );
      })}
    </div>
  );
}

function TypeBars({ data }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  const clr = { Creature: "#4DB87A", Planeswalker: "#c9a84c", Land: "#8B7355", Battle: "#E05A50", Instant: "#4DA3D4", Sorcery: "#E06A50", Enchantment: "#A68DA0", Artifact: "#777", Other: "#444" };
  const icons = { Creature: "👤", Planeswalker: "🌟", Land: "🏔", Battle: "⚔", Instant: "⚡", Sorcery: "🔮", Enchantment: "✨", Artifact: "🔧", Other: "•" };
  const sorted = Object.entries(data).filter(([,ct]) => ct > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {sorted.map(([tp, ct], i) => (
        <div key={tp} style={{ display: "flex", alignItems: "center", gap: 6, animation: `cardEntrance 0.3s ease ${i * 0.04}s both` }}>
          <span style={{ fontSize: 9, color: "#555", width: 72, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
            <span style={{ fontSize: 8, opacity: 0.6 }}>{icons[tp]}</span>
            {tp}
          </span>
          <div style={{ flex: 1, height: 7, background: "#0f0f0f", borderRadius: 4, overflow: "hidden", border: "1px solid #1a1a1a" }}>
            <div style={{ width: `${(ct / total) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${clr[tp] || "#444"}88, ${clr[tp] || "#444"})`, borderRadius: 4, transition: "width 0.5s cubic-bezier(0.19, 1, 0.22, 1)", boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15)` }} />
          </div>
          <span style={{ fontSize: 9, color: clr[tp] || "#555", width: 22, textAlign: "right", fontWeight: 600, fontFamily: "'Cinzel', serif" }}>{ct}</span>
        </div>
      ))}
    </div>
  );
}

function ManaAnalytics({ data, onAutoFix }) {
  const { pips, sources } = data;
  const clr = { W: "#F0E6B2", U: "#4DA3D4", B: "#A68DA0", R: "#E05A50", G: "#4DB87A", C: "#888", Any: "#c9a84c" };
  const keys = ["W", "U", "B", "R", "G", "C"];
  const activeKeys = keys.filter(k => pips[k] > 0 || sources[k] > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {activeKeys.map((k, i) => {
        const req = pips[k];
        const src = sources[k] + sources.Any;
        const diff = src - req;
        const status = diff < 0 && req > 0 ? "deficit" : diff >= 0 && req > 0 ? "good" : "neutral";
        const statusColor = status === "deficit" ? "#E05A50" : status === "good" ? "#4DB87A" : "#555";
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, padding: "3px 0", animation: `cardEntrance 0.3s ease ${i * 0.05}s both` }}>
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: clr[k], display: "flex", alignItems: "center", justifyContent: "center", color: k === "W" || k === "C" ? "#333" : "#000", fontWeight: 700, fontSize: 7, boxShadow: `0 0 6px ${clr[k]}33`, flexShrink: 0 }}>{k}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ color: "#666", fontSize: 9 }}>Need <strong style={{ color: "#aaa" }}>{req}</strong></span>
                <span style={{ color: statusColor, fontSize: 9, fontWeight: 600 }}>{src} src {status === "deficit" && `(${diff})`}</span>
              </div>
              <div style={{ height: 3, background: "#151515", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min((src / Math.max(req, 1)) * 100, 100)}%`, height: "100%", background: statusColor, borderRadius: 3, transition: "width 0.5s ease" }} />
              </div>
            </div>
          </div>
        );
      })}
      {sources.Any > 0 && <div style={{ fontSize: 8, color: "#c9a84c88", marginTop: 2, fontStyle: "italic" }}>+{sources.Any} any-color sources</div>}
      {onAutoFix && (
        <button onClick={onAutoFix} style={{ ...xBtn, marginTop: 8, background: "linear-gradient(135deg, #0f1f0f, #0a140a)", borderColor: "#4DB87A22", color: "#4DB87A", width: "100%", fontSize: 9, borderRadius: 6, padding: "6px 10px", transition: "all 0.25s" }}
          onMouseOver={e => { e.currentTarget.style.borderColor = "#4DB87A44"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(77,184,122,0.1)"; }}
          onMouseOut={e => { e.currentTarget.style.borderColor = "#4DB87A22"; e.currentTarget.style.boxShadow = "none"; }}
        >
          🪄 Auto-Fix Lands
        </button>
      )}
    </div>
  );
}

function CardRow({ card, onHover, isEditMode, onUpdateQty, synergyHighlight, onSuggest, inventory, onUpdateInventory, onCtx }) {
  const tiltRef = useRef(null);
  const handleMove = (e) => {
    if (!tiltRef.current) return;
    const rect = tiltRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    tiltRef.current.style.transform = `perspective(1000px) rotateY(${x * 15}deg) rotateX(${y * -15}deg) scale(1.02)`;
  };
  const handleLeave = () => {
    if (!tiltRef.current) return;
    tiltRef.current.style.transform = `perspective(1000px) rotateY(0deg) rotateX(0deg) scale(1)`;
    onHover(null, null);
  };

  const owned = inventory?.[card.name] || 0;
  const isMissing = owned < card.qty;
  const img = getCardImage(card.cardData);
  const price = card.cardData?.prices?.usd || card.cardData?.prices?.usd_foil;

  const rarity = card.cardData?.rarity;
  const rarityColor = rarity === "mythic" ? "#E05A50" : rarity === "rare" ? "#c9a84c" : rarity === "uncommon" ? "#b0b0b0" : "#555";
  const manaCostDisplay = card.cardData?.mana_cost?.replace(/[{}]/g, "") || "";

  return (
    <div
      ref={tiltRef}
      className="lux-card"
      style={{
        display: "flex", alignItems: "center", padding: "3px 8px", borderRadius: 5, cursor: "default",
        background: isMissing ? "rgba(224, 90, 80, 0.04)" : synergyHighlight ? "rgba(201, 168, 76, 0.1)" : "transparent",
        boxShadow: isMissing ? "inset 2px 0 0 #E05A50" : synergyHighlight ? "inset 2px 0 0 #c9a84c, 0 0 8px rgba(201, 168, 76, 0.15)" : "none",
        transition: "all 0.15s ease-out",
        borderBottom: "1px solid rgba(255,255,255,0.025)",
        willChange: "transform",
        minHeight: 26,
      }}
      onContextMenu={e => {
        if (onCtx) {
          e.preventDefault();
          onCtx({ x: e.clientX, y: e.clientY, card });
        }
      }}
      onMouseMove={handleMove} onMouseEnter={() => img && onHover(img, card.name)} onMouseLeave={handleLeave}>
      <div style={{ width: 22, fontSize: 10, color: isMissing ? "#E05A50" : "#666", fontWeight: 700, fontFamily: "'Cinzel', serif" }}>{card.qty}x</div>
      {rarity && <div style={{ width: 3, height: 3, borderRadius: "50%", background: rarityColor, marginRight: 6, flexShrink: 0, boxShadow: rarity === "mythic" ? "0 0 4px #E05A5066" : rarity === "rare" ? "0 0 4px #c9a84c44" : "none" }} />}
      <div style={{ flex: 1, fontSize: 11, color: isMissing ? "#ddd" : synergyHighlight ? "#ddc" : "#aaa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginRight: 8, letterSpacing: 0.2 }}>{card.name}</div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {manaCostDisplay && <div style={{ fontSize: 9, color: "#444", fontFamily: "'Cinzel', serif", letterSpacing: 0.5 }}>{manaCostDisplay}</div>}
        {price && <span style={{ fontSize: 8, color: "#4DB87A66", fontFamily: "'Cinzel', serif" }}>${parseFloat(price).toFixed(0)}</span>}
        {onSuggest && (
          <button
            onClick={(e) => { e.stopPropagation(); onSuggest(card.name); }}
            style={{ ...xBtn, padding: "1px 5px", fontSize: 10, border: "none", background: "transparent", color: "#c9a84c55", transition: "color 0.2s" }}
            onMouseOver={e => e.currentTarget.style.color = "#c9a84c"}
            onMouseOut={e => e.currentTarget.style.color = "#c9a84c55"}
          >🔮</button>
        )}
        {isEditMode && (
          <div style={{ display: "flex", gap: 2, marginLeft: 4 }}>
            <button onClick={(e) => { e.stopPropagation(); onUpdateQty(card.name, -1); }} style={{ ...xBtn, padding: "1px 6px", fontSize: 11, borderRadius: 4 }}>−</button>
            <button onClick={(e) => { e.stopPropagation(); onUpdateQty(card.name, 1); }} style={{ ...xBtn, padding: "1px 6px", fontSize: 11, borderRadius: 4 }}>+</button>
          </div>
        )}
        {onUpdateInventory && (
          <button
            onClick={(e) => { e.stopPropagation(); onUpdateInventory(card.name, isMissing ? card.qty - owned : -1); }}
            style={{ ...xBtn, marginLeft: 2, padding: "1px 5px", fontSize: 9, background: isMissing ? "#E05A5008" : "transparent", color: isMissing ? "#E05A50" : "#4DB87A66", border: "none", transition: "color 0.2s" }}
          >
            {isMissing ? "🎒+" : "✓"}
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// NEW COMPONENTS FOR PHASE 3
function InventoryManager({ inventory, onUpdate }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const search = async (q) => {
    if (!q.trim()) return;
    setSearching(true);
    const res = await sfSearch(q);
    setResults(res || []);
    setSearching(false);
  };

  const owned = Object.entries(inventory).filter(([_, qty]) => qty > 0);

  return (
    <div className="glass-panel" style={{ ...GLASS_STYLE, padding: 25, animation: "fadeIn 0.3s ease" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
        <div>
          <div style={{ fontSize: 10, color: "#c9a84c", letterSpacing: 2, marginBottom: 16, fontFamily: "'Cinzel', serif" }}>ADD TO COLLECTION</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => e.key === "Enter" && search(searchTerm)}
              placeholder="Search for cards..."
              style={{ flex: 1, padding: "10px 14px", background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 6, color: "#eee", fontSize: 13 }}
            />
            <button onClick={() => search(searchTerm)} style={{ ...xBtn, background: "#c9a84c", color: "#000", fontWeight: 700 }}>SEARCH</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "70vh", overflowY: "auto" }}>
            {searching ? <div style={{ color: "#555", fontSize: 11 }}>Searching...</div> : results.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#0d0d0d", borderRadius: 6, border: "1px solid #1a1a1a" }}>
                <div style={{ fontSize: 12, color: "#aaa" }}>{c.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#c9a84c" }}>Owned: {inventory[c.name] || 0}</span>
                  <button onClick={() => onUpdate(c.name, 1)} style={{ ...xBtn, padding: "2px 8px" }}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#c9a84c", letterSpacing: 2, marginBottom: 16, fontFamily: "'Cinzel', serif" }}>MY INVENTORY ({owned.length} UNIQUE)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "75vh", overflowY: "auto" }}>
            {owned.length === 0 ? <div style={{ color: "#444", fontSize: 11, fontStyle: "italic" }}>No cards in collection yet.</div> : owned.reverse().map(([name, qty]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#0d0d0d", borderRadius: 6, border: "1px solid #1a1a1a" }}>
                <div style={{ fontSize: 12, color: "#eee" }}>{name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => onUpdate(name, -1)} style={{ ...xBtn, padding: "2px 6px" }}>-</button>
                  <span style={{ fontSize: 11, color: "#c9a84c", fontWeight: "bold", width: 20, textAlign: "center" }}>{qty}</span>
                  <button onClick={() => onUpdate(name, 1)} style={{ ...xBtn, padding: "2px 6px" }}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════

function RecommendationStats({ data, onClear, targetCard }) {
  return (
    <div className="glass-panel" style={{ ...GLASS_STYLE, marginTop: 20, padding: 16, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#c9a84c", letterSpacing: 2, fontFamily: "'Cinzel', serif" }}>🔮 RECOMMENDATIONS FOR: {targetCard.toUpperCase()}</div>
        <button onClick={onClear} style={{ ...xBtn, fontSize: 10 }}>✕ Clear</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {data.recommendations.map((r, i) => (
          <div key={i} style={{ background: "#111", borderRadius: 6, padding: 12, border: "1px solid #1a1a1a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: "bold", color: "#eee" }}>{r.name}</span>
              <span style={{ fontSize: 9, color: r.role === "Upgrade" ? "#4DB87A" : r.role === "Synergy" ? "#c9a84c" : "#888", border: "1px solid currentColor", padding: "1px 4px", borderRadius: 3, textTransform: "uppercase" }}>{r.role}</span>
            </div>
            <div style={{ fontSize: 10, color: "#888", lineHeight: 1.4 }}>{r.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SideboardGuide({ guide, onClear }) {
  return (
    <div className="glass-panel" style={{ ...GLASS_STYLE, marginTop: 20, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#c9a84c", letterSpacing: 2, fontFamily: "'Cinzel', serif" }}>AI SIDEBOARD GUIDE</div>
        <button onClick={onClear} style={{ ...xBtn, fontSize: 10 }}>✕ Clear</button>
      </div>
      <div style={{ fontSize: 12, color: "#aaa", fontFamily: "'Crimson Text', serif", lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 16 }}>
        {guide.analysis}
      </div>
      {guide.matchups && guide.matchups.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {guide.matchups.map((m, i) => (
            <div key={i} style={{ background: "#111", borderRadius: 6, padding: 10, borderLeft: "3px solid #c9a84c" }}>
              <div style={{ color: "#c9a84c", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>VS {m.opponent}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 9, color: "#4DB87A", marginBottom: 3 }}>IN (+)</div>
                  <div style={{ fontSize: 10, color: "#888" }}>{m.in || "None"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#E05A50", marginBottom: 3 }}>OUT (-)</div>
                  <div style={{ fontSize: 10, color: "#888" }}>{m.out || "None"}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GoldfishStats({ data, onClear }) {
  const maxDpt = Math.max(...data.dpt.map(Number), 1);
  return (
    <div className="glass-panel" style={{ ...GLASS_STYLE, marginTop: 20, padding: 18, position: "relative", animation: "slideUp 0.3s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: "#c9a84c", letterSpacing: 2, fontFamily: "'Cinzel', serif", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12 }}>📊</span> GOLDFISH STATS
          <span style={{ fontSize: 8, color: "#444", fontStyle: "italic", fontFamily: "'Crimson Text', serif", letterSpacing: 0 }}>500 iterations</span>
        </div>
        <button onClick={onClear} style={{ ...xBtn, fontSize: 10, borderRadius: 6 }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18 }}>
        {[
          ["Avg Kill Turn", data.avgKillTurn, "#E05A50", "⚡"],
          ["Reliability", `${data.reliability}%`, "#4DB87A", "🎯"],
          ["Lands @ T4", data.avgLandsTurn4, "#4DA3D4", "🏔"],
        ].map(([l, v, c, icon], i) => (
          <div key={l} style={{ background: "rgba(0,0,0,0.3)", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.04)", textAlign: "center", animation: `cardEntrance 0.3s ease ${i * 0.08}s both` }}>
            <div style={{ fontSize: 8, color: "#555", marginBottom: 4, letterSpacing: 1 }}>{icon} {l}</div>
            <div style={{ fontSize: 20, color: c, fontWeight: 700, fontFamily: "'Cinzel', serif" }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 8, color: "#555", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>DAMAGE PER TURN</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 65, padding: "0 2px" }}>
        {data.dpt.map((d, i) => {
          const isKillTurn = i + 1 === Math.round(Number(data.avgKillTurn));
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span style={{ fontSize: 7, color: isKillTurn ? "#E05A50" : "#444" }}>{Number(d) > 0 ? d : ""}</span>
              <div style={{
                width: "100%", height: `${(d / maxDpt) * 100}%`, minHeight: d > 0 ? 3 : 0,
                background: isKillTurn ? "linear-gradient(to top, #E05A5066, #E05A50)" : "linear-gradient(to top, #c9a84c33, #c9a84c77)",
                borderRadius: "3px 3px 1px 1px", transition: "height 0.5s cubic-bezier(0.19,1,0.22,1)",
                boxShadow: isKillTurn ? "0 -2px 8px rgba(224,90,80,0.2)" : "none",
                animation: `barGrow 0.5s ease-out ${i * 0.04}s both`, transformOrigin: "bottom",
              }} />
              <span style={{ fontSize: 7, color: isKillTurn ? "#E05A50" : "#333", fontWeight: isKillTurn ? 700 : 400 }}>T{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BudgetSuggestions({ data, onClear }) {
  return (
    <div className="glass-panel" style={{ ...GLASS_STYLE, marginTop: 20, padding: 16, border: "1px solid #4DB87A33" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#4DB87A", letterSpacing: 2, fontFamily: "'Cinzel', serif" }}>BUDGET / POWER ADVICE</div>
        <button onClick={onClear} style={{ ...xBtn, fontSize: 10 }}>✕ Clear</button>
      </div>
      <div style={{ fontSize: 12, color: "#aaa", fontFamily: "'Crimson Text', serif", lineHeight: 1.6, marginBottom: 16 }}>
        {data.analysis}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.suggestions.map((s, i) => (
          <div key={i} style={{ background: "#111", borderRadius: 6, padding: 10, borderLeft: "3px solid #4DB87A" }}>
            <span style={{ fontSize: 12 }}><del style={{ color: "#666" }}>{s.original}</del> → <strong style={{ color: "#c9a84c" }}>{s.replacement}</strong></span>
            <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>{s.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MosaicView({ deck, onHover, synergyMap, activeCard }) {
  const tiltRefs = useRef({});
  const related = activeCard && synergyMap ? synergyMap.synergies.filter(s => s.cards.includes(activeCard)) : [];
  const relatedNames = related.flatMap(s => s.cards);

  const handleMove = (e, name) => {
    const el = tiltRefs.current[name];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(1000px) rotateY(${x * 12}deg) rotateX(${y * -12}deg) scale(1.05)`;
    el.style.zIndex = 10;
  };
  const handleLeave = (name) => {
    const el = tiltRefs.current[name];
    if (!el) return;
    el.style.transform = `perspective(1000px) rotateY(0deg) rotateX(0deg) scale(1)`;
    el.style.zIndex = 1;
    onHover(null, null);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, padding: "10px 0" }}>
      {deck.mainboard.map((c, i) => {
        const img = getCardImage(c.cardData);
        const isRelated = relatedNames.includes(c.name);
        return (
          <div key={i}
            ref={el => tiltRefs.current[c.name + i] = el}
            onMouseMove={(e) => handleMove(e, c.name + i)}
            onMouseEnter={() => img && onHover(img, c.name)}
            onMouseLeave={() => handleLeave(c.name + i)}
            style={{
              position: "relative", aspectRatio: "0.717", borderRadius: 6, overflow: "hidden", background: "#111",
              border: isRelated ? "2px solid #c9a84c" : "1px solid #222",
              boxShadow: isRelated ? "0 0 15px #c9a84c66" : "none",
              transition: "transform 0.2s, border 0.3s, box-shadow 0.3s"
            }}
            onMouseOver={e => e.currentTarget.style.transform = "scale(1.05)"} onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}>
            {img ? <img src={img} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#444", textAlign: "center" }}>{c.name}</div>}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, padding: "2px 4px", textAlign: "center" }}>{c.qty}x</div>
          </div>
        );
      })}
    </div>
  );
};

function StackView({ deck, onHover, synergyMap, activeCard }) {
  const tiltRefs = useRef({});
  const related = activeCard && synergyMap ? synergyMap.synergies.filter(s => s.cards.includes(activeCard)) : [];
  const relatedNames = related.flatMap(s => s.cards);

  const handleMove = (e, id) => {
    const el = tiltRefs.current[id];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(1000px) rotateY(${x * 12}deg) rotateX(${y * -12}deg) translateX(10px)`;
    el.style.zIndex = 100;
  };
  const handleLeave = (id) => {
    const el = tiltRefs.current[id];
    if (!el) return;
    el.style.transform = `perspective(1000px) rotateY(0deg) rotateX(0deg) translateX(0)`;
    el.style.zIndex = 1;
    onHover(null, null);
  };

  const groups = {};
  deck.mainboard.forEach(c => {
    const cmc = c.cardData?.cmc || 0;
    const k = cmc >= 7 ? "7+" : cmc.toString();
    if (!groups[k]) groups[k] = [];
    groups[k].push(c);
  });

  const cols = ["0", "1", "2", "3", "4", "5", "6", "7+"];

  return (
    <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "10px 0", minHeight: 400 }}>
      {cols.map(mv => (groups[mv] || []).length > 0 && (
        <div key={mv} style={{ minWidth: 140, flex: 1 }}>
          <div style={{ fontSize: 9, color: "#c9a84c88", textAlign: "center", marginBottom: 8, paddingBottom: 6, fontFamily: "'Cinzel', serif", letterSpacing: 1, position: "relative" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#c9a84c66", display: "block" }}>{mv}</span>
            <span style={{ fontSize: 8, color: "#333", letterSpacing: 2 }}>CMC · {groups[mv].reduce((a,c) => a + c.qty, 0)} CARDS</span>
            <div style={{ position: "absolute", bottom: 0, left: "15%", right: "15%", height: 1, background: "linear-gradient(90deg, transparent, rgba(201,168,76,0.2), transparent)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", position: "relative", gap: 3 }}>
            {groups[mv].map((c, i) => {
              const img = getCardImage(c.cardData);
              const isRelated = relatedNames.includes(c.name);
              const manaCost = c.cardData?.mana_cost?.replace(/[{}]/g, "") || "";
              return (
                <div key={i}
                  ref={el => tiltRefs.current[c.name + i] = el}
                  onMouseMove={(e) => handleMove(e, c.name + i)}
                  onMouseEnter={() => img && onHover(img, c.name)}
                  onMouseLeave={() => handleLeave(c.name + i)}
                  style={{
                    position: "relative",
                    height: 38,
                    borderRadius: 6,
                    overflow: "hidden",
                    border: isRelated ? "1px solid #c9a84c66" : "1px solid rgba(255,255,255,0.04)",
                    boxShadow: isRelated ? "0 0 12px #c9a84c22" : "0 1px 3px rgba(0,0,0,0.2)",
                    background: "#080808",
                    cursor: "pointer",
                    transition: "all 0.2s cubic-bezier(0.19,1,0.22,1)",
                    animation: `cardEntrance 0.25s ease ${i * 0.03}s both`,
                  }}
                  onMouseOver={e => { e.currentTarget.style.transform = "translateX(6px) scale(1.02)"; e.currentTarget.style.zIndex = 10; e.currentTarget.style.borderColor = "rgba(201,168,76,0.2)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)"; }}
                  onMouseOut={e => { e.currentTarget.style.transform = "translateX(0) scale(1)"; e.currentTarget.style.zIndex = 1; e.currentTarget.style.borderColor = isRelated ? "#c9a84c66" : "rgba(255,255,255,0.04)"; e.currentTarget.style.boxShadow = isRelated ? "0 0 12px #c9a84c22" : "0 1px 3px rgba(0,0,0,0.2)"; }}
                >
                  {img && <img src={img} alt={c.name} style={{ width: "100%", height: 300, objectFit: "cover", objectPosition: "top", opacity: 0.45 }} />}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "linear-gradient(90deg, rgba(0,0,0,0.88) 20%, rgba(0,0,0,0.4) 60%, transparent 90%)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px" }}>
                    <div style={{ fontSize: 9, color: "#ddd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                      <span style={{ color: "#c9a84c", fontWeight: 700, marginRight: 4, fontFamily: "'Cinzel', serif" }}>{c.qty}x</span>{c.name}
                    </div>
                    {manaCost && <span style={{ fontSize: 8, color: "#55555588", fontFamily: "'Cinzel', serif", letterSpacing: 0.5, flexShrink: 0, marginLeft: 4 }}>{manaCost}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetaStats({ data, onClear }) {
  return (
    <div className="glass-panel" style={{ ...GLASS_STYLE, marginTop: 20, padding: 16, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#c9a84c", letterSpacing: 2, fontFamily: "'Cinzel', serif" }}>METAGAME COMPATIBILITY</div>
        <button onClick={onClear} style={{ ...xBtn, fontSize: 10 }}>✕ Clear</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {data.matchups.map((m, i) => (
          <div key={i} style={{ background: "#111", borderRadius: 6, padding: 10, borderLeft: `3px solid ${m.score >= 7 ? "#4DB87A" : m.score <= 4 ? "#E05A50" : "#c9a84c"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: "bold", color: "#eee" }}>{m.opponent}</span>
              <span style={{ fontSize: 11, color: m.score >= 7 ? "#4DB87A" : m.score <= 4 ? "#E05A50" : "#c9a84c" }}>{m.score}/10</span>
            </div>
            <div style={{ fontSize: 10, color: "#888", marginBottom: 6, lineHeight: 1.4 }}>{m.analysis}</div>
            <div style={{ fontSize: 9, color: "#aaa", fontStyle: "italic", borderTop: "1px solid #1a1a1a", paddingTop: 4 }}>💡 {m.advice}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Full deck display widget
function DeckDisplay({ deck: initialDeck, onHover, compact, listHeight, onSave, onGenerateGuide, onBudgetize, inventory, onUpdateInventory, onCtx }) {
  const [deck, setDeck] = useState(initialDeck);
  const ownedCount = (name) => inventory?.[name] || 0;
  const missingCards = deck.mainboard.filter(c => ownedCount(c.name) < c.qty);
  const costToComplete = missingCards.reduce((acc, c) => {
    const p = parseFloat(c.cardData?.prices?.usd || c.cardData?.prices?.usd_foil || 0);
    return acc + (p * (c.qty - ownedCount(c.name)));
  }, 0);

  const [testHand, setTestHand] = useState(null); // null = not testing, array = hand
  const [testDeck, setTestDeck] = useState([]);   // remaining deck
  const [mullCount, setMullCount] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [exportMode, setExportMode] = useState(null); // null, "text", "arena"
  const [viewMode, setViewMode] = useState("stack"); // "list", "mosaic", or "stack"
  const [sbGuide, setSbGuide] = useState(null); // { analysis: "", matchups: [] }
  const [isGeneratingGuide, setIsGeneratingGuide] = useState(false);
  const [goldfishData, setGoldfishData] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [budgetSuggestions, setBudgetSuggestions] = useState(null);
  const [isBudgetizing, setIsBudgetizing] = useState(false);
  const [synergyMap, setSynergyMap] = useState(null);
  const [isIdentifyingSynergies, setIsIdentifyingSynergies] = useState(false);
  const [activeCard, setActiveCard] = useState(null);
  const [metaData, setMetaData] = useState(null);
  const [isAnalyzingMeta, setIsAnalyzingMeta] = useState(false);
  const [metaStatus, setMetaStatus] = useState("");
  const [recommendations, setRecommendations] = useState(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestTarget, setSuggestTarget] = useState("");

  // Sync internal deck state if the parent passes down a completely new deck object
  useEffect(() => { setDeck(initialDeck); setSynergyMap(null); }, [initialDeck]);

  const curve = useMemo(() => computeCurve(deck.mainboard), [deck.mainboard]);
  const types = useMemo(() => computeTypes(deck.mainboard), [deck.mainboard]);
  const manaInfo = useMemo(() => analyzeManaBase([...deck.mainboard, ...(deck.sideboard || [])]), [deck]);
  const totalPrice = useMemo(() => computePrice([...deck.mainboard, ...(deck.sideboard || [])]), [deck]);

  const totalM = deck.mainboard.reduce((a, c) => a + c.qty, 0);
  const totalS = deck.sideboard.reduce((a, c) => a + c.qty, 0);
  const lands = deck.mainboard.filter(c => c.cardData?.type_line?.includes("Land")).reduce((a, c) => a + c.qty, 0);
  const nl = deck.mainboard.filter(c => c.cardData && !c.cardData.type_line?.includes("Land"));
  const avg = nl.length ? (nl.reduce((a, c) => a + (c.cardData.cmc || 0) * c.qty, 0) / nl.reduce((a, c) => a + c.qty, 0)).toFixed(2) : "—";

  const handleAutoFixLands = async () => {
    const format = deck.commander?.length ? "commander" : "standard";
    const lands = generateOptimalLands(deck, format);
    if (!lands.length) return;

    const updated = { ...deck, mainboard: [...deck.mainboard] };
    lands.forEach(l => {
      const idx = updated.mainboard.findIndex(c => c.name === l.name);
      if (idx !== -1) {
        updated.mainboard[idx] = { ...updated.mainboard[idx], qty: updated.mainboard[idx].qty + l.qty };
      } else {
        updated.mainboard.push({ ...l, cardData: { name: l.name, type_line: "Land", mana_cost: "", cmc: 0, image_uris: null } });
      }
    });

    setDeck(updated);
    const enriched = await aiEnrichDeck(updated, () => { });
    setDeck(enriched);
  };

  const handleUpdateQty = (cardName, delta) => {
    setDeck(prevDeck => {
      const currentTotal = prevDeck.mainboard.reduce((a, c) => a + c.qty, 0);

      const newDeck = { ...prevDeck, mainboard: [...prevDeck.mainboard], sideboard: [...(prevDeck.sideboard || [])] };
      // Look in mainboard first
      let idx = newDeck.mainboard.findIndex(c => c.name === cardName);
      if (idx !== -1) {
        const newQty = Math.max(0, newDeck.mainboard[idx].qty + delta);
        const diff = newQty - newDeck.mainboard[idx].qty;

        if (diff > 0 && currentTotal + diff > 4) {
          // Warning or just prevent
          return prevDeck;
        }

        newDeck.mainboard[idx] = { ...newDeck.mainboard[idx], qty: newQty };
        if (newDeck.mainboard[idx].qty <= 0) newDeck.mainboard.splice(idx, 1);
        return newDeck;
      }
      // Look in sideboard
      idx = newDeck.sideboard.findIndex(c => c.name === cardName);
      if (idx !== -1) {
        newDeck.sideboard[idx] = { ...newDeck.sideboard[idx], qty: newDeck.sideboard[idx].qty + delta };
        if (newDeck.sideboard[idx].qty <= 0) newDeck.sideboard.splice(idx, 1);
        return newDeck;
      }
      return prevDeck;
    });
  };

  const groups = {};
  const order = ["Creature", "Planeswalker", "Land", "Battle", "Instant", "Sorcery", "Enchantment", "Artifact", "Other"];
  deck.mainboard.forEach(card => {
    const tl = card.cardData?.type_line || "";
    let g = "Other";
    for (const x of order) if (tl.includes(x)) { g = x; break; }
    (groups[g] = groups[g] || []).push(card);
  });

  const copyDeck = () => { navigator.clipboard?.writeText(deckToText(deck)); };

  const handleHover = (img, name) => {
    onHover(img);
    setActiveCard(name);
  };

  const handleIdentifySynergies = async () => {
    setIsIdentifyingSynergies(true);
    const res = await aiIdentifySynergies(deck, loadProviderConfig());
    if (res) setSynergyMap(res);
    setIsIdentifyingSynergies(false);
  };

  const handleAnalyzeMeta = async () => {
    setIsAnalyzingMeta(true);
    setMetaStatus("Fetching current meta...");
    const format = totalM >= 90 ? "Commander" : "Standard";
    const cfg = loadProviderConfig();
    const meta = await fetchMetaDecks(format, cfg, (s) => setMetaStatus(s));
    if (meta.decks && meta.decks.length > 0) {
      setMetaStatus("Analyzing matchups...");
      const result = await aiAnalyzeMatchups(deck, meta.decks, cfg, (s) => setMetaStatus(s));
      if (result) setMetaData(result);
    }
    setIsAnalyzingMeta(false);
    setMetaStatus("");
  };

  const handleSuggest = async (cardName) => {
    setIsSuggesting(true);
    setSuggestTarget(cardName);
    const cfg = loadProviderConfig();
    const res = await aiSuggestReplacement(deck, cardName, cfg);
    if (res) setRecommendations(res);
    setIsSuggesting(false);
  };

  const activeSynergies = activeCard && synergyMap ? synergyMap.synergies.filter(s => s.cards.includes(activeCard)) : [];

  return (
    <div className={listHeight === "none" ? "" : "glass-panel"} style={{ ...(listHeight === "none" ? {} : GLASS_STYLE), padding: compact ? 10 : 14, animation: "fadeIn 0.4s ease", height: listHeight === "none" ? "auto" : undefined, overflow: listHeight === "none" ? "visible" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {[
            { l: "Cards", v: totalM, warn: totalM > 4, color: "#c9a84c", sub: `/ ${totalM >= 90 ? "100" : "60"}` },
            { l: "Lands", v: lands, warn: totalM >= 4 && lands < 2, color: "#8B7355" },
            { l: "Avg CMC", v: avg, color: "#4DA3D4" },
            { l: "Price", v: `$${totalPrice.toFixed(0)}`, color: "#4DB87A" },
          ].map(({ l, v, warn, color, sub }) => (
            <div key={l} style={{
              padding: "5px 12px", background: "rgba(0,0,0,0.35)", borderRadius: 8,
              border: `1px solid ${warn ? "#E05A5055" : "rgba(255,255,255,0.04)"}`,
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)", transition: "all 0.25s cubic-bezier(0.19,1,0.22,1)",
            }}
              onMouseOver={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.borderColor = warn ? "#E05A5077" : "rgba(255,255,255,0.08)"; }}
              onMouseOut={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = warn ? "#E05A5055" : "rgba(255,255,255,0.04)"; }}
            >
              <div style={{ fontSize: 8, color: "#555", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2, fontFamily: "'Cinzel', serif" }}>{l}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 14, color: warn ? "#E05A50" : color, fontFamily: "'Cinzel', serif", fontWeight: 700 }}>{v}</span>
                {sub && <span style={{ fontSize: 8, color: "#444" }}>{sub}</span>}
                {l === "Price" && costToComplete > 0 && (
                  <span style={{ fontSize: 8, color: "#E05A50", background: "#E05A5010", padding: "1px 5px", borderRadius: 4, fontWeight: 600, fontFamily: "'Cinzel', serif" }}>−${costToComplete.toFixed(0)}</span>
                )}
              </div>
            </div>
          ))}
          {totalM >= 4 && lands === 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#E05A5010", borderRadius: 6, border: "1px solid #E05A5033" }}>
              <span style={{ fontSize: 10, color: "#E05A50", fontWeight: 700 }}>⚠ NO LANDS</span>
            </div>
          )}
        </div>
        {!compact && (
          <div style={{ display: "flex", background: "rgba(0,0,0,0.3)", borderRadius: 7, padding: 2, border: "1px solid rgba(255,255,255,0.04)" }}>
            {[["list", "≡"], ["mosaic", "⊞"], ["stack", "☰"]].map(([mode, icon]) => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                padding: "5px 10px", border: "none", borderRadius: 5,
                background: viewMode === mode ? "rgba(201,168,76,0.12)" : "transparent",
                color: viewMode === mode ? "#c9a84c" : "#444", fontSize: 11, cursor: "pointer",
                fontFamily: "'Cinzel', serif", transition: "all 0.2s",
              }}
                onMouseOver={e => { if (viewMode !== mode) e.currentTarget.style.color = "#666"; }}
                onMouseOut={e => { if (viewMode !== mode) e.currentTarget.style.color = "#444"; }}
              >{icon}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 240px", gap: 20, alignItems: "start" }}>
        <div style={{ maxHeight: listHeight || (compact ? 300 : "75vh"), overflowY: listHeight === "none" ? "visible" : "auto", paddingRight: 4 }}>
          {viewMode === "mosaic" ? (
            <MosaicView deck={deck} onHover={handleHover} synergyMap={synergyMap} activeCard={activeCard} />
          ) : viewMode === "stack" ? (
            <StackView deck={deck} onHover={handleHover} synergyMap={synergyMap} activeCard={activeCard} />
          ) : (
            <>
              {order.map(g => groups[g] && (
                <div key={g} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, marginBottom: 4, borderBottom: "1px solid #1a1a1a33", paddingBottom: 2, fontFamily: "'Cinzel', serif" }}>
                    {g}s ({groups[g].reduce((a, c) => a + c.qty, 0)})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {groups[g].map((c, i) => {
                      const isRelated = activeCard && synergyMap && synergyMap.synergies.some(s => s.cards.includes(activeCard) && s.cards.includes(c.name));
                      return <CardRow key={i} card={c} onHover={handleHover} isEditMode={isEditMode} onUpdateQty={handleUpdateQty} synergyHighlight={isRelated} onSuggest={handleSuggest} inventory={inventory} onUpdateInventory={onUpdateInventory} onCtx={onCtx} />;
                    })}
                  </div>
                </div>
              ))}
                {deck.sideboard.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, margin: "12px 0 6px", fontFamily: "'Cinzel', serif" }}>SIDEBOARD ({totalS})</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        {deck.sideboard.map((c, i) => <CardRow key={i} card={c} onHover={onHover} isEditMode={isEditMode} onUpdateQty={handleUpdateQty} inventory={inventory} onUpdateInventory={onUpdateInventory} onCtx={onCtx} />)}
                    </div>
                  </>
                )}
            </>
          )}
        </div>

        {!compact && <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ padding: "10px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 8, color: "#c9a84c77", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>MANA CURVE</div>
            <CurveChart data={curve} />
          </div>
          <div style={{ padding: "10px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 8, color: "#c9a84c77", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>CARD TYPES</div>
            <TypeBars data={types} />
          </div>
          <div style={{ padding: "10px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 8, color: "#c9a84c77", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>MANA BASE</div>
            <ManaAnalytics data={manaInfo} onAutoFix={handleAutoFixLands} />
          </div>
        </div>}
      </div>

      {sbGuide && <SideboardGuide guide={sbGuide} onClear={() => setSbGuide(null)} />}
      {goldfishData && <GoldfishStats data={goldfishData} onClear={() => setGoldfishData(null)} />}
      {budgetSuggestions && <BudgetSuggestions data={budgetSuggestions} onClear={() => setBudgetSuggestions(null)} />}
      {metaData && <MetaStats data={metaData} onClear={() => setMetaData(null)} />}
      {recommendations && <RecommendationStats data={recommendations} targetCard={suggestTarget} onClear={() => { setRecommendations(null); setSuggestTarget(""); }} />}

      {activeSynergies.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, background: "rgba(201, 168, 76, 0.05)", border: "1px solid #c9a84c33", borderRadius: 8, animation: "fadeIn 0.2s ease" }}>
          <div style={{ fontSize: 9, color: "#c9a84c", letterSpacing: 1, marginBottom: 6, fontWeight: 700 }}>ACTIVE SYNERGIES</div>
          {activeSynergies.map((s, i) => (
            <div key={i} style={{ fontSize: 11, color: "#aaa", marginBottom: i === activeSynergies.length - 1 ? 0 : 8, lineHeight: 1.4 }}>
              <span style={{ color: "#c9a84c", fontWeight: 700 }}>{s.cards.join(" + ")}:</span> {s.description}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.03)", paddingTop: 12, position: "relative", flexWrap: "wrap", alignItems: "center" }}>
        {/* Core Actions */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "2px 4px", background: "rgba(0,0,0,0.15)", borderRadius: 8 }}>
          {onSave && (
            <button onClick={() => onSave(deck)} style={{ ...xBtn, background: "linear-gradient(135deg, #0f1f0f, #0a140a)", borderColor: "#4DB87A22", color: "#4DB87A", borderRadius: 6, transition: "all 0.25s" }}
              onMouseOver={e => { e.currentTarget.style.borderColor = "#4DB87A44"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(77,184,122,0.1)"; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = "#4DB87A22"; e.currentTarget.style.boxShadow = "none"; }}
            >
              💾 Save
            </button>
          )}
          <button onClick={() => setIsEditMode(!isEditMode)} style={{ ...xBtn, background: isEditMode ? "#E05A5008" : "rgba(0,0,0,0.3)", borderColor: isEditMode ? "#E05A5044" : "rgba(255,255,255,0.05)", color: isEditMode ? "#E05A50" : "#666", borderRadius: 6, transition: "all 0.25s" }}>
            ✏️ {isEditMode ? "Done" : "Edit"}
          </button>

          <div style={{ position: "relative" }}>
            <button onClick={() => setExportMode(exportMode ? null : "menu")} style={{ ...xBtn, background: exportMode ? "#1a1a1a" : "rgba(0,0,0,0.3)", borderRadius: 6 }}>
              📤 Export
            </button>

            {exportMode === "menu" && (
              <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 8, background: "rgba(14,14,14,0.98)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 6, display: "flex", flexDirection: "column", gap: 2, width: 160, zIndex: 50, animation: "slideUp 0.2s ease", boxShadow: "0 16px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,0,0,0.5)" }}>
                <button
                  onClick={() => { navigator.clipboard?.writeText(exportDeck(deck, "text")); setExportMode(null); }}
                  style={{ ...xBtn, textAlign: "left", padding: "8px 12px", border: "none", background: "transparent", color: "#ccc", borderRadius: 6 }}
                  onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#fff"; }} onMouseOut={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ccc"; }}
                >📋 Copy Text List</button>
                <button
                  onClick={() => { navigator.clipboard?.writeText(exportDeck(deck, "arena")); setExportMode(null); }}
                  style={{ ...xBtn, textAlign: "left", padding: "8px 12px", border: "none", background: "transparent", color: "#4DA3D4", borderRadius: 6 }}
                  onMouseOver={e => { e.currentTarget.style.background = "rgba(77,163,212,0.06)"; }} onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}
                >🎮 Copy for MTGA</button>
                <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "2px 6px" }} />
                <button
                  onClick={() => {
                    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([exportDeck(deck, "text")], { type: "text/plain" })); a.download = "deck.txt"; a.click(); setExportMode(null);
                  }}
                  style={{ ...xBtn, textAlign: "left", padding: "8px 12px", border: "none", background: "transparent", color: "#ccc", borderRadius: 6 }}
                  onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#fff"; }} onMouseOut={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ccc"; }}
                >💾 Download .txt</button>
              </div>
            )}
          </div>
        </div>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.04)", margin: "0 2px", flexShrink: 0 }} />

        {/* AI Analysis Actions */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "2px 4px", background: "rgba(0,0,0,0.15)", borderRadius: 8 }}>
          {onGenerateGuide && !sbGuide && (
            <button
              onClick={async () => {
                setIsGeneratingGuide(true);
                const res = await onGenerateGuide(deck);
                if (res) setSbGuide(res);
                setIsGeneratingGuide(false);
              }}
              disabled={isGeneratingGuide}
              style={{ ...xBtn, background: "linear-gradient(135deg, #182a2a, #101818)", borderColor: "#4DA3D433", color: "#4DA3D4", borderRadius: 6 }}
            >
              {isGeneratingGuide ? "⏳ Generating..." : "📑 SB Guide"}
            </button>
          )}

          <button
            onClick={() => {
              setIsSimulating(true);
              setTimeout(() => {
                const res = runGoldfishSim(deck.mainboard);
                setGoldfishData(res);
                setIsSimulating(false);
              }, 600);
            }}
            disabled={isSimulating}
            style={{ ...xBtn, background: goldfishData ? "#c9a84c11" : "rgba(0,0,0,0.3)", color: goldfishData ? "#c9a84c" : "#777", borderRadius: 6 }}
          >
            {isSimulating ? "⏳..." : "📊 Stats"}
          </button>

          {onBudgetize && (
            <button
              onClick={async () => {
                setIsBudgetizing(true);
                const res = await onBudgetize(deck, totalPrice > 100 ? "budget" : "power");
                if (res) setBudgetSuggestions(res);
                setIsBudgetizing(false);
              }}
              disabled={isBudgetizing}
              style={{ ...xBtn, color: "#4DB87A", borderColor: "#4DB87A33", borderRadius: 6 }}
            >
              {isBudgetizing ? "⏳..." : totalPrice > 100 ? "💸 Budget" : "🚀 Power"}
            </button>
          )}

          <button
            onClick={handleAnalyzeMeta}
            disabled={isAnalyzingMeta}
            style={{ ...xBtn, background: metaData ? "rgba(77, 163, 212, 0.1)" : "rgba(0,0,0,0.3)", color: metaData ? "#4DA3D4" : "#777", borderColor: metaData ? "#4DA3D433" : "rgba(255,255,255,0.05)", borderRadius: 6 }}
          >
            {isAnalyzingMeta ? `⏳ ${metaStatus || "..."}` : "📈 Meta"}
          </button>

          <button
            onClick={handleIdentifySynergies}
            disabled={isIdentifyingSynergies}
            style={{ ...xBtn, background: synergyMap ? "rgba(201, 168, 76, 0.1)" : "rgba(0,0,0,0.3)", color: synergyMap ? "#c9a84c" : "#777", borderColor: synergyMap ? "#c9a84c33" : "rgba(255,255,255,0.05)", borderRadius: 6 }}
          >
            {isIdentifyingSynergies ? "⏳..." : "🧩 Synergy"}
          </button>
        </div>

        <div style={{ flex: 1 }} />
        <button onClick={() => {
          const arr = generateDeckArray(deck.mainboard);
          const shuffled = shuffleArray(arr);
          setTestHand(drawHand(shuffled, 7));
          setTestDeck(shuffled.slice(7));
          setMullCount(0);
        }} style={{ ...xBtn, background: "linear-gradient(135deg, #2a2218, #181210)", borderColor: "#c9a84c33", color: "#c9a84c", borderRadius: 8, padding: "6px 14px", transition: "all 0.25s", boxShadow: "0 2px 8px rgba(201,168,76,0.05)" }}
          onMouseOver={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(201,168,76,0.15)"; e.currentTarget.style.borderColor = "#c9a84c55"; }}
          onMouseOut={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(201,168,76,0.05)"; e.currentTarget.style.borderColor = "#c9a84c33"; }}
        >
          🃏 Test Hand
        </button>
      </div>

      {/* Test Hand Overlay */}
      {testHand && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.9)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", zIndex: 1000,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          animation: "fadeIn 0.25s ease"
        }}>
          <div style={{ marginBottom: 36, textAlign: "center" }}>
            <h2 style={{ fontFamily: "'Cinzel', serif", color: "#c9a84c", fontSize: 20, letterSpacing: 3, marginBottom: 4 }}>🃏 TEST HAND</h2>
            {mullCount > 0 && <div style={{ color: "#E05A50", fontSize: 12, marginTop: 6, fontFamily: "'Crimson Text', serif" }}>Mulligan to {7 - mullCount} cards</div>}
          </div>

          <div style={{ display: "flex", gap: -40, flexWrap: "wrap", justifyContent: "center", maxWidth: "90%", perspective: 1200 }}>
            {testHand.map((card, i) => {
              const img = card.cardData?.image_uris?.normal || card.cardData?.card_faces?.[0]?.image_uris?.normal;
              const fan = (i - testHand.length / 2) * 3;
              return (
                <div key={card._uid || i} style={{
                  margin: "0 -18px",
                  transition: "transform 0.3s cubic-bezier(0.19,1,0.22,1)",
                  cursor: "pointer",
                  animation: `slideUp 0.5s ease ${i * 0.08}s both`,
                  transform: `rotateZ(${fan}deg)`,
                }}
                  onMouseOver={e => e.currentTarget.style.transform = "translateY(-24px) scale(1.08) rotateZ(0deg)"}
                  onMouseOut={e => e.currentTarget.style.transform = `translateY(0) scale(1) rotateZ(${fan}deg)`}
                >
                  {img ? (
                    <img src={img} alt={card.name} style={{ width: 200, borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.06)" }} />
                  ) : (
                    <div style={{ width: 200, height: 280, background: "#111", border: "1px solid #2a2a2a", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center", fontSize: 11, color: "#666" }}>
                      {card.name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 48 }}>
            <button onClick={() => {
              const newMull = mullCount + 1;
              if (newMull >= 7) return;
              const arr = generateDeckArray(deck.mainboard);
              const shuffled = shuffleArray(arr);
              setTestHand(drawHand(shuffled, 7 - newMull));
              setTestDeck(shuffled.slice(7 - newMull));
              setMullCount(newMull);
            }} style={{ ...xBtn, background: "rgba(255,255,255,0.04)", padding: "10px 24px", fontSize: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", transition: "all 0.25s" }} disabled={mullCount >= 6}
              onMouseOver={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
              onMouseOut={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
            >
              ♻️ Mulligan
            </button>
            <button onClick={() => {
              const arr = generateDeckArray(deck.mainboard);
              const shuffled = shuffleArray(arr);
              setTestHand(drawHand(shuffled, 7));
              setTestDeck(shuffled.slice(7));
              setMullCount(0);
            }} style={{ ...xBtn, background: "rgba(201,168,76,0.08)", padding: "10px 24px", fontSize: 12, borderRadius: 10, border: "1px solid #c9a84c22", color: "#c9a84c", transition: "all 0.25s" }}
              onMouseOver={e => { e.currentTarget.style.background = "rgba(201,168,76,0.15)"; e.currentTarget.style.borderColor = "#c9a84c44"; }}
              onMouseOut={e => { e.currentTarget.style.background = "rgba(201,168,76,0.08)"; e.currentTarget.style.borderColor = "#c9a84c22"; }}
            >
              🃏 New Hand
            </button>
            <button onClick={() => setTestHand(null)} style={{ ...xBtn, background: "rgba(224,90,80,0.08)", borderColor: "#E05A5033", color: "#E05A50", padding: "10px 24px", fontSize: 12, borderRadius: 10, transition: "all 0.25s" }}
              onMouseOver={e => { e.currentTarget.style.background = "rgba(224,90,80,0.15)"; e.currentTarget.style.borderColor = "#E05A5055"; }}
              onMouseOut={e => { e.currentTarget.style.background = "rgba(224,90,80,0.08)"; e.currentTarget.style.borderColor = "#E05A5033"; }}
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// AGENT CHAT MESSAGE
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// AGENT CHAT MESSAGE
// ═══════════════════════════════════════════════════════════

function AgentMessage({ msg, onHover, onSaveDeck, onCtx }) {
  if (msg.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16, animation: "slideUp 0.3s ease" }}>
        <div style={{
          maxWidth: "75%", padding: "10px 16px", borderRadius: "14px 14px 4px 14px",
          background: "linear-gradient(135deg, #18140e, #14100a)", border: "1px solid #2a221688",
          color: "#d4ccb0", fontSize: 13, fontFamily: "'Crimson Text', serif", lineHeight: 1.65, whiteSpace: "pre-wrap",
          boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20, animation: "slideUp 0.35s ease" }}>
      <div style={{
        width: 28, height: 28, borderRadius: 9, flexShrink: 0,
        background: "linear-gradient(135deg, #c9a84c, #8a6d2f)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, color: "#0a0a0a", fontWeight: 700, fontFamily: "'Cinzel', serif", marginTop: 2,
        boxShadow: "0 2px 8px rgba(201,168,76,0.15)",
      }}>✦</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {msg.searches && msg.searches.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
            {msg.searches.map((s, i) => (
              <span key={i} style={{ fontSize: 9, color: "#666", padding: "3px 8px", background: "rgba(0,0,0,0.3)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.04)" }}>🔍 {s}</span>
            ))}
          </div>
        )}
        {msg.loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(201,168,76,0.02)", borderRadius: 12, border: "1px solid rgba(201,168,76,0.06)", animation: "fadeIn 0.5s ease" }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: "50%", background: "#c9a84c",
                  animation: `typingDot 1.4s ease-in-out ${i * 0.16}s infinite`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 11, color: "#777", fontStyle: "italic", letterSpacing: 0.3, fontFamily: "'Crimson Text', serif" }}>{msg.status || "Channeling the Arcanum..."}</span>
          </div>
        )}
        {msg.content && (
          <div style={{ color: "#b0b0b0", fontSize: 13, fontFamily: "'Crimson Text', serif", lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {msg.content}
          </div>
        )}
        {msg.deck && <div style={{ marginTop: 14 }}><DeckDisplay deck={msg.deck} onHover={onHover} onSave={onSaveDeck} onGenerateGuide={msg.onGenerateGuide} onCtx={onCtx} /></div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// AI AGENT — PRIMARY FEATURE
// ═══════════════════════════════════════════════════════════



function AIAgent({ onSaveDeck, providerCfg, inventory, onUpdateInventory, onCtx }) {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem("arcanum_chat_messages");
    return saved ? JSON.parse(saved) : [];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const historyRef = useRef([]);

  useEffect(() => {
    const savedMsg = localStorage.getItem("arcanum_chat_messages");
    if (savedMsg) setMessages(JSON.parse(savedMsg));

    const savedHist = localStorage.getItem("arcanum_chat_history");
    if (savedHist) historyRef.current = JSON.parse(savedHist);
  }, []);

  useEffect(() => {
    localStorage.setItem("arcanum_chat_messages", JSON.stringify(messages));
    localStorage.setItem("arcanum_chat_history", JSON.stringify(historyRef.current));
  }, [messages]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleGenerateGuide = (deck) => aiGenerateGuide(deck, providerCfg);
  const handleBudgetize = (deck, mode) => aiBudgetize(deck, providerCfg, mode);

  const resetChat = () => {
    if (!window.confirm("Are you sure you want to clear the chat history?")) return;
    setMessages([]);
    historyRef.current = [];
    localStorage.removeItem("arcanum_chat_messages");
    localStorage.removeItem("arcanum_chat_history");
  };

  const send = async (inputText) => {
    if (!inputText.trim() || busy) return;
    setMessages(prev => [...prev, { role: "user", content: inputText.trim() }]);
    setInput(""); setBusy(true);
    const lid = Date.now();
    setMessages(prev => [...prev, { role: "assistant", loading: true, status: "Analyzing the format and searching for optimal strategies...", _id: lid }]);
    const updateStatus = (s) => setMessages(prev => prev.map(m => m._id === lid ? { ...m, status: s } : m));

    try {
      historyRef.current.push({ role: "user", content: inputText.trim() });
      updateStatus("Consulting card database and metagame data...");
      let resp;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          updateStatus(`Transient error — retrying in ${3 * Math.pow(2, attempt)}s...`);
          await new Promise(r => setTimeout(r, 3000 * Math.pow(2, attempt)));
        }

        // Context Optimization: Keep only the last 15 messages to prevent payload bloat
        const optimizedHistory = historyRef.current.slice(-15);

        resp = await fetch("/api/chat", {
          method: "POST", headers: getApiHeaders(providerCfg),
          body: JSON.stringify({
            max_tokens: 8000,
            system: AGENT_SYSTEM,
            messages: optimizedHistory
          }),
        });
        if (![429, 502, 503, 504].includes(resp.status)) break;
      }

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API ${resp.status}`);
      }
      let data = await resp.json();

      let finalData = data;
      let allContent = [...(data.content || [])];
      let loopCount = 0;

      while (finalData.stop_reason === "tool_use" && loopCount < 5) {
        loopCount++;
        const toolUses = finalData.content.filter(b => b.type === "tool_use");
        const searches = toolUses.filter(t => t.name === "web_search").map(t => t.input?.query || "");
        if (searches.length) {
          updateStatus(`Searching: ${searches.join(", ")}...`);
        }

        historyRef.current.push({ role: "assistant", content: finalData.content });

        const toolResults = await Promise.all(toolUses.map(async tu => {
          if (tu.name === "web_search") {
            try {
              const searchRes = await fetch("/api/search", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Tavily-Key": providerCfg.tavilyKey || "" },
                body: JSON.stringify({ query: tu.input.query })
              });
              const searchData = await searchRes.json();
              if (!searchRes.ok) throw new Error(searchData.error || "Search failed");
              return { type: "tool_result", tool_use_id: tu.id, content: searchData.content };
            } catch (err) {
              return { type: "tool_result", tool_use_id: tu.id, content: `Search Error: ${err.message}` };
            }
          }
          return { type: "tool_result", tool_use_id: tu.id, content: "Tool not found." };
        }));

        historyRef.current.push({ role: "user", content: toolResults });

        updateStatus("Processing search results and building strategy...");

        const contResp = await fetch("/api/chat", {
          method: "POST", headers: getApiHeaders(providerCfg),
          body: JSON.stringify({
            max_tokens: 8000,
            system: AGENT_SYSTEM,
            tools: [{
              name: "web_search",
              description: "Search the web for the latest MTG metagame, tournament results, and deck prices.",
              input_schema: {
                type: "object",
                properties: {
                  query: { type: "string", description: "The search query." }
                },
                required: ["query"]
              }
            }],
            messages: historyRef.current,
          }),
        });

        if (!contResp.ok) {
          const errorData = await contResp.json().catch(() => ({}));
          console.error("Tool continuation error:", errorData);
          break;
        }
        finalData = await contResp.json();
        allContent = [...allContent, ...(finalData.content || [])];
      }

      let fullText = allContent.map(b => b.text || "").join("\n");
      historyRef.current.push({ role: "assistant", content: fullText });
      let deckObj = null, displayText = fullText;
      const decklistText = fullText;

      if (hasDeck(decklistText)) {
        updateStatus("Identifying card types and technical specs...");
        const parsed = parseDecklist(decklistText);

        // Show the parsed deck immediately (with AI-generated types/costs)
        setMessages(prev => prev.map(m => m._id === lid ? { ...m, content: fullText.replace(/===[\s\S]*?===/g, "").trim(), deck: parsed, onGenerateGuide: handleGenerateGuide } : m));

        updateStatus("Fetching high-res card art...");
        const enriched = await aiEnrichDeck(parsed, updateStatus);

        // Update with enriched data (including images)
        setMessages(prev => prev.map(m => m._id === lid ? { ...m, loading: false, deck: enriched } : m));
      } else {
        setMessages(prev => prev.map(m => m._id === lid ? { ...m, loading: false, content: fullText } : m));
      }
    } catch (err) {
      console.error(err);
      const errorMsg = err.message.includes("502")
        ? "The Weaver's connection flickered (502). The Arcanum is briefly unstable—please try sending your request again."
        : `Something went wrong: ${err.message}. Try again.`;
      setMessages(prev => prev.map(m => m._id === lid ? { role: "assistant", content: errorMsg } : m));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-panel" style={{ ...GLASS_STYLE, display: "flex", flexDirection: "column", height: "calc(100vh - 110px)", position: "relative", padding: "0 16px" }}>
      {messages.length > 0 && (
        <div style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>
          <button onClick={resetChat} style={{ ...xBtn, fontSize: 9, background: "#0d0d0dcc", backdropFilter: "blur(4px)", padding: "4px 8px", opacity: 0.8 }} onMouseOver={e => e.currentTarget.style.opacity = 1} onMouseOut={e => e.currentTarget.style.opacity = 0.8}>
            ↺ Reset Chat
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 0" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 16px 36px", animation: "fadeIn 0.6s ease" }}>
            <div style={{ width: 72, height: 72, borderRadius: 18, margin: "0 auto 20px", background: "linear-gradient(135deg, #c9a84c15, #c9a84c05)", border: "1px solid #c9a84c18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, animation: "breathe 4s ease-in-out infinite" }}>✦</div>
            <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#c9a84c", marginBottom: 8, letterSpacing: 3, background: "linear-gradient(135deg, #c9a84c, #f0d68a)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>ARCANUM AGENT</h2>
            <p style={{ fontFamily: "'Crimson Text', serif", color: "#555", fontSize: 14, maxWidth: 500, margin: "0 auto 32px", lineHeight: 1.7 }}>
              Build competitive decks, discover hidden combos, optimize every slot. Your AI-powered deck architect with knowledge of 25,000+ cards.
            </p>
            <div style={{ marginBottom: 32 }}>
              <button
                onClick={() => setImportModalOpen(true)}
                style={{ ...xBtn, background: "linear-gradient(135deg, #0f1a1f, #0a1214)", borderColor: "#4DA3D422", color: "#4DA3D4", padding: "12px 24px", fontSize: 12, borderRadius: 10, transition: "all 0.3s" }}
                onMouseOver={e => { e.currentTarget.style.borderColor = "#4DA3D444"; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(77,163,212,0.1)"; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = "#4DA3D422"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                📥 Import & Analyze Deck
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 600, margin: "0 auto" }}>
              {QUICK_PROMPTS.map((qp, i) => (
                <button key={i} onClick={() => send(qp.prompt)} style={{
                  padding: "14px 16px", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.04)",
                  borderRadius: 12, cursor: "pointer", textAlign: "left", transition: "all 0.3s cubic-bezier(0.19,1,0.22,1)",
                  animation: `cardEntrance 0.4s ease ${i * 0.06}s both`,
                  position: "relative", overflow: "hidden",
                }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = "#c9a84c33"; e.currentTarget.style.background = "rgba(201,168,76,0.05)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(201,168,76,0.06)"; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)"; e.currentTarget.style.background = "rgba(0,0,0,0.25)"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#c9a84c", letterSpacing: 1, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>{qp.label}</div>
                  <div style={{ fontSize: 10, color: "#444", fontFamily: "'Crimson Text', serif", lineHeight: 1.6 }}>{qp.prompt.substring(0, 85)}...</div>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, rgba(201,168,76,0.15), transparent)", opacity: 0 , transition: "opacity 0.3s" }} />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => <AgentMessage key={i} msg={msg} onHover={setHoveredCard} onSaveDeck={onSaveDeck} onCtx={onCtx} />)}
        <div ref={chatEndRef} />
      </div>
      {hoveredCard && <div className="card-preview-enter" style={{ position: "fixed", right: 20, top: 90, zIndex: 200, pointerEvents: "none" }}>
        <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06), 0 0 30px rgba(201,168,76,0.08)" }}>
          <img src={hoveredCard} alt="" style={{ width: 265, display: "block", borderRadius: 14 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #c9a84c44, #c9a84c, #c9a84c44)", animation: "shimmer 3s ease infinite", backgroundSize: "200% 100%" }} />
        </div>
      </div>}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.03)", padding: "12px 0 4px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "rgba(0,0,0,0.3)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.05)", padding: "10px 12px", transition: "border-color 0.3s, box-shadow 0.3s" }}
          onFocus={e => { e.currentTarget.style.borderColor = "#c9a84c22"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(201,168,76,0.04)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.boxShadow = "none"; }}
        >
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} disabled={busy}
            placeholder={busy ? "Agent is working..." : "Build me the best deck in Modern... / Find a combo that kills on turn 3..."}
            rows={1} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#ccc", fontSize: 13, fontFamily: "'Crimson Text', serif", resize: "none", lineHeight: 1.6, minHeight: 24, maxHeight: 120 }}
            onInput={e => { e.target.style.height = "24px"; e.target.style.height = e.target.scrollHeight + "px"; }} />
          <button onClick={() => send(input)} disabled={!input.trim() || busy} style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: input.trim() && !busy ? "linear-gradient(135deg, #c9a84c, #a07c2e)" : "rgba(255,255,255,0.03)",
            border: "none", cursor: input.trim() && !busy ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, color: input.trim() && !busy ? "#0a0a0a" : "#333", fontWeight: 700,
            transition: "all 0.25s cubic-bezier(0.19,1,0.22,1)",
            boxShadow: input.trim() && !busy ? "0 2px 10px rgba(201,168,76,0.2)" : "none",
          }}
            onMouseOver={e => { if (input.trim() && !busy) e.currentTarget.style.transform = "scale(1.05)"; }}
            onMouseOut={e => e.currentTarget.style.transform = "scale(1)"}
          >↑</button>
        </div>
      </div>

      {/* Import Modal */}
      {importModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setImportModalOpen(false)}>
          <div style={{ background: "#0d0d0d", border: "1px solid #4DA3D433", borderRadius: 12, padding: 24, width: 480, maxWidth: "90%" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#4DA3D4", marginBottom: 16, letterSpacing: 2 }}>📥 IMPORT DECK FOR ANALYSIS</h3>
            <p style={{ fontSize: 12, color: "#aaa", fontFamily: "'Crimson Text', serif", marginBottom: 12 }}>Paste your decklist below (Arena, MTGO, or plaintext format). Arcanum will analyze it, identify weaknesses, and suggest competitive upgrades.</p>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="4 Ragavan, Nimble Pilferer&#10;4 Lightning Bolt&#10;..."
              style={{ width: "100%", height: 200, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 6, padding: "12px", color: "#ddd", fontSize: 13, fontFamily: "'Crimson Text', serif", resize: "none", marginBottom: 16 }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setImportModalOpen(false)} style={xBtn}>Cancel</button>
              <button
                onClick={() => {
                  if (!importText.trim()) return;
                  send(IMPORT_ANALYSIS_PROMPT + importText);
                  setImportText("");
                  setImportModalOpen(false);
                }}
                disabled={!importText.trim()}
                style={{ ...xBtn, background: importText.trim() ? "#4DA3D415" : "#1a1a1a", color: importText.trim() ? "#4DA3D4" : "#555", borderColor: importText.trim() ? "#4DA3D444" : "#1a1a1a" }}
              >
                ✦ Analyze Deck
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// GUIDED BUILDER (compact — unchanged)
// ═══════════════════════════════════════════════════════════

function GuidedBuilder({ onSaveDeck, providerCfg, inventory, onUpdateInventory, onCtx }) {
  const [cfg, setCfg] = useState({ format: "modern", colors: [], arch: "midrange", strat: "", meta: "", cmdr: "", budget: false });
  const [phase, setPhase] = useState("cfg");
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState([]);
  const [deck, setDeck] = useState(null);
  const [err, setErr] = useState(null);
  const [hov, setHov] = useState(null);
  const logRef = useRef(null);
  const handleGenerateGuide = (deck) => aiGenerateGuide(deck, providerCfg);
  const handleBudgetize = (deck, mode) => aiBudgetize(deck, providerCfg, mode);

  const build = async () => {
    setPhase("build"); setErr(null); setLogs([]);
    const fmt = FORMATS.find(f => f.id === cfg.format);
    try {
      setStatus("Querying Scryfall..."); log(`Searching ${cfg.format} ${cfg.colors.join("/")||"C"} ${cfg.arch}...`);
      const qp = [`f:${cfg.format}`];
      if (cfg.colors.length) { qp.push(`id<=${cfg.colors.join("")}`); qp.push(`(${cfg.colors.map(c => `c:${c}`).join(" OR ")})`); }
      let cards = [], pg = 1, more = true;
      while (more && pg <= 5) { log(`Page ${pg}...`); const r = await sfSearch(qp.join(" "), pg); cards.push(...(r.data || [])); more = r.has_more; pg++; await new Promise(r => setTimeout(r, 120)); }
      log(`${cards.length} candidates`);
      // Fetch non-basic lands for the color identity
      if (cfg.colors.length) {
        log("Searching lands...");
        const lr = await sfSearch(`f:${cfg.format} t:land id<=${cfg.colors.join("")} -t:basic`, 1);
        cards.push(...(lr.data||[]).slice(0,40));
        // Also fetch fetch lands and shock lands specifically
        if (cfg.colors.length >= 2) {
          const lr2 = await sfSearch(`f:${cfg.format} t:land o:search (t:plains OR t:island OR t:swamp OR t:mountain OR t:forest) id<=${cfg.colors.join("")}`, 1);
          cards.push(...(lr2.data||[]).slice(0,15));
          await new Promise(r => setTimeout(r, 120));
        }
      } else {
        // Colorless: fetch utility lands
        log("Searching colorless lands...");
        const lr = await sfSearch(`f:${cfg.format} t:land id:c`, 1);
        cards.push(...(lr.data||[]).slice(0,30));
        await new Promise(r => setTimeout(r, 120));
      }
      // Always add basic lands to the pool
      const basicNames = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
      const colorBasics = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
      const relevantBasics = cfg.colors.length ? cfg.colors.map(c => colorBasics[c]).filter(Boolean) : basicNames;
      relevantBasics.forEach(name => {
        cards.push({ name, mana_cost: "", type_line: "Basic Land — " + name, oracle_text: `{T}: Add {${name === "Plains" ? "W" : name === "Island" ? "U" : name === "Swamp" ? "B" : name === "Mountain" ? "R" : "G"}}.`, cmc: 0 });
      });
      setStatus("AI constructing decklist..."); log("Sending to AI...");
      const tops = cards.slice(0,200).map(c => `${c.name} | ${c.mana_cost||""} | ${c.type_line} | ${(c.oracle_text||"").substring(0,100)}`).join("\n");
      const cn = cfg.colors.map(c => COLORS.find(x => x.id===c)?.name).join("/")||"Colorless";
      const buildBody = JSON.stringify({ max_tokens: 4096, system: `Build a tournament-competitive ${cfg.format} ${cfg.arch} deck in ${cn}. Deck size: EXACTLY ${fmt.deckSize} cards total.${fmt.sb?` Sideboard: EXACTLY ${fmt.sb} cards.`:""}

CRITICAL REQUIREMENTS:
1. The deck MUST include ALL card types: Creatures, Instants, Sorceries, Enchantments, Artifacts, Planeswalkers, AND Lands
2. For a 60-card deck: include 22-26 LANDS (fetch lands, shock lands, dual lands, fast lands, basics, utility lands)
3. For a 100-card deck: include 35-40 LANDS
4. Use the correct mana-fixing lands for the color combination (e.g., Godless Shrine + Marsh Flats for W/B, Steam Vents + Scalding Tarn for U/R)
5. Always include basic lands as fetch targets: Plains, Island, Swamp, Mountain, Forest
6. Count carefully: spells + lands = EXACTLY ${fmt.deckSize}
7. A decklist without lands is INCOMPLETE and INVALID

Use ===DECKLIST_START=== and ===DECKLIST_END=== markers. Group cards by type (Creatures, Instants, Sorceries, Enchantments, Artifacts, Planeswalkers, Lands). Then provide strategic analysis.`, messages: [{ role: "user", content: `Build it.${cfg.strat?` Strategy: ${cfg.strat}`:""}${cfg.meta?` Beat: ${cfg.meta}`:""}${cfg.cmdr?` Commander: ${cfg.cmdr}`:""}\n\nAvailable cards (use these AND any other legal cards including lands):\n${tops}` }] });
      let resp;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) { log(`Rate limited — retrying in ${3 * Math.pow(2, attempt)}s...`); await new Promise(r => setTimeout(r, 3000 * Math.pow(2, attempt))); }
        resp = await fetch("/api/chat", { method: "POST", headers: getApiHeaders(providerCfg), body: buildBody });
        if (resp.status !== 429) break;
      }
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json(); const text = data.content.map(b => b.text||"").join("\n");
      log("Parsing..."); const parsed = parseDecklist(text); log(`${parsed.mainboard.length}+${parsed.sideboard.length} entries`);
      setStatus("Loading card images...");
      const cache = {}; cards.forEach(c => cache[c.name.toLowerCase()] = c);
      for (const e of [...parsed.mainboard, ...parsed.sideboard]) {
        const k = e.name.toLowerCase();
        if (!cache[k]) { const cd = await sfNamed(e.name); if (cd) cache[k] = cd; await new Promise(r => setTimeout(r, 70)); }
      }
      const enrich = l => l.map(e => ({ ...e, cardData: cache[e.name.toLowerCase()]||null }));
      log("✓ Complete!");
      setDeck({ mainboard: enrich(parsed.mainboard), sideboard: enrich(parsed.sideboard), analysis: parsed.analysis, commander: parsed.commander });
      setPhase("done");
    } catch (e) { setErr(e.message); log(`ERROR: ${e.message}`); }
  };

  if (phase === "done" && deck) return (
    <div style={{ animation: "fadeIn 0.4s", padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#c9a84c" }}>
          {cfg.colors.map(c => COLORS.find(x=>x.id===c)?.sym).join("")} {ARCHETYPES.find(a=>a.id===cfg.arch)?.name}
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          {onSaveDeck && <button onClick={() => onSaveDeck(deck)} style={{ ...xBtn, color: "#c9a84c", borderColor: "#c9a84c33" }}>💎 Save to Vault</button>}
          <button onClick={() => {setPhase("cfg");setDeck(null);}} style={xBtn}>← Rebuild</button>
        </div>
      </div>
      <DeckDisplay deck={deck} onHover={setHov} onSave={onSaveDeck} onGenerateGuide={handleGenerateGuide} onBudgetize={handleBudgetize} onCtx={onCtx} />
      {hov && <div className="card-preview-enter" style={{ position: "fixed", right: 20, top: 90, zIndex: 1100, pointerEvents: "none" }}>
        <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06), 0 0 30px rgba(201,168,76,0.08)" }}>
          <img src={hov} alt="" style={{ width: 260, display: "block", borderRadius: 12 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #c9a84c44, #c9a84c, #c9a84c44)", animation: "shimmer 3s ease infinite", backgroundSize: "200% 100%" }} />
        </div>
      </div>}
      {deck.analysis && <div style={{ marginTop: 14, padding: 14, background: "#0d0d0d", borderRadius: 8, border: "1px solid #1a1a1a" }}>
        <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, marginBottom: 6, fontFamily: "'Cinzel', serif" }}>ANALYSIS</div>
        <div style={{ fontSize: 12, color: "#888", fontFamily: "'Crimson Text', serif", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{deck.analysis}</div>
      </div>}
    </div>
  );

  if (phase === "build") return (
    <div style={{ padding: "16px 0" }}>
      <div style={{ fontSize: 12, color: "#c9a84c", marginBottom: 10, fontStyle: "italic", animation: "pulse 2s infinite" }}>{status}</div>
      <div ref={logRef} style={{ background: "#080808", borderRadius: 6, padding: 10, maxHeight: 200, overflowY: "auto", fontFamily: "monospace", fontSize: 10 }}>
        {logs.map((l, i) => <div key={i} style={{ color: l.m.startsWith("✓")?"#4DB87A":l.m.startsWith("E")?"#E05A50":"#555", marginBottom: 1 }}>[{l.t}] {l.m}</div>)}
      </div>
      {err && <div style={{ marginTop: 8, color: "#E05A50", fontSize: 12 }}>{err} <button onClick={()=>setPhase("cfg")} style={{...xBtn,color:"#E05A50",borderColor:"#E05A5033",marginLeft:6}}>Back</button></div>}
    </div>
  );

  const sl = { fontSize: 10, color: "#c9a84c88", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" };
  const chip = (active) => ({ padding: "6px 12px", borderRadius: 5, border: `1px solid ${active?"#c9a84c44":"#1a1a1a"}`, cursor: "pointer", fontSize: 11, fontFamily: "'Cinzel', serif", background: active?"#c9a84c10":"#0d0d0d", color: active?"#c9a84c":"#666", transition: "all 0.2s" });
  const ta = { width: "100%", minHeight: 50, background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 5, padding: "8px 12px", color: "#999", fontSize: 11, fontFamily: "'Crimson Text', serif", resize: "vertical" };

  return (
    <div style={{ padding: "8px 0", animation: "fadeIn 0.4s" }}>
      <div style={{ marginBottom: 20 }}><div style={sl}>FORMAT</div><div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>{FORMATS.map(f=><button key={f.id} onClick={()=>setCfg(p=>({...p,format:f.id}))} style={chip(cfg.format===f.id)}>{f.name}</button>)}</div></div>
      <div style={{ marginBottom: 20 }}><div style={sl}>COLORS</div><div style={{ display:"flex",gap:8 }}>{COLORS.map(c=><button key={c.id} onClick={()=>setCfg(p=>({...p,colors:p.colors.includes(c.id)?p.colors.filter(x=>x!==c.id):[...p.colors,c.id]}))} style={{ width:40,height:40,borderRadius:"50%",border:cfg.colors.includes(c.id)?`2px solid ${c.hex}`:"2px solid #222",background:cfg.colors.includes(c.id)?`${c.hex}22`:"#0d0d0d",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",transform:cfg.colors.includes(c.id)?"scale(1.15)":"scale(1)" }}>{c.sym}</button>)}</div></div>
      <div style={{ marginBottom: 20 }}><div style={sl}>ARCHETYPE</div><div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>{ARCHETYPES.map(a=><button key={a.id} onClick={()=>setCfg(p=>({...p,arch:a.id}))} style={chip(cfg.arch===a.id)}>{a.icon} {a.name}</button>)}</div></div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16 }}>
        <div><div style={{fontSize:9,color:"#444",marginBottom:3}}>Strategy</div><textarea value={cfg.strat} onChange={e=>setCfg(p=>({...p,strat:e.target.value}))} placeholder="e.g. graveyard synergies..." style={ta}/></div>
        <div><div style={{fontSize:9,color:"#444",marginBottom:3}}>Beat these decks</div><textarea value={cfg.meta} onChange={e=>setCfg(p=>({...p,meta:e.target.value}))} placeholder="e.g. Burn, Tron..." style={ta}/></div>
      </div>
      <button onClick={build} style={{
        width:"100%", padding:"14px", border:"none", borderRadius:10, cursor:"pointer",
        fontFamily:"'Cinzel', serif", fontSize:13, fontWeight:700, color:"#0a0a0a", letterSpacing:3,
        background:"linear-gradient(135deg, #c9a84c, #f0d68a, #c9a84c)", backgroundSize: "200% 100%",
        boxShadow: "0 4px 20px rgba(201,168,76,0.2), inset 0 1px 0 rgba(255,255,255,0.2)",
        transition: "all 0.3s cubic-bezier(0.19,1,0.22,1)",
      }}
        onMouseOver={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(201,168,76,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"; }}
        onMouseOut={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(201,168,76,0.2), inset 0 1px 0 rgba(255,255,255,0.2)"; }}
      >
        ✦ CONSTRUCT ✦
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ARENA — Match Simulation Engine
// ═══════════════════════════════════════════════════════════



function Arena({ vault, setVault, providerCfg, inventory, onUpdateInventory, onCtx }) {
  const [selected, setSelected] = useState([]);
  const [bestOf, setBestOf] = useState(3);
  const [matchCount, setMatchCount] = useState(1);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [simLog, setSimLog] = useState([]);
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [postAnalysis, setPostAnalysis] = useState(null);
  const [analyzingPost, setAnalyzingPost] = useState(false);
  const [hov, setHov] = useState(null);
  const [viewDeck, setViewDeck] = useState(null);
  const logRef = useRef(null);

  useEffect(() => { logRef.current && (logRef.current.scrollTop = logRef.current.scrollHeight); }, [simLog]);

  const toggle = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 8 ? [...prev, id] : prev);
  };

  const deleteDeck = (id) => {
    const nv = vault.filter(d => d.id !== id);
    setVault(nv); saveVault(nv);
    setSelected(s => s.filter(x => x !== id));
  };

  const generatePairs = () => {
    const pairs = [];
    for (let i = 0; i < selected.length; i++)
      for (let j = i + 1; j < selected.length; j++)
        pairs.push([selected[i], selected[j]]);
    return pairs;
  };

  const runSimulation = async () => {
    if (selected.length < 2) return;
    setRunning(true); setResults(null); setPostAnalysis(null); setSimLog([]);

    const pairs = generatePairs();
    const allResults = [];
    const log = (m, type = "info") => setSimLog(p => [...p, { t: new Date().toLocaleTimeString(), m, type }]);

    log(`⚔ ARENA SIMULATION — ${pairs.length} matchup(s), Best of ${bestOf}, ${matchCount} match(es) each`);

    for (const [idA, idB] of pairs) {
      const deckA = vault.find(d => d.id === idA);
      const deckB = vault.find(d => d.id === idB);
      if (!deckA || !deckB) continue;

      const listA = deckToText(deckA.deck);
      const listB = deckToText(deckB.deck);

      for (let matchNum = 1; matchNum <= matchCount; matchNum++) {
        const matchLabel = matchCount > 1 ? ` (Match ${matchNum}/${matchCount})` : "";
        log(`\n⚔ ${deckA.name} vs ${deckB.name}${matchLabel}`, "match");

        try {
          const prompt = `Simulate a Best of ${bestOf} match of Magic: The Gathering between these two decks.

DECK A — "${deckA.name}":
${listA}

DECK B — "${deckB.name}":
${listB}

Simulate exactly ${bestOf === 1 ? "1 game" : `a Best-of-${bestOf} series (stop when one deck reaches ${Math.ceil(bestOf/2)} wins)`}. Use "Deck A" and "Deck B" as winner names. Consider sideboarding for games 2+. Be realistic with variance.`;

          // Retry with backoff on rate limits
          let resp, data, text;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) {
              const wait = 3000 * Math.pow(2, attempt);
              log(`  ⏳ Rate limited — retrying in ${wait/1000}s (attempt ${attempt+1}/3)`, "warn");
              await new Promise(r => setTimeout(r, wait));
            }
            resp = await fetch("/api/chat", {
              method: "POST", headers: getApiHeaders(providerCfg),
              body: JSON.stringify({ model: "x", max_tokens: 2000, system: SIM_SYSTEM, messages: [{ role: "user", content: prompt }] }),
            });
            if (resp.status !== 429) break;
          }

          if (!resp.ok) throw new Error(`API ${resp.status}`);
          data = await resp.json();
          text = (data.content || []).map(b => b.text || "").join("");

          // Throttle: wait between API calls to stay under rate limit
          await new Promise(r => setTimeout(r, 2500));

          // Parse JSON from response
          let matchData;
          try {
            let cleanText = text;
            const cbMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
            if (cbMatch) cleanText = cbMatch[1];

            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              let jsonStr = jsonMatch[0]
                .replace(/,\s*([\]}])/g, '$1') // remove trailing commas
                .replace(/[\u0000-\u0019]+/g, ""); // strip control chars

              // Try to fix unescaped quotes inside strings (very basic heuristic)
              // But standard parse first just in case it's valid
              try {
                matchData = JSON.parse(jsonStr);
              } catch (e) {
                // If it fails, maybe there are literal newlines inside string values
                jsonStr = jsonStr.replace(/\n/g, '\\n').replace(/\r/g, '');
                // Clean up the structure keys to not have escaped newlines
                jsonStr = jsonStr.replace(/\\n\s*"/g, '\n"').replace(/\\n\s*\}/g, '\n}').replace(/\\n\s*\]/g, '\n]');
                matchData = JSON.parse(jsonStr);
              }
            }
          } catch (e) {
            matchData = null;
          }

          // Ultimate Fallback if parsing completely fails but it looks like our object
          if (!matchData && text.includes('"match_winner"')) {
            const wMatch = text.match(/"match_winner"\s*:\s*"([^"]+)"/i);
            const sMatch = text.match(/"match_score"\s*:\s*"([^"]+)"/i);
            const aMatch = text.match(/"analysis"\s*:\s*"([^"]+)"/i);
            if (wMatch) {
              matchData = {
                match_winner: wMatch[1],
                match_score: sMatch ? sMatch[1] : "?-?",
                analysis: aMatch ? aMatch[1] : text,
                games: []
              };
            }
          }

          if (matchData) {
            const winner = matchData.match_winner === "Deck A" ? deckA.name : deckB.name;
            log(`  ✦ Winner: ${winner} (${matchData.match_score})`, "result");
            matchData.games?.forEach(g => {
              const gWinner = g.winner === "Deck A" ? deckA.name : deckB.name;
              log(`    Game ${g.game_num}: ${gWinner} (turn ${g.turn_won}) — ${g.key_play}`, "game");
            });
            allResults.push({
              deckA: { id: idA, name: deckA.name },
              deckB: { id: idB, name: deckB.name },
              matchNum,
              winnerId: matchData.match_winner === "Deck A" ? idA : idB,
              winnerName: winner,
              score: matchData.match_score,
              games: (matchData.games || []).map(g => ({ ...g, winnerName: g.winner === "Deck A" ? deckA.name : deckB.name })),
              mvp: matchData.mvp_card,
              analysis: matchData.analysis,
              raw: matchData,
            });
          } else {
            log(`  ⚠ Could not parse match result — raw response saved`, "error");
            allResults.push({ deckA: { id: idA, name: deckA.name }, deckB: { id: idB, name: deckB.name }, matchNum, winnerId: null, winnerName: "Parse Error", score: "?-?", games: [], analysis: text, raw: null });
          }
        } catch (err) {
          log(`  ✗ Error: ${err.message}`, "error");
          allResults.push({ deckA: { id: idA, name: deckA.name }, deckB: { id: idB, name: deckB.name }, matchNum, winnerId: null, winnerName: "Error", score: "0-0", games: [], analysis: err.message, raw: null });
        }
        await new Promise(r => setTimeout(r, 300));
      }
    }

    log(`\n✦ SIMULATION COMPLETE — ${allResults.length} match(es) resolved`, "done");
    setResults(allResults);
    setRunning(false);
  };

  const runPostAnalysis = async () => {
    if (!results || results.length === 0) return;
    setAnalyzingPost(true);

    const summary = results.map(r => `${r.deckA.name} vs ${r.deckB.name}: Winner = ${r.winnerName} (${r.score}). MVP: ${r.mvp || "N/A"}. ${r.analysis || ""}`).join("\n\n");

    const deckSummaries = selected.map(id => {
      const d = vault.find(x => x.id === id);
      if (!d) return "";
      const wins = results.filter(r => r.winnerId === id).length;
      const losses = results.filter(r => (r.deckA.id === id || r.deckB.id === id) && r.winnerId !== id && r.winnerId !== null).length;
      return `${d.name} (${wins}W-${losses}L): ${deckToText(d.deck).split("\n").slice(0, 10).join(", ")}...`;
    }).join("\n\n");

    try {
      let resp;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 3000 * Math.pow(2, attempt)));
        resp = await fetch("/api/chat", {
          method: "POST", headers: getApiHeaders(providerCfg),
          body: JSON.stringify({
            model: "x", max_tokens: 3000,
            system: "You are Arcanum — the world's most elite MTG analyst. You provide tournament-level post-event analysis with strong opinions and actionable insights.",
            messages: [{ role: "user", content: `Provide a comprehensive post-tournament analysis for this simulated event.

MATCH RESULTS:
${summary}

DECK SUMMARIES:
${deckSummaries}

Provide:
1. POWER RANKINGS — rank every deck from strongest to weakest with explanation
2. METAGAME ANALYSIS — what archetypes dominated and why
3. KEY TAKEAWAYS — what card choices or strategies made the biggest difference
4. IMPROVEMENT RECOMMENDATIONS — specific card changes for each deck that underperformed
5. PREDICTION — if these decks played a 100-match round-robin, what would the final standings look like?

Be specific. Reference actual cards. Give percentages. Be opinionated.` }],
          }),
        });
        if (resp.status !== 429) break;
      }

      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      setPostAnalysis((data.content || []).map(b => b.text || "").join(""));
    } catch (err) {
      setPostAnalysis(`Analysis failed: ${err.message}`);
    }
    setAnalyzingPost(false);
  };

  // Compute standings from results
  const standings = useMemo(() => {
    if (!results) return [];
    const map = {};
    selected.forEach(id => {
      const d = vault.find(x => x.id === id);
      map[id] = { id, name: d?.name || "?", wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, mvps: {} };
    });
    results.forEach(r => {
      if (!r.winnerId) return;
      const loserId = r.winnerId === r.deckA.id ? r.deckB.id : r.deckA.id;
      if (map[r.winnerId]) map[r.winnerId].wins++;
      if (map[loserId]) map[loserId].losses++;
      (r.games || []).forEach(g => {
        const gwId = g.winner === "Deck A" ? r.deckA.id : r.deckB.id;
        const glId = g.winner === "Deck A" ? r.deckB.id : r.deckA.id;
        if (map[gwId]) map[gwId].gamesWon++;
        if (map[glId]) map[glId].gamesLost++;
      });
      if (r.mvp && map[r.winnerId]) map[r.winnerId].mvps[r.mvp] = (map[r.winnerId].mvps[r.mvp] || 0) + 1;
    });
    return Object.values(map).sort((a, b) => b.wins - a.wins || (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost));
  }, [results, selected, vault]);

  // ── Vault Card ──
  const VaultCard = ({ entry }) => {
    const colors = deckColorIds(entry.deck);
    const count = entry.deck.mainboard.reduce((a, c) => a + c.qty, 0);
    const isSelected = selected.includes(entry.id);
    // Find a key card with art for the thumbnail
    const keyCard = entry.deck.mainboard.find(c => c.cardData?.image_uris?.art_crop && !c.cardData?.type_line?.includes("Land"));
    const artCrop = keyCard?.cardData?.image_uris?.art_crop;
    return (
      <div style={{
        background: isSelected ? "rgba(201,168,76,0.03)" : "rgba(0,0,0,0.25)",
        border: `1px solid ${isSelected ? "#c9a84c33" : "rgba(255,255,255,0.04)"}`,
        borderRadius: 12, cursor: "pointer",
        transition: "all 0.25s cubic-bezier(0.19,1,0.22,1)",
        position: "relative", overflow: "hidden",
        boxShadow: isSelected ? "0 4px 24px rgba(201,168,76,0.08)" : "0 2px 8px rgba(0,0,0,0.2)",
      }}
        onClick={() => toggle(entry.id)}
        onMouseOver={e => { e.currentTarget.style.borderColor = isSelected ? "#c9a84c55" : "rgba(255,255,255,0.1)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = isSelected ? "0 8px 30px rgba(201,168,76,0.12)" : "0 8px 24px rgba(0,0,0,0.35)"; }}
        onMouseOut={e => { e.currentTarget.style.borderColor = isSelected ? "#c9a84c33" : "rgba(255,255,255,0.04)"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = isSelected ? "0 4px 24px rgba(201,168,76,0.08)" : "0 2px 8px rgba(0,0,0,0.2)"; }}>
        {/* Art banner */}
        {artCrop && (
          <div style={{ height: 48, overflow: "hidden", position: "relative", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <img src={artCrop} alt="" style={{ width: "100%", height: 80, objectFit: "cover", objectPosition: "center 30%", opacity: isSelected ? 0.35 : 0.2, transition: "opacity 0.3s" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 20%, rgba(0,0,0,0.9))" }} />
          </div>
        )}
        <div style={{ padding: artCrop ? "8px 14px 14px" : 14 }}>
        {isSelected && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #c9a84c, #f0d68a)", animation: "shimmer 3s ease infinite", backgroundSize: "200% 100%" }} />}
        {isSelected && <div style={{ position: "absolute", top: artCrop ? 56 : 8, right: 8, background: "linear-gradient(135deg, #c9a84c, #f0d68a)", color: "#0a0a0a", fontSize: 7, fontWeight: 700, padding: "2px 8px", borderRadius: 5, fontFamily: "'Cinzel', serif", letterSpacing: 1, boxShadow: "0 2px 6px rgba(201,168,76,0.2)" }}>SELECTED</div>}
        <div style={{ display: "flex", gap: 5, marginBottom: 6, alignItems: "center" }}>
          {colors.map(c => <span key={c} style={{ fontSize: 11 }}>{COLORS.find(x => x.id === c)?.sym || "?"}</span>)}
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: isSelected ? "#c9a84c" : "#999", fontWeight: 600, flex: 1, transition: "color 0.2s" }}>{entry.name}</span>
          {entry.totalPrice > 0 && <span style={{ fontSize: 9, color: "#4DB87A88", fontWeight: 700, fontFamily: "'Cinzel', serif" }}>${entry.totalPrice.toFixed(0)}</span>}
        </div>
        <div style={{ fontSize: 9, color: "#444", marginBottom: 6, fontFamily: "'Crimson Text', serif" }}>{count} cards · {entry.format || "Modern"}</div>
        <div style={{ fontSize: 9, color: "#2a2a2a", lineHeight: 1.4 }}>
          {entry.deck.mainboard.filter(c => !c.cardData?.type_line?.includes("Land")).slice(0, 5).map(c => `${c.qty} ${c.name}`).join(" · ")}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
          <button onClick={e => { e.stopPropagation(); setViewDeck(entry); }} style={{ ...xBtn, fontSize: 9, padding: "4px 10px", borderRadius: 5, transition: "all 0.2s" }}
            onMouseOver={e => e.currentTarget.style.borderColor = "#c9a84c33"}
            onMouseOut={e => e.currentTarget.style.borderColor = "#1f1f1f"}
          >👁 View</button>
          <button onClick={e => { e.stopPropagation(); deleteDeck(entry.id); }} style={{ ...xBtn, fontSize: 9, padding: "4px 10px", color: "#E05A5088", borderColor: "#E05A5022", borderRadius: 5, transition: "all 0.2s" }}
            onMouseOver={e => { e.currentTarget.style.color = "#E05A50"; e.currentTarget.style.borderColor = "#E05A5044"; }}
            onMouseOut={e => { e.currentTarget.style.color = "#E05A5088"; e.currentTarget.style.borderColor = "#E05A5022"; }}
          >✗</button>
        </div>
        </div>
      </div>
    );
  };

  // ── Matchup Matrix ──
  const MatchupMatrix = () => {
    if (!results || selected.length < 2) return null;
    const decks = selected.map(id => vault.find(x => x.id === id)).filter(Boolean);
    const getRecord = (aId, bId) => {
      const matches = results.filter(r => (r.deckA.id === aId && r.deckB.id === bId) || (r.deckA.id === bId && r.deckB.id === aId));
      let w = 0, l = 0;
      matches.forEach(r => { if (r.winnerId === aId) w++; else if (r.winnerId === bId) l++; });
      return { w, l, total: matches.length };
    };
    return (
      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>MATCHUP MATRIX</div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            <th style={{ padding: "6px 10px", fontSize: 9, color: "#444", textAlign: "left", borderBottom: "1px solid #1a1a1a" }}></th>
            {decks.map(d => <th key={d.id} style={{ padding: "6px 8px", fontSize: 9, color: "#888", textAlign: "center", borderBottom: "1px solid #1a1a1a", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</th>)}
          </tr></thead>
          <tbody>
            {decks.map(row => (
              <tr key={row.id}>
                <td style={{ padding: "6px 10px", fontSize: 10, color: "#aaa", borderBottom: "1px solid #0f0f0f", whiteSpace: "nowrap", fontWeight: 600 }}>{row.name}</td>
                {decks.map(col => {
                  if (row.id === col.id) return <td key={col.id} style={{ padding: "6px 8px", textAlign: "center", borderBottom: "1px solid #0f0f0f", background: "#0a0a0a" }}><span style={{ fontSize: 9, color: "#222" }}>—</span></td>;
                  const rec = getRecord(row.id, col.id);
                  const pct = rec.total ? Math.round((rec.w / rec.total) * 100) : 0;
                  const bg = pct >= 60 ? "#1a3a1a" : pct <= 40 ? "#3a1a1a" : "#1a1a1a";
                  return <td key={col.id} style={{ padding: "6px 8px", textAlign: "center", borderBottom: "1px solid #0f0f0f", background: bg }}>
                    <span style={{ fontSize: 11, color: pct >= 60 ? "#4DB87A" : pct <= 40 ? "#E05A50" : "#888", fontWeight: 700 }}>{rec.w}-{rec.l}</span>
                    {rec.total > 0 && <div style={{ fontSize: 8, color: "#444" }}>{pct}%</div>}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{ padding: "8px 0", animation: "fadeIn 0.4s" }}>
      {/* Vault */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, fontFamily: "'Cinzel', serif" }}>DECK VAULT ({vault.length})</div>
          <span style={{ fontSize: 9, color: "#333" }}>Select 2-8 decks for battle</span>
        </div>
        {vault.length === 0 ? (
          <div className="glass-panel" style={{ ...GLASS_STYLE, padding: 40, textAlign: "center", background: "rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3, filter: "drop-shadow(0 0 10px #c9a84c33)" }}>💎</div>
            <div style={{ fontSize: 13, color: "#666", fontFamily: "'Crimson Text', serif", maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>Your vault is empty. Build decks with the AI Agent or Guided Builder, then save them here.</div>
          </div>
        ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {vault.map(entry => <VaultCard key={entry.id} entry={entry} />)}
          </div>
        )}
      </div>

      {/* Config */}
      {selected.length >= 2 && (
        <div className="glass-panel" style={{ ...GLASS_STYLE, background: "rgba(201,168,76,0.03)", padding: 18, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 9, color: "#c9a84c", letterSpacing: 2, marginBottom: 6, fontFamily: "'Cinzel', serif" }}>MATCH PARAMETERS</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 3, 5].map(n => (
                  <button key={n} onClick={() => setBestOf(n)} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${bestOf === n ? "#c9a84c66" : "rgba(255,255,255,0.05)"}`, background: bestOf === n ? "rgba(201,168,76,0.15)" : "transparent", color: bestOf === n ? "#c9a84c" : "#666", cursor: "pointer", fontSize: 11, fontFamily: "'Cinzel', serif", transition: "all 0.2s" }}>Bo{n}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#c9a84c", letterSpacing: 2, marginBottom: 6, fontFamily: "'Cinzel', serif" }}>MATCHES PER PAIR</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 3, 5, 10].map(n => (
                  <button key={n} onClick={() => setMatchCount(n)} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${matchCount === n ? "#c9a84c66" : "rgba(255,255,255,0.05)"}`, background: matchCount === n ? "rgba(201,168,76,0.15)" : "transparent", color: matchCount === n ? "#c9a84c" : "#666", cursor: "pointer", fontSize: 11, fontFamily: "'Cinzel', serif", transition: "all 0.2s" }}>×{n}</button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 6, fontStyle: "italic" }}>{generatePairs().length} pair(s) · {generatePairs().length * matchCount} total matches</div>
              <button onClick={runSimulation} disabled={running} style={{ padding: "12px 32px", background: running ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #c9a84c, #f0d68a)", border: "none", borderRadius: 8, cursor: running ? "not-allowed" : "pointer", fontFamily: "'Cinzel', serif", fontSize: 13, fontWeight: 700, color: "#0a0a0a", letterSpacing: 3, boxShadow: "0 10px 25px rgba(201,168,76,0.2)", transition: "all 0.3s cubic-bezier(0.19, 1, 0.22, 1)" }} onMouseOver={e => !running && (e.currentTarget.style.transform = "translateY(-2px) scale(1.02)")} onMouseOut={e => !running && (e.currentTarget.style.transform = "translateY(0) scale(1)")}>
                {running ? "SIMULATING..." : "✦ BEGIN BATTLE ✦"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Sim Log */}
      {simLog.length > 0 && (
        <div ref={logRef} style={{ background: "#080808", borderRadius: 8, padding: 12, maxHeight: 250, overflowY: "auto", fontFamily: "monospace", fontSize: 10, marginBottom: 16, border: "1px solid #151515" }}>
          {simLog.map((l, i) => (
            <div key={i} style={{ color: l.type === "done" ? "#c9a84c" : l.type === "result" ? "#4DB87A" : l.type === "error" ? "#E05A50" : l.type === "match" ? "#4DA3D4" : "#555", marginBottom: 2, whiteSpace: "pre-wrap" }}>
              [{l.t}] {l.m}
            </div>
          ))}
        </div>
      )}

      {/* Standings */}
      {standings.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>STANDINGS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {standings.map((s, i) => {
              const total = s.wins + s.losses;
              const pct = total ? Math.round((s.wins / total) * 100) : 0;
              const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
              const topMvp = Object.entries(s.mvps).sort((a, b) => b[1] - a[1])[0];
              const rankColor = i === 0 ? "#c9a84c" : i === 1 ? "#b0b0b0" : i === 2 ? "#cd7f32" : "#555";
              const barColor = pct >= 60 ? "#4DB87A" : pct <= 40 ? "#E05A50" : "#c9a84c";
              return (
                <div key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                  background: i === 0 ? "linear-gradient(135deg, #0f0e08, #12100a)" : "#0c0c0c",
                  border: `1px solid ${i === 0 ? "#c9a84c22" : "#151515"}`,
                  borderRadius: 10, transition: "all 0.2s",
                  borderLeft: `3px solid ${rankColor}`,
                  animation: `cardEntrance 0.3s ease ${i * 0.06}s both`,
                }}
                  onMouseOver={e => { e.currentTarget.style.background = i === 0 ? "linear-gradient(135deg, #141208, #18140c)" : "#0e0e0e"; e.currentTarget.style.transform = "translateX(2px)"; }}
                  onMouseOut={e => { e.currentTarget.style.background = i === 0 ? "linear-gradient(135deg, #0f0e08, #12100a)" : "#0c0c0c"; e.currentTarget.style.transform = "translateX(0)"; }}
                >
                  <span style={{ fontSize: 18, width: 30, textAlign: "center", filter: i < 3 ? "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" : "none" }}>{medal}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: i === 0 ? "#c9a84c" : "#aaa", fontWeight: 600, display: "block", marginBottom: 4 }}>{s.name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 4, background: "#151515", borderRadius: 4, overflow: "hidden", maxWidth: 120 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${barColor}88, ${barColor})`, borderRadius: 4, animation: "progressFill 0.8s ease-out", transition: "width 0.5s ease" }} />
                      </div>
                      <span style={{ fontSize: 9, color: barColor, fontWeight: 600, fontFamily: "'Cinzel', serif" }}>{pct}%</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "center", minWidth: 55, padding: "4px 8px", background: "rgba(0,0,0,0.25)", borderRadius: 8 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: barColor, fontFamily: "'Cinzel', serif" }}>{s.wins}-{s.losses}</div>
                    <div style={{ fontSize: 8, color: "#444", letterSpacing: 1 }}>MATCH</div>
                  </div>
                  <div style={{ textAlign: "center", minWidth: 45, padding: "4px 8px", background: "rgba(0,0,0,0.15)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>{s.gamesWon}-{s.gamesLost}</div>
                    <div style={{ fontSize: 8, color: "#333", letterSpacing: 1 }}>GAME</div>
                  </div>
                  {topMvp && <div style={{ fontSize: 9, color: "#c9a84c88", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "3px 8px", background: "rgba(201,168,76,0.04)", borderRadius: 5, border: "1px solid rgba(201,168,76,0.08)" }}>⭐ {topMvp[0]}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Matchup Matrix */}
      <MatchupMatrix />

      {/* Individual Match Results */}
      {results && results.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>MATCH DETAILS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {results.map((r, i) => (
              <div key={i} style={{ background: "#0c0c0c", border: "1px solid #181818", borderRadius: 10, overflow: "hidden", transition: "all 0.2s", animation: `cardEntrance 0.3s ease ${i * 0.04}s both` }}
                onMouseOver={e => e.currentTarget.style.borderColor = "#222"} onMouseOut={e => e.currentTarget.style.borderColor = "#181818"}>
                <div onClick={() => setExpandedMatch(expandedMatch === i ? null : i)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", transition: "background 0.15s" }}
                  onMouseOver={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: 11, color: "#c9a84c", fontFamily: "'Cinzel', serif", minWidth: 16, transition: "transform 0.2s", transform: expandedMatch === i ? "rotate(90deg)" : "rotate(0)" }}>▶</span>
                  <span style={{ fontSize: 12, color: "#aaa", flex: 1 }}>{r.deckA.name} <span style={{ color: "#333", margin: "0 4px", fontSize: 10, letterSpacing: 1 }}>VS</span> {r.deckB.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#c9a84c", fontFamily: "'Cinzel', serif", padding: "2px 10px", background: "rgba(201,168,76,0.06)", borderRadius: 6 }}>{r.score}</span>
                  <span style={{ fontSize: 10, color: "#4DB87A", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4DB87A", boxShadow: "0 0 6px #4DB87A44" }} />
                    {r.winnerName}
                  </span>
                </div>
                {expandedMatch === i && (
                  <div style={{ padding: "4px 14px 14px", borderTop: "1px solid rgba(255,255,255,0.03)", animation: "slideUp 0.2s ease" }}>
                    {/* Game timeline */}
                    {r.games.length > 0 && (
                      <div style={{ display: "flex", gap: 6, marginBottom: 12, marginTop: 8 }}>
                        {r.games.map((g, j) => {
                          const isWinA = g.winnerName === r.deckA.name;
                          return (
                            <div key={j} style={{ flex: 1, padding: "8px 10px", background: "rgba(0,0,0,0.3)", borderRadius: 8, borderTop: `2px solid ${isWinA ? "#4DA3D4" : "#E05A50"}`, animation: `cardEntrance 0.2s ease ${j * 0.08}s both` }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ fontSize: 9, color: "#555", fontWeight: 700, letterSpacing: 1, fontFamily: "'Cinzel', serif" }}>G{g.game_num}</span>
                                <span style={{ fontSize: 8, color: "#444" }}>T{g.turn_won}</span>
                              </div>
                              <div style={{ fontSize: 10, color: isWinA ? "#4DA3D4" : "#E05A50", fontWeight: 600, marginBottom: 2 }}>{g.winnerName}</div>
                              {g.key_play && <div style={{ fontSize: 9, color: "#555", fontStyle: "italic", lineHeight: 1.3 }}>⚡ {g.key_play}</div>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {r.mvp && <div style={{ fontSize: 10, color: "#c9a84c", marginBottom: 8, padding: "4px 10px", background: "rgba(201,168,76,0.04)", borderRadius: 6, display: "inline-block", border: "1px solid rgba(201,168,76,0.08)" }}>⭐ MVP: {r.mvp}</div>}
                    {r.analysis && <div style={{ fontSize: 11, color: "#777", fontFamily: "'Crimson Text', serif", lineHeight: 1.7, padding: "8px 0" }}>{r.analysis}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Post-Tournament Analysis */}
      {results && results.length > 0 && !postAnalysis && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button onClick={runPostAnalysis} disabled={analyzingPost} style={{ padding: "12px 32px", background: analyzingPost ? "#1a1a1a" : "linear-gradient(135deg, #4DA3D4, #c9a84c)", border: "none", borderRadius: 6, cursor: analyzingPost ? "not-allowed" : "pointer", fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 700, color: analyzingPost ? "#444" : "#0a0a0a", letterSpacing: 2 }}>
            {analyzingPost ? "ANALYZING..." : "🔮 DEEP ANALYSIS"}
          </button>
        </div>
      )}

      {postAnalysis && (
        <div style={{ marginTop: 16, padding: 16, background: "#0a0a0a", border: "1px solid #c9a84c22", borderRadius: 10 }}>
          <div style={{ fontSize: 10, color: "#c9a84c", letterSpacing: 2, marginBottom: 10, fontFamily: "'Cinzel', serif" }}>🔮 POST-TOURNAMENT ANALYSIS</div>
          <div style={{ fontSize: 13, color: "#999", fontFamily: "'Crimson Text', serif", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{postAnalysis}</div>
        </div>
      )}

      {/* Deck Viewer Modal */}
      {viewDeck && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", zIndex: 1100, display: "flex", flexDirection: "column" }} onClick={() => setViewDeck(null)}>
          <div style={{ maxWidth: "clamp(860px, 95vw, 1500px)", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", height: "100vh", padding: "16px 20px" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexShrink: 0 }}>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: "#c9a84c" }}>{viewDeck.name}</h3>
              <button onClick={() => setViewDeck(null)} style={{ ...xBtn, fontSize: 14, borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <DeckDisplay deck={viewDeck.deck} onHover={setHov} listHeight="calc(100vh - 220px)" />
            </div>
          </div>
          {hov && <div className="card-preview-enter" style={{ position: "fixed", right: 20, top: 90, zIndex: 1200, pointerEvents: "none" }}>
            <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06), 0 0 30px rgba(201,168,76,0.08)" }}>
              <img src={hov} alt="" style={{ width: 245, display: "block", borderRadius: 12 }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #c9a84c44, #c9a84c, #c9a84c44)", animation: "shimmer 3s ease infinite", backgroundSize: "200% 100%" }} />
            </div>
          </div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// SETTINGS MODAL — Provider & API Key Config
// ═══════════════════════════════════════════════════════════

function SettingsModal({ config, setConfig, onClose }) {
  const [localCfg, setLocalCfg] = useState({ ...config });
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState(null);
  const provider = AI_PROVIDERS.find(p => p.id === localCfg.providerId) || AI_PROVIDERS[0];

  const handleProviderChange = (id) => {
    const p = AI_PROVIDERS.find(x => x.id === id);
    setLocalCfg(prev => ({ ...prev, providerId: id, modelId: p?.defaultModel || "" }));
    setTestStatus(null);
  };

  const handleSave = () => {
    setConfig(localCfg);
    saveProviderConfig(localCfg);
    onClose();
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: getApiHeaders(localCfg),
        body: JSON.stringify({
          model: localCfg.modelId || provider.defaultModel,
          max_tokens: 50,
          system: "Reply with exactly: OK",
          messages: [{ role: "user", content: "test" }]
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = (data.content || []).map(b => b.text || "").join("");
        setTestStatus(text ? "success" : "error");
      } else {
        const data = await resp.json().catch(() => ({}));
        setTestStatus("error:" + (data.error?.message || `HTTP ${resp.status}`));
      }
    } catch (e) { setTestStatus("error:" + e.message); }
  };

  const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.2s ease" };
  const panel = { background: "#0c0c0c", border: "1px solid #1a1a1a", borderRadius: 14, padding: "24px 28px", width: 460, maxHeight: "85vh", overflowY: "auto" };
  const label = { fontSize: 9, color: "#c9a84c88", letterSpacing: 2, marginBottom: 6, fontFamily: "'Cinzel', serif" };
  const inp = { width: "100%", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 5, padding: "8px 12px", color: "#bbb", fontSize: 12, fontFamily: "'Crimson Text', serif", outline: "none", boxSizing: "border-box" };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#c9a84c", letterSpacing: 2 }}>⚙ AI SETTINGS</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#444", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        {/* Provider selection */}
        <div style={{ marginBottom: 20 }}>
          <div style={label}>PROVIDER</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {AI_PROVIDERS.map(p => (
              <button key={p.id} onClick={() => handleProviderChange(p.id)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                background: localCfg.providerId === p.id ? "#c9a84c08" : "#080808",
                border: `1px solid ${localCfg.providerId === p.id ? "#c9a84c33" : "#141414"}`,
                borderRadius: 7, cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: localCfg.providerId === p.id ? "#c9a84c" : "#222",
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: localCfg.providerId === p.id ? "#c9a84c" : "#888", fontWeight: 600 }}>
                    {p.name}
                    {!p.needsKey && <span style={{ fontSize: 9, color: "#4DB87A", marginLeft: 8, fontWeight: 400 }}>FREE</span>}
                  </div>
                  <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{p.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* API Key */}
        {provider.needsKey && (
          <div style={{ marginBottom: 18 }}>
            <div style={label}>API KEY</div>
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  type={showKey ? "text" : "password"}
                  value={(localCfg.keys && localCfg.keys[localCfg.providerId]) || localCfg.apiKey || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setLocalCfg(prev => ({
                      ...prev,
                      apiKey: val,
                      keys: { ...(prev.keys || {}), [localCfg.providerId]: val }
                    }));
                    setTestStatus(null);
                  }}
                  placeholder={`Paste your ${provider.name} API key(s) separated by commas...`}
                  style={inp}
                />
                <button onClick={() => setShowKey(!showKey)} style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 11,
                }}>{showKey ? "🙈" : "👁"}</button>
              </div>
            </div>
            {provider.url && (
              <a href={provider.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 10, color: "#4DA3D4", textDecoration: "none", marginTop: 4, display: "inline-block" }}>
                → Get a {provider.name} API key
              </a>
            )}
          </div>
        )}

        {/* Real-Time Search Key */}
        <div style={{ marginBottom: 18 }}>
          <div style={label}>TAVILY SEARCH API KEY (Optional, enables live web search)</div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                type={"password"}
                value={localCfg.tavilyKey || ""}
                onChange={e => setLocalCfg(prev => ({ ...prev, tavilyKey: e.target.value }))}
                placeholder={`tvly-...`}
                style={inp}
              />
            </div>
          </div>
          <a href="https://tavily.com/" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10, color: "#4DA3D4", textDecoration: "none", marginTop: 4, display: "inline-block" }}>
            → Get a free Tavily API key (1,000 requests/mo)
          </a>
        </div>

        {/* Model selection */}
        {provider.models.length > 1 && (
          <div style={{ marginBottom: 18 }}>
            <div style={label}>MODEL</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {provider.models.map(m => (
                <button key={m.id} onClick={() => setLocalCfg(prev => ({ ...prev, modelId: m.id }))}
                  style={{
                    padding: "5px 10px", borderRadius: 5, fontSize: 10, cursor: "pointer",
                    fontFamily: "'Cinzel', serif",
                    background: (localCfg.modelId || provider.defaultModel) === m.id ? "#c9a84c10" : "#080808",
                    border: `1px solid ${(localCfg.modelId || provider.defaultModel) === m.id ? "#c9a84c44" : "#1a1a1a"}`,
                    color: (localCfg.modelId || provider.defaultModel) === m.id ? "#c9a84c" : "#555",
                    transition: "all 0.15s",
                  }}>{m.name}</button>
              ))}
            </div>
          </div>
        )}

        {/* Test connection */}
        <div style={{ marginBottom: 20 }}>
          <button onClick={testConnection} disabled={provider.needsKey && !((localCfg.keys && localCfg.keys[localCfg.providerId]) || localCfg.apiKey)}
            style={{
              padding: "7px 16px", borderRadius: 5, fontSize: 10, cursor: "pointer",
              fontFamily: "'Cinzel', serif", letterSpacing: 1,
              background: "#0a0a0a", border: "1px solid #1a1a1a", color: "#666",
              opacity: provider.needsKey && !((localCfg.keys && localCfg.keys[localCfg.providerId]) || localCfg.apiKey) ? 0.4 : 1,
            }}>
            {testStatus === "testing" ? "⏳ Testing..." : "🔌 Test Connection"}
          </button>
          {testStatus === "success" && <span style={{ marginLeft: 10, fontSize: 11, color: "#4DB87A" }}>✓ Connected!</span>}
          {testStatus?.startsWith("error") && <span style={{ marginLeft: 10, fontSize: 11, color: "#E05A50" }}>✗ {testStatus.replace("error:", "")}</span>}
        </div>

        {/* Info */}
        <div style={{ padding: "10px 12px", background: "#080808", borderRadius: 6, border: "1px solid #141414", marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: "#444", lineHeight: 1.7, fontFamily: "'Crimson Text', serif" }}>
            <strong style={{ color: "#666" }}>Your keys stay in your browser</strong> — they're sent directly to the provider through our serverless proxy. We never store or log API keys.
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={xBtn}>Cancel</button>
          <button onClick={handleSave} style={{ ...xBtn, background: "#c9a84c12", color: "#c9a84c", borderColor: "#c9a84c44" }}>✦ Save</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════

export default function MTGDeckArchitect() {
  const [tab, setTab] = useState("agent");
  const [vault, setVault] = useState(loadVault());
  const [saveModal, setSaveModal] = useState(null);
  const [saveName, setSaveName] = useState("");
  const [providerCfg, setProviderCfg] = useState(loadProviderConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [compareIds, setCompareIds] = useState([]); // Array of 2 IDs
  const [inventory, setInventory] = useState(() => JSON.parse(localStorage.getItem("arcanum_collection") || "{}"));
  useEffect(() => { localStorage.setItem("arcanum_collection", JSON.stringify(inventory)); }, [inventory]);
  const [activeColors, setActiveColors] = useState([]);
  const [globalPulse, setGlobalPulse] = useState(null); // { type: "success" | "error" }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, card }

  const triggerPulse = (type) => {
    setGlobalPulse(type);
    setTimeout(() => setGlobalPulse(null), 1000);
  };

  const activeProvider = AI_PROVIDERS.find(p => p.id === providerCfg.providerId) || AI_PROVIDERS[0];

  const onCtx = (e, card) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, card });
  };

  // Sync colors whenever vault changes or a deck is loaded
  useEffect(() => {
    const active = vault.find(d => tab === "agent" ? false : d.id === tab); // Simplification for now
    if (active) setActiveColors(active.colors);
  }, [tab, vault]);

  const handleSaveDeck = (deck, existingId = null) => {
    setSaveModal({ ...deck, _existingId: existingId });
    const colors = deckColorIds(deck);
    const colorNames = colors.map(c => COLORS.find(x => x.id === c)?.name || "").join("/");

    if (existingId) {
      const existing = vault.find(d => d.id === existingId);
      setSaveName(existing?.name || (colorNames ? `${colorNames} Deck` : "New Deck"));
      triggerPulse("success");
    } else {
      setSaveName(colorNames ? `${colorNames} Deck` : "New Deck");
    }
  };

  const confirmSave = () => {
    if (!saveModal || !saveName.trim()) return;
    const serialized = serializeDeck(saveModal);
    const colors = deckColorIds(serialized);
    const totalPrice = computePrice([...serialized.mainboard, ...(serialized.sideboard || []), ...(serialized.commander || [])]);

    const entry = {
      id: saveModal._existingId || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5)),
      name: saveName.trim(),
      deck: serialized,
      format: "Modern",
      colors: colors,
      totalPrice: totalPrice,
      savedAt: new Date().toISOString(),
    };

    let nv;
    if (saveModal._existingId) {
      nv = vault.map(d => d.id === saveModal._existingId ? entry : d);
    } else {
      nv = [...vault, entry];
    }

    setVault(nv); saveVault(nv);
    setSaveModal(null); setSaveName("");
    triggerPulse("success");
  };

  const handleUpdateInventory = (name, delta) => {
    setInventory(prev => ({ ...prev, [name]: Math.max((prev[name] || 0) + delta, 0) }));
  };

  return (
    <div style={{ minHeight: "100vh", color: "#ddd", fontFamily: "'Crimson Text', Georgia, serif", position: "relative", display: "flex", flexDirection: "column" }}>
      <ManaBackground colors={activeColors} />

      {/* Global State Pulses */}
      {globalPulse && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none",
          background: globalPulse === "success" ? "radial-gradient(circle, rgba(77, 184, 122, 0.1) 0%, transparent 70%)" : "radial-gradient(circle, rgba(224, 90, 80, 0.1) 0%, transparent 70%)",
          animation: "pulse 1s ease-out forwards"
        }} />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1f1f1f; border-radius: 10px; transition: background 0.2s; }
        ::-webkit-scrollbar-thumb:hover { background: #c9a84c66; }
        ::selection { background: #c9a84c33; color: #fff; }
        @keyframes orbital { from { transform: rotate(0deg) translateX(10%) rotate(0deg); } to { transform: rotate(360deg) translateX(10%) rotate(-360deg); } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 20px rgba(201, 168, 76, 0.1); } 50% { box-shadow: 0 0 40px rgba(201, 168, 76, 0.3); } }
        .lux-card { transition: all 0.3s cubic-bezier(0.19, 1, 0.22, 1); }
        .lux-card:hover { transform: translateY(-2px) scale(1.01); box-shadow: 0 8px 24px rgba(0,0,0,0.4); border-color: rgba(201, 168, 76, 0.2); }
        .glass-panel { background: rgba(10, 10, 10, 0.6) !important; backdrop-filter: blur(24px) saturate(180%) !important; WebkitBackdropFilter: blur(24px) saturate(180%) !important; border: 1px solid rgba(255, 255, 255, 0.06) !important; border-radius: 14px !important; }
        @keyframes inkDissolve {
          0% { filter: blur(12px) contrast(150%); opacity: 0; transform: translateY(8px); }
          100% { filter: blur(0) contrast(100%); opacity: 1; transform: translateY(0); }
        }
        @keyframes successPulse {
          0% { opacity: 0; background: radial-gradient(circle, rgba(77, 184, 122, 0.4) 0%, transparent 70%); }
          50% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(1.4); }
        }
        @keyframes errorPulse {
          0% { opacity: 0; background: radial-gradient(circle, rgba(224, 90, 80, 0.4) 0%, transparent 70%); }
          50% { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(1.4); }
        }
        @keyframes cardEntrance {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes typingDot {
          0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes barGrow {
          from { transform: scaleY(0); }
          to { transform: scaleY(1); }
        }
        @keyframes shimmer {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes breathe {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes tabSlide {
          from { opacity: 0; transform: scaleX(0.5); }
          to { opacity: 1; transform: scaleX(1); }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 8px rgba(201,168,76,0.1); }
          50% { box-shadow: 0 0 16px rgba(201,168,76,0.25); }
        }
        @keyframes cardReveal {
          from { opacity: 0; transform: translateY(8px) scale(0.96); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes progressFill {
          from { width: 0%; }
        }
        @keyframes gentleFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        button { font-family: inherit; }
        button:focus-visible { outline: 1px solid #c9a84c55; outline-offset: 2px; }
        input:focus-visible, textarea:focus-visible { border-color: #c9a84c44 !important; box-shadow: 0 0 0 2px rgba(201,168,76,0.08) !important; }
        .tab-btn { position: relative; overflow: hidden; }
        .tab-btn::after { content: ''; position: absolute; bottom: 0; left: 20%; right: 20%; height: 2px; background: linear-gradient(90deg, transparent, #c9a84c, transparent); transform: scaleX(0); transition: transform 0.3s cubic-bezier(0.19,1,0.22,1); }
        .tab-btn.active::after { transform: scaleX(1); }
        .hover-lift { transition: all 0.25s cubic-bezier(0.19,1,0.22,1); }
        .hover-lift:hover { transform: translateY(-2px); }
        .card-preview-enter { animation: cardReveal 0.2s ease-out; }
        @media (max-width: 768px) {
          .responsive-header-tabs { flex-wrap: wrap; gap: 2px !important; }
          .responsive-header-tabs button { padding: 5px 8px !important; font-size: 8px !important; }
          .responsive-main { padding-left: 8px !important; padding-right: 8px !important; }
        }
      `}</style>

      {/* Header */}
      <div className="glass-panel" style={{ ...GLASS_STYLE, position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: 0, borderBottom: "1px solid rgba(255,255,255,0.04)", backdropFilter: "blur(30px) saturate(200%)", WebkitBackdropFilter: "blur(30px) saturate(200%)", background: "rgba(5, 5, 5, 0.75)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #c9a84c22, #c9a84c08)", border: "1px solid #c9a84c22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, animation: "breathe 4s ease-in-out infinite" }}>✦</div>
            <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 17, fontWeight: 700, background: "linear-gradient(135deg, #c9a84c, #f0d68a, #c9a84c)", backgroundSize: "200% 100%", animation: "shimmer 8s ease infinite", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: 3 }}>ARCANUM</h1>
          </div>
          <span style={{ color: "#555", fontSize: 10, fontStyle: "italic", opacity: 0.6 }}>MTG Deck Architect</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="responsive-header-tabs" style={{ display: "flex", background: "rgba(0,0,0,0.35)", borderRadius: 10, padding: 3, border: "1px solid rgba(255,255,255,0.04)", gap: 1 }}>
            {[
              { id: "agent", label: "AGENT", icon: "✦" },
              { id: "builder", label: "BUILDER", icon: "⚙" },
              { id: "arena", label: `ARENA${vault.length ? ` (${vault.length})` : ""}`, icon: "⚔" },
              { id: "vault", label: "VAULT", icon: "💎" },
              { id: "inventory", label: "COLLECTION", icon: "🎒" },
            ].map(t => (
              <button key={t.id} className={`tab-btn${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)} style={{
                padding: "7px 16px", border: "none", cursor: "pointer", borderRadius: 8,
                background: tab === t.id ? "rgba(201, 168, 76, 0.12)" : "transparent",
                fontFamily: "'Cinzel', serif", fontSize: 9, letterSpacing: 1.5,
                color: tab === t.id ? "#c9a84c" : "#555", transition: "all 0.25s cubic-bezier(0.19, 1, 0.22, 1)",
                boxShadow: tab === t.id ? "0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(201,168,76,0.1)" : "none",
                transform: tab === t.id ? "translateY(-1px)" : "translateY(0)",
              }}
                onMouseOver={e => { if (tab !== t.id) { e.currentTarget.style.color = "#888"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; } }}
                onMouseOut={e => { if (tab !== t.id) { e.currentTarget.style.color = "#555"; e.currentTarget.style.background = "transparent"; } }}
              ><span style={{ marginRight: 4, fontSize: 10, transition: "transform 0.2s", display: "inline-block", transform: tab === t.id ? "scale(1.15)" : "scale(1)" }}>{t.icon}</span> {t.label}</button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.06)" }} />
          <button onClick={() => setShowSettings(true)} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 8, cursor: "pointer", transition: "all 0.25s",
          }}
            onMouseOver={e => { e.currentTarget.style.borderColor = "#c9a84c33"; e.currentTarget.style.background = "rgba(201,168,76,0.05)"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.background = "rgba(0,0,0,0.3)"; }}
          >
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: providerCfg.providerId === "groq-free" ? "#4DB87A" : "#c9a84c", boxShadow: `0 0 6px ${providerCfg.providerId === "groq-free" ? "#4DB87A55" : "#c9a84c55"}` }} />
            <span style={{ fontSize: 9, color: "#777", fontFamily: "'Cinzel', serif", letterSpacing: 1 }}>
              {activeProvider.name}
            </span>
            <span style={{ fontSize: 10, color: "#444", transition: "color 0.2s" }}>⚙</span>
          </button>
        </div>
      </div>

      {/* Main content — paddingTop offsets the fixed header (~60px) */}
      <div className="responsive-main" style={{ maxWidth: 920, margin: "0 auto", padding: "76px 16px 16px", flex: 1 }}>
        {tab === "agent" && <div style={{ animation: "inkDissolve 0.6s ease-out forwards" }}><AIAgent onSaveDeck={handleSaveDeck} providerCfg={providerCfg} inventory={inventory} onUpdateInventory={handleUpdateInventory} onCtx={onCtx} /></div>}
        {tab === "builder" && <div style={{ animation: "inkDissolve 0.6s ease-out forwards" }}><GuidedBuilder onSaveDeck={handleSaveDeck} providerCfg={providerCfg} inventory={inventory} onUpdateInventory={handleUpdateInventory} onCtx={onCtx} /></div>}
        {tab === "arena" && <div style={{ animation: "inkDissolve 0.6s ease-out forwards" }}><Arena vault={vault} setVault={setVault} providerCfg={providerCfg} inventory={inventory} onUpdateInventory={handleUpdateInventory} onCtx={onCtx} /></div>}
        {tab === "vault" && (
          <div style={{ animation: "inkDissolve 0.6s ease-out forwards", padding: 20 }}>
            {compareIds.length === 2 ? (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#c9a84c" }}>⚔ DECK COMPARISON</h2>
                  <button onClick={() => setCompareIds([])} style={xBtn}>← Back to Vault</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
                  {compareIds.map(id => {
                    const d = vault.find(x => x.id === id);
                    return (
                      <div key={id}>
                        <div style={{ fontSize: 14, color: "#c9a84c", fontFamily: "'Cinzel', serif", marginBottom: 10, textAlign: "center" }}>{d.name}</div>
                        <DeckDisplay deck={d.deck} compact={true} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <div style={{ color: "#666", fontSize: 11, fontFamily: "'Cinzel', serif" }}>{vault.length} DECKS IN THE VAULT</div>
                  {compareIds.length === 1 && <div style={{ color: "#c9a84c", fontSize: 11, animation: "pulse 1.5s infinite" }}>Select one more deck to compare...</div>}
                </div>
                {vault.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#666", padding: 40, fontFamily: "'Cinzel', serif" }}>NO DECKS SAVED TO THE VAULT</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
                    {[...vault].reverse().map((d, i) => {
                      const isSelected = compareIds.includes(d.id);
                      return (
                        <div key={d.id || i} style={{ position: "relative" }}>
                          <div
                            onClick={() => {
                              if (isSelected) setCompareIds(compareIds.filter(id => id !== d.id));
                              else if (compareIds.length < 2) setCompareIds([...compareIds, d.id]);
                            }}
                            style={{
                              background: "#0d0d0d",
                              border: isSelected ? "1px solid #c9a84c" : "1px solid #1a1a1a",
                              borderRadius: 10, padding: 14, cursor: "pointer", transition: "all 0.2s",
                              boxShadow: isSelected ? "0 0 15px rgba(201, 168, 76, 0.1)" : "none"
                            }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ fontSize: 16, color: isSelected ? "#c9a84c" : "#888", fontFamily: "'Cinzel', serif", marginBottom: 2 }}>{d.name}</div>
                                  {d.totalPrice > 0 && <span style={{ fontSize: 12, color: "#4DB87A", fontWeight: 700, fontFamily: "'Cinzel', serif" }}>${d.totalPrice.toFixed(0)}</span>}
                                </div>
                                <div style={{ fontSize: 10, color: "#666", marginBottom: 12 }}>{new Date(d.savedAt).toLocaleDateString()}</div>
                              </div>
                              <div style={{
                                width: 14, height: 14, borderRadius: "50%", border: "1px solid #333",
                                background: isSelected ? "#c9a84c" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#000"
                              }}>
                                {isSelected && "✓"}
                              </div>
                            </div>
                            <div style={{ pointerEvents: "none", opacity: isSelected ? 1 : 0.6 }}>
                              <DeckDisplay deck={d.deck} compact={true} onCtx={onCtx} />
                            </div>
                            <button onClick={(e) => {
                              e.stopPropagation();
                              const nv = vault.filter(x => x.id !== d.id);
                              setVault(nv); saveVault(nv);
                              setCompareIds(compareIds.filter(id => id !== d.id));
                            }} style={{ position: "absolute", bottom: 14, right: 14, background: "none", border: "none", color: "#E05A50", cursor: "pointer", fontSize: 14 }}>✕ Remove</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && <SettingsModal config={providerCfg} setConfig={setProviderCfg} onClose={() => setShowSettings(false)} />}

      {/* Save Modal */}
      {saveModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.2s ease" }} onClick={() => setSaveModal(null)}>
          <div style={{ background: "#0c0c0c", border: "1px solid #c9a84c22", borderRadius: 16, padding: 28, width: 400, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", animation: "slideUp 0.3s ease" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #c9a84c15, #c9a84c08)", border: "1px solid #c9a84c22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>💎</div>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#c9a84c", letterSpacing: 2 }}>SAVE TO VAULT</h3>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 8, color: "#555", marginBottom: 5, letterSpacing: 1.5, fontFamily: "'Cinzel', serif" }}>DECK NAME</div>
              <input value={saveName} onChange={e => setSaveName(e.target.value)} autoFocus onKeyDown={e => e.key === "Enter" && confirmSave()}
                style={{ width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 14px", color: "#ccc", fontSize: 14, fontFamily: "'Cinzel', serif", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s" }} />
            </div>
            <div style={{ fontSize: 10, color: "#444", marginBottom: 20, fontFamily: "'Crimson Text', serif" }}>
              {saveModal.mainboard.reduce((a, c) => a + c.qty, 0)} cards · {saveModal.sideboard.reduce((a, c) => a + c.qty, 0)} sideboard
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setSaveModal(null)} style={{ ...xBtn, borderRadius: 8, padding: "8px 16px" }}>Cancel</button>
              <button onClick={confirmSave} style={{ ...xBtn, background: "linear-gradient(135deg, #c9a84c15, #c9a84c08)", color: "#c9a84c", borderColor: "#c9a84c33", borderRadius: 8, padding: "8px 20px", transition: "all 0.25s" }}
                onMouseOver={e => { e.currentTarget.style.borderColor = "#c9a84c55"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(201,168,76,0.1)"; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = "#c9a84c33"; e.currentTarget.style.boxShadow = "none"; }}
              >✦ Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          onClick={() => setContextMenu(null)}
          style={{ position: "fixed", inset: 0, zIndex: 10000 }}
          onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
        >
          <div style={{
            position: "absolute", left: contextMenu.x, top: contextMenu.y,
            minWidth: 180, padding: 6, zIndex: 10001, borderRadius: 12,
            background: "rgba(12,12,12,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.5)",
            animation: "slideUp 0.15s cubic-bezier(0.19, 1, 0.22, 1)"
          }}>
            <div style={{ fontSize: 8, color: "#c9a84c88", padding: "5px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", marginBottom: 4, fontFamily: "'Cinzel', serif", letterSpacing: 1.5 }}>{contextMenu.card.name.toUpperCase()}</div>
            {[
              { label: "🎒 Add to Collection", action: () => handleUpdateInventory(contextMenu.card.name, 1) },
              { label: "🔍 View on Scryfall", action: () => window.open(contextMenu.card.cardData?.scryfall_uri, "_blank") },
            ].map(item => (
              <button
                key={item.label}
                onClick={(e) => { e.stopPropagation(); item.action(); setContextMenu(null); }}
                style={{
                  width: "100%", padding: "8px 12px", textAlign: "left", fontSize: 11, color: "#888",
                  border: "none", background: "transparent", cursor: "pointer", borderRadius: 6,
                  fontFamily: "'Crimson Text', serif", transition: "all 0.15s",
                }}
                onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#ddd"; }}
                onMouseOut={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#888"; }}
              >{item.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
