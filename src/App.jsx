import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ═══════════════════════════════════════════════════════════
// AI PROVIDER CONFIG
// ═══════════════════════════════════════════════════════════

const AI_PROVIDERS = [
  { id: "groq-free", name: "Groq (Free)", desc: "Llama 3.3 70B — no key needed, shared rate limit", needsKey: false,
    models: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" }], defaultModel: "llama-3.3-70b-versatile" },
  { id: "groq", name: "Groq", desc: "Your own key — higher rate limits", needsKey: true, url: "https://console.groq.com/keys",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (fast)" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
      { id: "gemma2-9b-it", name: "Gemma 2 9B" },
    ], defaultModel: "llama-3.3-70b-versatile" },
  { id: "anthropic", name: "Anthropic", desc: "Claude — best quality, paid", needsKey: true, url: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (fast)" },
    ], defaultModel: "claude-sonnet-4-20250514" },
  { id: "openrouter", name: "OpenRouter", desc: "Access any model — pay per token", needsKey: true, url: "https://openrouter.ai/keys",
    models: [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
      { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3" },
      { id: "mistralai/mistral-medium-3", name: "Mistral Medium 3" },
    ], defaultModel: "anthropic/claude-sonnet-4" },
  { id: "openai", name: "OpenAI", desc: "GPT-4o — paid", needsKey: true, url: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini (fast)" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    ], defaultModel: "gpt-4o" },
];

function loadProviderConfig() {
  try {
    const raw = localStorage.getItem("arcanum_provider");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { providerId: "groq-free", apiKey: "", model: "" };
}

function saveProviderConfig(cfg) {
  try { localStorage.setItem("arcanum_provider", JSON.stringify(cfg)); } catch {}
}

function getApiHeaders(cfg) {
  const h = { "Content-Type": "application/json" };
  if (cfg?.providerId && cfg.providerId !== "groq-free") {
    h["X-Provider"] = cfg.providerId;
    if (cfg.apiKey) h["X-API-Key"] = cfg.apiKey;
    if (cfg.model) h["X-Model"] = cfg.model;
  } else {
    h["X-Provider"] = "groq-free";
  }
  return h;
}

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const FORMATS = [
  { id: "standard", name: "Standard", deckSize: 60, sb: 15, desc: "Last 2-3 sets" },
  { id: "modern", name: "Modern", deckSize: 60, sb: 15, desc: "8th Ed forward" },
  { id: "pioneer", name: "Pioneer", deckSize: 60, sb: 15, desc: "RTR forward" },
  { id: "legacy", name: "Legacy", deckSize: 60, sb: 15, desc: "All sets + bans" },
  { id: "vintage", name: "Vintage", deckSize: 60, sb: 15, desc: "All + restricted" },
  { id: "pauper", name: "Pauper", deckSize: 60, sb: 15, desc: "Commons only" },
  { id: "commander", name: "Commander", deckSize: 100, sb: 0, desc: "100-card singleton" },
];

const COLORS = [
  { id: "W", name: "White", sym: "☀", hex: "#F0E6B2" },
  { id: "U", name: "Blue", sym: "💧", hex: "#4DA3D4" },
  { id: "B", name: "Black", sym: "💀", hex: "#A68DA0" },
  { id: "R", name: "Red", sym: "🔥", hex: "#E05A50" },
  { id: "G", name: "Green", sym: "🌿", hex: "#4DB87A" },
];

const ARCHETYPES = [
  { id: "aggro", name: "Aggro", icon: "⚔️", desc: "Fast damage, low curve" },
  { id: "midrange", name: "Midrange", icon: "🛡️", desc: "Efficient threats, flexible" },
  { id: "control", name: "Control", icon: "🔮", desc: "Answers + late-game power" },
  { id: "combo", name: "Combo", icon: "⚡", desc: "Assemble game-winning pieces" },
  { id: "tempo", name: "Tempo", icon: "🌊", desc: "Cheap threats + disruption" },
  { id: "ramp", name: "Ramp", icon: "🌳", desc: "Accelerate into bombs" },
];

const AGENT_SYSTEM = `You are Arcanum — the world's most elite Magic: The Gathering deck architect. You have COMPLETE knowledge of every MTG card ever printed (25,000+), every mechanic and interaction, every competitive archetype across all formats, current and historical metagames, optimal mana bases, sideboard strategy, and pricing.

YOUR CAPABILITIES:
1. BUILD OPTIMAL DECKS from scratch — no constraints needed. Find the absolute best card combinations.
2. ANALYZE any deck for weaknesses or missing synergies.
3. RESEARCH current meta to position decks against the field.
4. FIND hidden combos and interactions most players miss.
5. CONSTRUCT SIDEBOARDS for specific expected metagames.
6. COMPARE strategies with rigorous tradeoff analysis.

WHEN BUILDING A DECK, think step-by-step:
- What are the format's best strategies right now?
- What does the metagame look like? What do I need to beat?
- Which cards are the strongest possible includes?
- Is the mana base optimized for consistency?
- Are there primary AND backup win conditions?
- Is every single card slot justified?

MANA BASE — NON-NEGOTIABLE REQUIREMENTS:
Every 60-card deck MUST include 22-26 lands. Every 100-card Commander deck MUST include 35-40 lands. NEVER skip lands.
- Include the correct fetch lands, shock lands, dual lands, and utility lands for the colors
- Always include basic lands (Plains, Island, Swamp, Mountain, Forest) for fetch targets and anti-Blood Moon resilience
- For 1-color: ~20 basics + 2-4 utility lands
- For 2-color: 4 fetches, 2-4 shocks/duals, 2-4 fast lands, 4-6 basics, 1-2 utility
- For 3-color: 8-10 fetches, 3-4 shocks/triomes, 2-3 fast lands, 2-4 basics, 1-2 utility
- Count ALL card types: Creatures, Instants, Sorceries, Enchantments, Artifacts, Planeswalkers, AND Lands
- The decklist is NOT complete without lands. A 60-card deck means ~36 spells + ~24 lands = 60 total

OUTPUT FORMAT FOR DECKLISTS — use EXACTLY this structure:

===DECKLIST_START===
Mainboard
[qty] [exact card name]
...

Sideboard
[qty] [exact card name]
...
===DECKLIST_END===

After the decklist, ALWAYS provide detailed strategic analysis covering: game plan, key synergies, mulligan guide, matchup notes vs top meta decks, and sideboard guide.

Be opinionated. Have strong takes. Explain WHY. Don't hedge — commit to the best builds. If the user asks for "the best deck" with no constraints, deliver the single strongest list you know.`;

const QUICK_PROMPTS = [
  { label: "🏆 Best Modern deck", prompt: "What is the single most competitive Modern deck right now? Build the absolute best list with full sideboard and detailed analysis. No constraints — just the strongest deck in the format." },
  { label: "🔥 Best Pioneer deck", prompt: "Build the #1 tier Pioneer deck. No constraints. Just give me the most competitive list possible." },
  { label: "💰 Budget Modern (<$100)", prompt: "Build me the most competitive Modern deck possible for under $100 total. I want to win FNM on a budget." },
  { label: "💀 Most degenerate combo", prompt: "Find me the most degenerate, unfair combo deck in Modern. I want my opponent to not get to play Magic. Goldfish as fast as possible." },
  { label: "👑 cEDH Commander", prompt: "Build the strongest possible Commander deck. cEDH power level. Full 100 cards with detailed analysis of the combo lines." },
  { label: "🎯 Counter the meta", prompt: "Analyze the current Modern metagame and build a deck specifically designed to prey on the top 3 most popular decks. I want to be the meta-breaker." },
  { label: "🧩 Hidden synergy finder", prompt: "Find me an underplayed or overlooked synergy in Modern that could form the core of a competitive deck nobody is running. Surprise me." },
  { label: "⚡ Fastest kill in Standard", prompt: "What is the absolute fastest possible kill in current Standard? Build a deck that can goldfish a turn 3-4 kill as consistently as possible." },
];

// ═══════════════════════════════════════════════════════════
// SCRYFALL API
// ═══════════════════════════════════════════════════════════

async function sfSearch(q, page = 1) {
  try {
    const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&page=${page}&order=edhrec`);
    return r.ok ? r.json() : { data: [], has_more: false };
  } catch { return { data: [], has_more: false }; }
}

async function sfNamed(name) {
  try {
    const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// DECK PARSING & STATS
// ═══════════════════════════════════════════════════════════

function parseDecklist(text) {
  const res = { mainboard: [], sideboard: [], commander: null, analysis: "" };
  const mm = text.match(/===DECKLIST_START===([\s\S]*?)===DECKLIST_END===/);
  const block = mm ? mm[1] : text;
  const after = mm ? text.slice(text.indexOf("===DECKLIST_END===") + 18).trim() : "";

  let sec = "mainboard";
  for (const line of block.split("\n")) {
    const t = line.trim();
    if (/^side\s*board/i.test(t)) { sec = "sideboard"; continue; }
    if (/^main\s*(board|deck)/i.test(t)) { sec = "mainboard"; continue; }
    if (/^commander/i.test(t)) { sec = "commander"; continue; }
    const m = t.match(/^(\d+)x?\s+(.+?)(?:\s*\/\/.*)?$/);
    if (m) {
      const qty = parseInt(m[1]);
      const name = m[2].replace(/\s*[\[\(].*?[\]\)]\s*/g, "").trim();
      if (sec === "commander") { res.commander = name; sec = "mainboard"; }
      else res[sec].push({ qty, name });
    }
  }

  if (after) { res.analysis = after; }
  else {
    let inA = false;
    for (const l of text.split("\n")) {
      const t = l.trim();
      if (inA) { res.analysis += t + "\n"; continue; }
      if (/^(analysis|strategy|game\s*plan|key syner|matchup|mulligan|pilot|how (to|this)|the deck|this deck)/i.test(t)) {
        inA = true; res.analysis += t + "\n";
      }
    }
  }
  return res;
}

function hasDeck(text) {
  let n = 0;
  for (const l of text.split("\n")) if (/^\d+x?\s+[A-Z]/.test(l.trim())) n++;
  return n >= 8;
}

function computeCurve(cards) {
  const c = {};
  cards.forEach(({ qty, cardData: d }) => {
    if (!d || d.type_line?.includes("Land")) return;
    const k = Math.min(d.cmc || 0, 7); c[k >= 7 ? "7+" : String(k)] = (c[k >= 7 ? "7+" : String(k)] || 0) + qty;
  });
  return c;
}

function computeTypes(cards) {
  const t = {};
  cards.forEach(({ qty, cardData: d }) => {
    if (!d) return;
    const tl = d.type_line || "";
    let tp = "Other";
    for (const x of ["Creature","Instant","Sorcery","Enchantment","Artifact","Planeswalker","Land"])
      if (tl.includes(x)) { tp = x; break; }
    t[tp] = (t[tp] || 0) + qty;
  });
  return t;
}

function manaColor(d) {
  const c = d?.colors || d?.color_identity || [];
  if (!c.length) return "#666";
  if (c.length > 1) return "#c9a84c";
  return { W: "#F0E6B2", U: "#4DA3D4", B: "#A68DA0", R: "#E05A50", G: "#4DB87A" }[c[0]] || "#666";
}

function deckColorIds(deck) {
  const s = new Set();
  deck.mainboard.forEach(c => {
    (c.cardData?.color_identity || c.cardData?.colors || []).forEach(x => s.add(x));
  });
  return [...s];
}

function deckToText(deck) {
  const lines = [];
  // Group by type for clarity
  const typeOrder = ["Creature","Planeswalker","Instant","Sorcery","Enchantment","Artifact","Land","Other"];
  const groups = {};
  deck.mainboard.forEach(c => {
    const tl = c.cardData?.type_line || "";
    let g = "Other";
    for (const x of typeOrder) if (tl.includes(x)) { g = x; break; }
    (groups[g] = groups[g] || []).push(c);
  });
  typeOrder.forEach(g => {
    if (!groups[g]?.length) return;
    const count = groups[g].reduce((s, c) => s + c.qty, 0);
    lines.push(`// ${g}s (${count})`);
    groups[g].forEach(c => lines.push(`${c.qty} ${c.name}`));
  });
  const total = deck.mainboard.reduce((s, c) => s + c.qty, 0);
  const lands = (groups["Land"] || []).reduce((s, c) => s + c.qty, 0);
  lines.push(`// Total: ${total} cards, ${lands} lands`);
  if (deck.sideboard?.length) {
    lines.push(""); lines.push("Sideboard");
    deck.sideboard.forEach(c => lines.push(`${c.qty} ${c.name}`));
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════

const CurveChart = ({ data }) => {
  const max = Math.max(...Object.values(data), 1);
  const keys = ["0","1","2","3","4","5","6","7+"];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 70 }}>
      {keys.map(k => (
        <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
          <span style={{ fontSize: 9, color: "#666", marginBottom: 2 }}>{data[k] || ""}</span>
          <div style={{
            width: "100%", minWidth: 12,
            height: `${Math.max(((data[k] || 0) / max) * 46, 0)}px`,
            background: "linear-gradient(to top, #c9a84c55, #c9a84c)", borderRadius: "2px 2px 0 0",
            transition: "height 0.4s",
          }} />
          <span style={{ fontSize: 8, color: "#444", marginTop: 2 }}>{k}</span>
        </div>
      ))}
    </div>
  );
};

const TypeBars = ({ data }) => {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  const clr = { Creature: "#4DB87A", Instant: "#4DA3D4", Sorcery: "#E05A50", Enchantment: "#A68DA0", Artifact: "#777", Planeswalker: "#c9a84c", Land: "#8B7355", Other: "#444" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {Object.entries(data).sort((a, b) => b[1] - a[1]).map(([tp, ct]) => (
        <div key={tp} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#666", width: 68, textAlign: "right" }}>{tp}</span>
          <div style={{ flex: 1, height: 8, background: "#151515", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${(ct / total) * 100}%`, height: "100%", background: clr[tp] || "#444", borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 9, color: "#555", width: 20, textAlign: "right" }}>{ct}</span>
        </div>
      ))}
    </div>
  );
};

const CardRow = ({ card, onHover }) => {
  const img = card.cardData?.image_uris?.normal || card.cardData?.card_faces?.[0]?.image_uris?.normal;
  return (
    <div
      onMouseEnter={() => img && onHover(img)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: "flex", alignItems: "center", gap: 5, padding: "3px 6px",
        borderRadius: 3, background: "#0c0c0c", cursor: "default",
        borderLeft: `2px solid ${card.cardData ? manaColor(card.cardData) : "#1a1a1a"}`,
      }}
      onMouseOver={e => e.currentTarget.style.background = "#141414"}
      onMouseOut={e => e.currentTarget.style.background = "#0c0c0c"}
    >
      <span style={{ color: "#c9a84c", fontFamily: "monospace", fontSize: 11, minWidth: 16 }}>{card.qty}</span>
      <span style={{ color: "#bbb", fontSize: 12, flex: 1 }}>{card.name}</span>
      {card.cardData && <span style={{ color: "#444", fontSize: 9 }}>{card.cardData.mana_cost?.replace(/[{}]/g, "")}</span>}
    </div>
  );
};

// Full deck display widget
function DeckDisplay({ deck, onHover, compact }) {
  const curve = useMemo(() => computeCurve(deck.mainboard), [deck.mainboard]);
  const types = useMemo(() => computeTypes(deck.mainboard), [deck.mainboard]);
  const totalM = deck.mainboard.reduce((a, c) => a + c.qty, 0);
  const totalS = deck.sideboard.reduce((a, c) => a + c.qty, 0);
  const lands = deck.mainboard.filter(c => c.cardData?.type_line?.includes("Land")).reduce((a, c) => a + c.qty, 0);
  const nl = deck.mainboard.filter(c => c.cardData && !c.cardData.type_line?.includes("Land"));
  const avg = nl.length ? (nl.reduce((a, c) => a + (c.cardData.cmc || 0) * c.qty, 0) / nl.reduce((a, c) => a + c.qty, 0)).toFixed(2) : "—";

  const groups = {};
  const order = ["Creature","Planeswalker","Instant","Sorcery","Enchantment","Artifact","Land","Other"];
  deck.mainboard.forEach(card => {
    const tl = card.cardData?.type_line || "";
    let g = "Other";
    for (const x of order) if (tl.includes(x)) { g = x; break; }
    (groups[g] = groups[g] || []).push(card);
  });

  const copyDeck = () => { navigator.clipboard?.writeText(deckToText(deck)); };

  return (
    <div style={{ background: "#090909", border: "1px solid #181818", borderRadius: 10, padding: compact ? 10 : 14, animation: "fadeIn 0.4s ease" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {[["Cards", totalM], ["Lands", lands], ["Avg CMC", avg], ["SB", totalS]].map(([l, v]) => (
          <div key={l} style={{ padding: "4px 10px", background: "#0f0f0f", borderRadius: 5, border: `1px solid ${l === "Lands" && totalM >= 40 && lands < 20 ? "#E05A5066" : "#1a1a1a"}` }}>
            <span style={{ fontSize: 9, color: "#555", letterSpacing: 1, textTransform: "uppercase" }}>{l} </span>
            <span style={{ fontSize: 13, color: l === "Lands" && totalM >= 40 && lands < 20 ? "#E05A50" : "#c9a84c", fontFamily: "'Cinzel', serif" }}>{v}</span>
          </div>
        ))}
        {totalM >= 40 && lands === 0 && (
          <span style={{ fontSize: 10, color: "#E05A50", fontWeight: 700 }}>⚠ NO LANDS</span>
        )}
        {totalM >= 40 && lands > 0 && lands < 20 && (
          <span style={{ fontSize: 10, color: "#E05A50", fontStyle: "italic" }}>⚠ Low lands</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 200px", gap: 14 }}>
        <div style={{ maxHeight: compact ? 300 : 520, overflowY: "auto" }}>
          <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, marginBottom: 6, fontFamily: "'Cinzel', serif" }}>MAINBOARD</div>
          {order.filter(g => groups[g]).map(g => (
            <div key={g} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "#444", letterSpacing: 1, marginBottom: 2, textTransform: "uppercase" }}>
                {g}s ({groups[g].reduce((a, c) => a + c.qty, 0)})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {groups[g].map((c, i) => <CardRow key={i} card={c} onHover={onHover} />)}
              </div>
            </div>
          ))}
          {deck.sideboard.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: "#c9a84c88", letterSpacing: 2, margin: "12px 0 6px", fontFamily: "'Cinzel', serif" }}>SIDEBOARD</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {deck.sideboard.map((c, i) => <CardRow key={i} card={c} onHover={onHover} />)}
              </div>
            </>
          )}
        </div>

        {!compact && <div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 6 }}>MANA CURVE</div>
            <CurveChart data={curve} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 6 }}>TYPES</div>
            <TypeBars data={types} />
          </div>
        </div>}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button onClick={copyDeck} style={xBtn}>📋 Copy</button>
        <button onClick={() => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([deckToText(deck)], { type: "text/plain" }));
          a.download = "deck.txt"; a.click();
        }} style={xBtn}>💾 Export</button>
      </div>
    </div>
  );
}

const xBtn = { background: "#0f0f0f", border: "1px solid #1f1f1f", color: "#777", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "'Cinzel', serif" };

// ═══════════════════════════════════════════════════════════
// DECK VAULT — Persistent deck storage
// ═══════════════════════════════════════════════════════════

const VAULT_KEY = "arcanum_vault";

function loadVault() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY) || "[]"); } catch { return []; }
}

function saveVault(v) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(v));
}

function serializeDeck(deck) {
  return {
    mainboard: deck.mainboard.map(c => ({ qty: c.qty, name: c.name, cardData: c.cardData ? { name: c.cardData.name, type_line: c.cardData.type_line, cmc: c.cardData.cmc, mana_cost: c.cardData.mana_cost, colors: c.cardData.colors, color_identity: c.cardData.color_identity, image_uris: c.cardData.image_uris, card_faces: c.cardData.card_faces } : null })),
    sideboard: (deck.sideboard || []).map(c => ({ qty: c.qty, name: c.name, cardData: c.cardData ? { name: c.cardData.name, type_line: c.cardData.type_line, cmc: c.cardData.cmc, mana_cost: c.cardData.mana_cost, colors: c.cardData.colors, color_identity: c.cardData.color_identity, image_uris: c.cardData.image_uris, card_faces: c.cardData.card_faces } : null })),
  };
}

// ═══════════════════════════════════════════════════════════
// AGENT CHAT MESSAGE
// ═══════════════════════════════════════════════════════════

function AgentMessage({ msg, onHover, onSaveDeck }) {
  if (msg.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14, animation: "fadeIn 0.25s ease" }}>
        <div style={{
          maxWidth: "78%", padding: "10px 14px", borderRadius: "14px 14px 4px 14px",
          background: "#181210", border: "1px solid #2a2218",
          color: "#d0c8a8", fontSize: 13, fontFamily: "'Crimson Text', serif", lineHeight: 1.6, whiteSpace: "pre-wrap",
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 18, animation: "fadeIn 0.35s ease" }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(135deg, #c9a84c, #8a6d2f)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, color: "#0a0a0a", fontWeight: 700, fontFamily: "'Cinzel', serif", marginTop: 3,
      }}>A</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {msg.searches && msg.searches.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {msg.searches.map((s, i) => (
              <span key={i} style={{ fontSize: 10, color: "#666", padding: "2px 8px", background: "#0d0d0d", borderRadius: 10, border: "1px solid #1a1a1a" }}>🔍 {s}</span>
            ))}
          </div>
        )}
        {msg.loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#c9a84c", animation: `pulse 1.4s ease ${i * 0.2}s infinite` }} />
              ))}
            </div>
            <span style={{ fontSize: 11, color: "#555", fontStyle: "italic" }}>{msg.status || "Thinking..."}</span>
          </div>
        )}
        {msg.content && (
          <div style={{ color: "#aaa", fontSize: 13, fontFamily: "'Crimson Text', serif", lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {msg.content}
          </div>
        )}
        {msg.deck && (
          <div style={{ marginTop: 12 }}>
            <DeckDisplay deck={msg.deck} onHover={onHover} />
            {onSaveDeck && (
              <button onClick={() => onSaveDeck(msg.deck)} style={{ ...xBtn, marginTop: 6, color: "#c9a84c", borderColor: "#c9a84c33" }}>
                💎 Save to Vault
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// AI AGENT — PRIMARY FEATURE
// ═══════════════════════════════════════════════════════════

function AIAgent({ onSaveDeck, providerCfg }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hoveredCard, setHoveredCard] = useState(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const historyRef = useRef([]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const enrichDeck = async (parsed, setStatus) => {
    const cache = {};
    const all = [...parsed.mainboard, ...parsed.sideboard];
    let done = 0;
    for (const entry of all) {
      const k = entry.name.toLowerCase();
      if (cache[k]) { entry.cardData = cache[k]; done++; continue; }
      // Fetch ALL cards from Scryfall including basic lands (for proper images)
      try {
        const cd = await sfNamed(entry.name);
        if (cd) { cache[k] = cd; entry.cardData = cd; }
        done++;
        if (done % 10 === 0) setStatus(`Loading card data (${done}/${all.length})...`);
        await new Promise(r => setTimeout(r, 65));
      } catch { done++; }
    }
    return {
      mainboard: parsed.mainboard.map(e => ({ ...e, cardData: e.cardData || cache[e.name.toLowerCase()] || null })),
      sideboard: parsed.sideboard.map(e => ({ ...e, cardData: e.cardData || cache[e.name.toLowerCase()] || null })),
      commander: parsed.commander, analysis: parsed.analysis,
    };
  };

  const send = async (text) => {
    if (!text.trim() || busy) return;
    setMessages(prev => [...prev, { role: "user", content: text.trim() }]);
    setInput(""); setBusy(true);
    const lid = Date.now();
    setMessages(prev => [...prev, { role: "assistant", loading: true, status: "Analyzing the format and searching for optimal strategies...", _id: lid }]);
    const updateStatus = (s) => setMessages(prev => prev.map(m => m._id === lid ? { ...m, status: s } : m));

    try {
      historyRef.current.push({ role: "user", content: text.trim() });
      updateStatus("Consulting card database and metagame data...");
      let resp;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) { updateStatus(`Rate limited — retrying in ${3 * Math.pow(2, attempt)}s...`); await new Promise(r => setTimeout(r, 3000 * Math.pow(2, attempt))); }
        resp = await fetch("/api/chat", {
          method: "POST", headers: getApiHeaders(providerCfg),
          body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 8000, system: AGENT_SYSTEM, messages: historyRef.current }),
        });
        if (resp.status !== 429) break;
      }
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      let fullText = (data.content || []).map(b => b.text || "").join("\n");
      historyRef.current.push({ role: "assistant", content: fullText });
      let deckObj = null, displayText = fullText;
      if (hasDeck(fullText)) {
        updateStatus("Decklist detected — loading card images from Scryfall...");
        const parsed = parseDecklist(fullText);
        const si = fullText.indexOf("===DECKLIST_START==="), ei = fullText.indexOf("===DECKLIST_END===");
        if (si !== -1 && ei !== -1) displayText = (fullText.substring(0, si).trim() + "\n\n" + fullText.substring(ei + 18).trim()).trim();
        else { displayText = fullText.split("\n").filter(l => !/^\d+x?\s+[A-Z]/.test(l.trim())).join("\n").replace(/^(Mainboard|Sideboard)\s*$/gm, "").trim(); }
        deckObj = await enrichDeck(parsed, updateStatus);
      }
      setMessages(prev => prev.map(m => m._id === lid ? { role: "assistant", content: displayText.trim() || null, deck: deckObj } : m));
    } catch (err) {
      setMessages(prev => prev.map(m => m._id === lid ? { role: "assistant", content: `Something went wrong: ${err.message}. Try again.` } : m));
    }
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 110px)", position: "relative" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 0" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "36px 16px", animation: "fadeIn 0.5s ease" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", margin: "0 auto 16px", background: "linear-gradient(135deg, #c9a84c22, #c9a84c08)", border: "1px solid #c9a84c22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>✦</div>
            <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#c9a84c", marginBottom: 6, letterSpacing: 2 }}>ARCANUM AGENT</h2>
            <p style={{ fontFamily: "'Crimson Text', serif", color: "#555", fontSize: 13, maxWidth: 480, margin: "0 auto 28px", lineHeight: 1.6 }}>
              Build decks, find combos, optimize every card slot. Save decks to your Vault, then pit them against each other in the Arena.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxWidth: 560, margin: "0 auto" }}>
              {QUICK_PROMPTS.map((qp, i) => (
                <button key={i} onClick={() => send(qp.prompt)} style={{ padding: "10px 12px", background: "#0d0d0d", border: "1px solid #181818", borderRadius: 8, cursor: "pointer", textAlign: "left", transition: "all 0.2s" }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = "#c9a84c33"; e.currentTarget.style.background = "#121008"; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = "#181818"; e.currentTarget.style.background = "#0d0d0d"; }}>
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#c9a84c", letterSpacing: 1 }}>{qp.label}</div>
                  <div style={{ fontSize: 10, color: "#444", marginTop: 3, fontFamily: "'Crimson Text', serif", lineHeight: 1.4 }}>{qp.prompt.substring(0, 70)}...</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => <AgentMessage key={i} msg={msg} onHover={setHoveredCard} onSaveDeck={onSaveDeck} />)}
        <div ref={chatEndRef} />
      </div>
      {hoveredCard && <div style={{ position: "fixed", right: 20, top: 90, zIndex: 200, pointerEvents: "none", animation: "fadeIn 0.12s ease" }}><img src={hoveredCard} alt="" style={{ width: 260, borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.9)" }} /></div>}
      <div style={{ borderTop: "1px solid #151515", padding: "10px 0 2px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "#0d0d0d", borderRadius: 12, border: "1px solid #1a1a1a", padding: "8px 10px" }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} disabled={busy}
            placeholder={busy ? "Agent is working..." : "Build me the best deck in Modern... / Find a combo that kills on turn 3..."}
            rows={1} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#bbb", fontSize: 13, fontFamily: "'Crimson Text', serif", resize: "none", lineHeight: 1.5, minHeight: 22, maxHeight: 100 }}
            onInput={e => { e.target.style.height = "22px"; e.target.style.height = e.target.scrollHeight + "px"; }} />
          <button onClick={() => send(input)} disabled={!input.trim() || busy} style={{ width: 34, height: 34, borderRadius: "50%", background: input.trim() && !busy ? "linear-gradient(135deg, #c9a84c, #8a6d2f)" : "#1a1a1a", border: "none", cursor: input.trim() && !busy ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#0a0a0a", fontWeight: 700, flexShrink: 0 }}>↑</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// GUIDED BUILDER (compact — unchanged)
// ═══════════════════════════════════════════════════════════

function GuidedBuilder({ onSaveDeck, providerCfg }) {
  const [cfg, setCfg] = useState({ format: "modern", colors: [], arch: "midrange", strat: "", meta: "", cmdr: "", budget: false });
  const [phase, setPhase] = useState("cfg");
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState([]);
  const [deck, setDeck] = useState(null);
  const [err, setErr] = useState(null);
  const [hov, setHov] = useState(null);
  const logRef = useRef(null);
  const log = useCallback(m => setLogs(p => [...p, { t: new Date().toLocaleTimeString(), m }]), []);
  useEffect(() => { logRef.current && (logRef.current.scrollTop = logRef.current.scrollHeight); }, [logs]);

  const build = async () => {
    setPhase("build"); setErr(null); setLogs([]);
    const fmt = FORMATS.find(f => f.id === cfg.format);
    try {
      setStatus("Querying Scryfall..."); log(`Searching ${cfg.format} ${cfg.colors.join("/")||"C"} ${cfg.arch}...`);
      const qp = [`f:${cfg.format}`];
      if (cfg.colors.length) { qp.push(`id<=${cfg.colors.join("")}`); qp.push(`(${cfg.colors.map(c => `c:${c}`).join(" OR ")})`); }
      let cards = [], pg = 1, more = true;
      while (more && pg <= 3) { log(`Page ${pg}...`); const r = await sfSearch(qp.join(" "), pg); cards.push(...(r.data||[])); more = r.has_more; pg++; await new Promise(r => setTimeout(r, 120)); }
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
      const buildBody = JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, system: `Build a tournament-competitive ${cfg.format} ${cfg.arch} deck in ${cn}. Deck size: EXACTLY ${fmt.deckSize} cards total.${fmt.sb?` Sideboard: EXACTLY ${fmt.sb} cards.`:""}

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
      <DeckDisplay deck={deck} onHover={setHov} />
      {hov && <div style={{ position: "fixed", right: 20, top: 90, zIndex: 200, pointerEvents: "none" }}><img src={hov} alt="" style={{ width: 260, borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.9)" }} /></div>}
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
  const ta = { width: "100%", minHeight: 50, background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 5, padding: 8, color: "#999", fontSize: 11, fontFamily: "'Crimson Text', serif", resize: "vertical" };

  return (
    <div style={{ padding: "8px 0", animation: "fadeIn 0.4s" }}>
      <div style={{ marginBottom: 20 }}><div style={sl}>FORMAT</div><div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>{FORMATS.map(f=><button key={f.id} onClick={()=>setCfg(p=>({...p,format:f.id}))} style={chip(cfg.format===f.id)}>{f.name}</button>)}</div></div>
      <div style={{ marginBottom: 20 }}><div style={sl}>COLORS</div><div style={{ display:"flex",gap:8 }}>{COLORS.map(c=><button key={c.id} onClick={()=>setCfg(p=>({...p,colors:p.colors.includes(c.id)?p.colors.filter(x=>x!==c.id):[...p.colors,c.id]}))} style={{ width:40,height:40,borderRadius:"50%",border:cfg.colors.includes(c.id)?`2px solid ${c.hex}`:"2px solid #222",background:cfg.colors.includes(c.id)?`${c.hex}22`:"#0d0d0d",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",transform:cfg.colors.includes(c.id)?"scale(1.15)":"scale(1)" }}>{c.sym}</button>)}</div></div>
      <div style={{ marginBottom: 20 }}><div style={sl}>ARCHETYPE</div><div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>{ARCHETYPES.map(a=><button key={a.id} onClick={()=>setCfg(p=>({...p,arch:a.id}))} style={chip(cfg.arch===a.id)}>{a.icon} {a.name}</button>)}</div></div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16 }}>
        <div><div style={{fontSize:9,color:"#444",marginBottom:3}}>Strategy</div><textarea value={cfg.strat} onChange={e=>setCfg(p=>({...p,strat:e.target.value}))} placeholder="e.g. graveyard synergies..." style={ta}/></div>
        <div><div style={{fontSize:9,color:"#444",marginBottom:3}}>Beat these decks</div><textarea value={cfg.meta} onChange={e=>setCfg(p=>({...p,meta:e.target.value}))} placeholder="e.g. Burn, Tron..." style={ta}/></div>
      </div>
      <button onClick={build} style={{ width:"100%",padding:"12px",background:"linear-gradient(135deg,#c9a84c,#8a6d2f)",border:"none",borderRadius:7,cursor:"pointer",fontFamily:"'Cinzel', serif",fontSize:13,fontWeight:700,color:"#0a0a0a",letterSpacing:2 }}>
        ✦ CONSTRUCT ✦
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ARENA — Match Simulation Engine
// ═══════════════════════════════════════════════════════════

const SIM_SYSTEM = `You are Arcanum — the world's most elite MTG match simulator. You simulate games of Magic: The Gathering between two decks with EXTREME realism.

For each game, consider: opening hands, mulligans, mana curve efficiency, MANA BASE QUALITY (land count, color fixing, fetch/shock/dual lands), card interactions, matchup dynamics, sideboard impact (games 2-3), tempo, card advantage, and win conditions.

CRITICAL: A deck with too few lands (under 20 in a 60-card deck) will frequently mana-screw and lose. A deck with no lands is NON-FUNCTIONAL and auto-loses every game. Factor land count and mana base quality heavily into simulation results.

You must simulate with nuance — aggro doesn't always beat control. Games involve variance. The better-positioned deck wins MORE often, but upsets happen.

OUTPUT FORMAT — respond with ONLY this JSON structure, no other text:
{
  "games": [
    {
      "game_num": 1,
      "winner": "Deck A",
      "turn_won": 7,
      "key_play": "One-sentence pivotal moment",
      "narrative": "2-3 sentence game summary"
    }
  ],
  "match_winner": "Deck A",
  "match_score": "2-1",
  "mvp_card": "Card that mattered most",
  "analysis": "3-5 sentence detailed analysis of the matchup dynamics, what decided the match, and how each deck performed relative to expectations."
}`;

function Arena({ vault, setVault, providerCfg }) {
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
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            matchData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          } catch { matchData = null; }

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
    return (
      <div style={{
        background: isSelected ? "#12100a" : "#0c0c0c",
        border: `1px solid ${isSelected ? "#c9a84c44" : "#181818"}`,
        borderRadius: 8, padding: 12, cursor: "pointer", transition: "all 0.2s",
        position: "relative", overflow: "hidden",
      }}
        onClick={() => toggle(entry.id)}
        onMouseOver={e => e.currentTarget.style.borderColor = isSelected ? "#c9a84c66" : "#252525"}
        onMouseOut={e => e.currentTarget.style.borderColor = isSelected ? "#c9a84c44" : "#181818"}>
        {isSelected && <div style={{ position: "absolute", top: 6, right: 8, background: "#c9a84c", color: "#0a0a0a", fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 3, fontFamily: "'Cinzel', serif" }}>SELECTED</div>}
        <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          {colors.map(c => <span key={c} style={{ fontSize: 12 }}>{COLORS.find(x => x.id === c)?.sym || "?"}</span>)}
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#c9a84c", fontWeight: 600, flex: 1 }}>{entry.name}</span>
        </div>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>{count} cards · {entry.format || "Modern"}</div>
        <div style={{ fontSize: 9, color: "#333", lineHeight: 1.4 }}>
          {entry.deck.mainboard.filter(c => !c.cardData?.type_line?.includes("Land")).slice(0, 5).map(c => `${c.qty} ${c.name}`).join(" · ")}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          <button onClick={e => { e.stopPropagation(); setViewDeck(entry); }} style={{ ...xBtn, fontSize: 9, padding: "3px 8px" }}>👁 View</button>
          <button onClick={e => { e.stopPropagation(); deleteDeck(entry.id); }} style={{ ...xBtn, fontSize: 9, padding: "3px 8px", color: "#E05A50", borderColor: "#E05A5033" }}>✗</button>
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
          <div style={{ padding: 30, textAlign: "center", background: "#0c0c0c", borderRadius: 8, border: "1px solid #181818" }}>
            <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>💎</div>
            <div style={{ fontSize: 12, color: "#444", fontFamily: "'Crimson Text', serif" }}>Your vault is empty. Build decks with the AI Agent or Guided Builder, then save them here.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {vault.map(entry => <VaultCard key={entry.id} entry={entry} />)}
          </div>
        )}
      </div>

      {/* Config */}
      {selected.length >= 2 && (
        <div style={{ background: "#0c0c0c", border: "1px solid #181818", borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 9, color: "#444", marginBottom: 4 }}>BEST OF</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[1, 3, 5].map(n => (
                  <button key={n} onClick={() => setBestOf(n)} style={{ padding: "5px 12px", borderRadius: 4, border: `1px solid ${bestOf === n ? "#c9a84c44" : "#1a1a1a"}`, background: bestOf === n ? "#c9a84c10" : "#0a0a0a", color: bestOf === n ? "#c9a84c" : "#555", cursor: "pointer", fontSize: 11, fontFamily: "'Cinzel', serif" }}>Bo{n}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#444", marginBottom: 4 }}>MATCHES PER PAIR</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[1, 3, 5, 10].map(n => (
                  <button key={n} onClick={() => setMatchCount(n)} style={{ padding: "5px 12px", borderRadius: 4, border: `1px solid ${matchCount === n ? "#c9a84c44" : "#1a1a1a"}`, background: matchCount === n ? "#c9a84c10" : "#0a0a0a", color: matchCount === n ? "#c9a84c" : "#555", cursor: "pointer", fontSize: 11, fontFamily: "'Cinzel', serif" }}>×{n}</button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "#444", marginBottom: 4 }}>{generatePairs().length} pair(s) × {matchCount} = {generatePairs().length * matchCount} total matches</div>
              <button onClick={runSimulation} disabled={running} style={{ padding: "10px 24px", background: running ? "#1a1a1a" : "linear-gradient(135deg, #E05A50, #c9a84c)", border: "none", borderRadius: 6, cursor: running ? "not-allowed" : "pointer", fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 700, color: running ? "#444" : "#0a0a0a", letterSpacing: 2 }}>
                {running ? "SIMULATING..." : "⚔ BEGIN BATTLE ⚔"}
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
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {standings.map((s, i) => {
              const total = s.wins + s.losses;
              const pct = total ? Math.round((s.wins / total) * 100) : 0;
              const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
              const topMvp = Object.entries(s.mvps).sort((a, b) => b[1] - a[1])[0];
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: i === 0 ? "#0f0e08" : "#0c0c0c", border: `1px solid ${i === 0 ? "#c9a84c22" : "#151515"}`, borderRadius: 6 }}>
                  <span style={{ fontSize: 16, width: 28, textAlign: "center" }}>{medal}</span>
                  <span style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: i === 0 ? "#c9a84c" : "#aaa", flex: 1, fontWeight: 600 }}>{s.name}</span>
                  <div style={{ textAlign: "center", minWidth: 60 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: pct >= 60 ? "#4DB87A" : pct <= 40 ? "#E05A50" : "#888", fontFamily: "'Cinzel', serif" }}>{s.wins}-{s.losses}</div>
                    <div style={{ fontSize: 9, color: "#444" }}>{pct}% WR</div>
                  </div>
                  <div style={{ textAlign: "center", minWidth: 50 }}>
                    <div style={{ fontSize: 11, color: "#666" }}>{s.gamesWon}-{s.gamesLost}</div>
                    <div style={{ fontSize: 8, color: "#333" }}>games</div>
                  </div>
                  {topMvp && <div style={{ fontSize: 9, color: "#555", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>MVP: {topMvp[0]}</div>}
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
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {results.map((r, i) => (
              <div key={i} style={{ background: "#0c0c0c", border: "1px solid #181818", borderRadius: 6, overflow: "hidden" }}>
                <div onClick={() => setExpandedMatch(expandedMatch === i ? null : i)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer" }}
                  onMouseOver={e => e.currentTarget.style.background = "#101010"} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: 11, color: "#c9a84c", fontFamily: "'Cinzel', serif", minWidth: 16 }}>{expandedMatch === i ? "▼" : "▶"}</span>
                  <span style={{ fontSize: 12, color: "#aaa", flex: 1 }}>{r.deckA.name} <span style={{ color: "#333" }}>vs</span> {r.deckB.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#c9a84c", fontFamily: "'Cinzel', serif" }}>{r.score}</span>
                  <span style={{ fontSize: 10, color: "#4DB87A" }}>✦ {r.winnerName}</span>
                </div>
                {expandedMatch === i && (
                  <div style={{ padding: "0 12px 12px", borderTop: "1px solid #151515" }}>
                    {r.games.map((g, j) => (
                      <div key={j} style={{ padding: "6px 0", borderBottom: j < r.games.length - 1 ? "1px solid #0f0f0f" : "none" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: "#555", width: 50 }}>Game {g.game_num}</span>
                          <span style={{ fontSize: 11, color: "#4DB87A", fontWeight: 600 }}>{g.winnerName}</span>
                          <span style={{ fontSize: 9, color: "#333" }}>Turn {g.turn_won}</span>
                        </div>
                        {g.key_play && <div style={{ fontSize: 10, color: "#666", marginTop: 2, fontStyle: "italic" }}>⚡ {g.key_play}</div>}
                        {g.narrative && <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{g.narrative}</div>}
                      </div>
                    ))}
                    {r.mvp && <div style={{ fontSize: 10, color: "#c9a84c", marginTop: 6 }}>MVP: {r.mvp}</div>}
                    {r.analysis && <div style={{ fontSize: 11, color: "#777", marginTop: 6, fontFamily: "'Crimson Text', serif", lineHeight: 1.6 }}>{r.analysis}</div>}
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setViewDeck(null)}>
          <div style={{ maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto", background: "#0a0a0a", borderRadius: 12, padding: 20, border: "1px solid #1a1a1a" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: "#c9a84c" }}>{viewDeck.name}</h3>
              <button onClick={() => setViewDeck(null)} style={{ ...xBtn, fontSize: 14 }}>✕</button>
            </div>
            <DeckDisplay deck={viewDeck.deck} onHover={setHov} />
          </div>
          {hov && <div style={{ position: "fixed", right: 20, top: 90, zIndex: 400, pointerEvents: "none" }}><img src={hov} alt="" style={{ width: 260, borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.9)" }} /></div>}
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
    setLocalCfg(prev => ({ ...prev, providerId: id, model: p?.defaultModel || "", apiKey: id === prev.providerId ? prev.apiKey : "" }));
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
        body: JSON.stringify({ model: "x", max_tokens: 50, system: "Reply with exactly: OK", messages: [{ role: "user", content: "test" }] }),
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

  const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.2s ease" };
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
                  value={localCfg.apiKey}
                  onChange={e => { setLocalCfg(prev => ({ ...prev, apiKey: e.target.value })); setTestStatus(null); }}
                  placeholder={`Paste your ${provider.name} API key...`}
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

        {/* Model selection */}
        {provider.models.length > 1 && (
          <div style={{ marginBottom: 18 }}>
            <div style={label}>MODEL</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {provider.models.map(m => (
                <button key={m.id} onClick={() => setLocalCfg(prev => ({ ...prev, model: m.id }))}
                  style={{
                    padding: "5px 10px", borderRadius: 5, fontSize: 10, cursor: "pointer",
                    fontFamily: "'Cinzel', serif",
                    background: (localCfg.model || provider.defaultModel) === m.id ? "#c9a84c10" : "#080808",
                    border: `1px solid ${(localCfg.model || provider.defaultModel) === m.id ? "#c9a84c44" : "#1a1a1a"}`,
                    color: (localCfg.model || provider.defaultModel) === m.id ? "#c9a84c" : "#555",
                    transition: "all 0.15s",
                  }}>{m.name}</button>
              ))}
            </div>
          </div>
        )}

        {/* Test connection */}
        <div style={{ marginBottom: 20 }}>
          <button onClick={testConnection} disabled={provider.needsKey && !localCfg.apiKey}
            style={{
              padding: "7px 16px", borderRadius: 5, fontSize: 10, cursor: "pointer",
              fontFamily: "'Cinzel', serif", letterSpacing: 1,
              background: "#0a0a0a", border: "1px solid #1a1a1a", color: "#666",
              opacity: provider.needsKey && !localCfg.apiKey ? 0.4 : 1,
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
  const activeProvider = AI_PROVIDERS.find(p => p.id === providerCfg.providerId) || AI_PROVIDERS[0];

  const handleSaveDeck = (deck) => {
    setSaveModal(deck);
    const colors = deckColorIds(deck);
    const colorNames = colors.map(c => COLORS.find(x => x.id === c)?.name || "").join("/");
    setSaveName(colorNames ? `${colorNames} Deck` : "New Deck");
  };

  const confirmSave = () => {
    if (!saveModal || !saveName.trim()) return;
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name: saveName.trim(),
      deck: serializeDeck(saveModal),
      format: "Modern",
      savedAt: new Date().toISOString(),
    };
    const nv = [...vault, entry];
    setVault(nv); saveVault(nv);
    setSaveModal(null); setSaveName("");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ddd", fontFamily: "'Crimson Text', Georgia, serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        ::selection { background: #c9a84c33; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        textarea:disabled { opacity: 0.4; }
        button:hover { filter: brightness(1.1); }
      `}</style>

      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #131313", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 20, fontWeight: 700, background: "linear-gradient(135deg, #c9a84c, #f0d68a, #c9a84c)", backgroundSize: "200% 100%", animation: "shimmer 8s ease infinite", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: 3 }}>✦ ARCANUM</h1>
          <span style={{ color: "#1a1a1a", fontSize: 16 }}>|</span>
          <span style={{ color: "#333", fontSize: 11, fontStyle: "italic" }}>Autonomous MTG Deck Architect</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", background: "#0d0d0d", borderRadius: 7, border: "1px solid #181818", overflow: "hidden" }}>
            {[
              { id: "agent", label: "✦ AI Agent" },
              { id: "builder", label: "⚙ Guided" },
              { id: "arena", label: `⚔ Arena${vault.length ? ` (${vault.length})` : ""}` },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "7px 16px", border: "none", cursor: "pointer",
                background: tab === t.id ? "#c9a84c0f" : "transparent",
                borderBottom: tab === t.id ? "2px solid #c9a84c" : "2px solid transparent",
                fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: 1,
                color: tab === t.id ? "#c9a84c" : "#444", transition: "all 0.2s",
              }}>{t.label}</button>
            ))}
          </div>
          {/* Provider badge + settings */}
          <button onClick={() => setShowSettings(true)} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 10px", background: "#0d0d0d", border: "1px solid #181818",
            borderRadius: 7, cursor: "pointer", transition: "all 0.2s",
          }}
            onMouseOver={e => e.currentTarget.style.borderColor = "#c9a84c33"}
            onMouseOut={e => e.currentTarget.style.borderColor = "#181818"}
          >
            <span style={{ fontSize: 9, color: providerCfg.providerId === "groq-free" ? "#4DB87A" : "#c9a84c", fontFamily: "'Cinzel', serif", letterSpacing: 1 }}>
              {activeProvider.name}
            </span>
            <span style={{ fontSize: 12, color: "#444" }}>⚙</span>
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "0 16px" }}>
        {tab === "agent" && <AIAgent onSaveDeck={handleSaveDeck} providerCfg={providerCfg} />}
        {tab === "builder" && <GuidedBuilder onSaveDeck={handleSaveDeck} providerCfg={providerCfg} />}
        {tab === "arena" && <Arena vault={vault} setVault={setVault} providerCfg={providerCfg} />}
      </div>

      {/* Settings Modal */}
      {showSettings && <SettingsModal config={providerCfg} setConfig={setProviderCfg} onClose={() => setShowSettings(false)} />}

      {/* Save Modal */}
      {saveModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSaveModal(null)}>
          <div style={{ background: "#0d0d0d", border: "1px solid #c9a84c33", borderRadius: 12, padding: 24, width: 380 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#c9a84c", marginBottom: 16, letterSpacing: 2 }}>💎 SAVE TO VAULT</h3>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: 1 }}>DECK NAME</div>
              <input value={saveName} onChange={e => setSaveName(e.target.value)} autoFocus onKeyDown={e => e.key === "Enter" && confirmSave()}
                style={{ width: "100%", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 5, padding: "8px 12px", color: "#bbb", fontSize: 14, fontFamily: "'Cinzel', serif", outline: "none" }} />
            </div>
            <div style={{ fontSize: 10, color: "#444", marginBottom: 16 }}>
              {saveModal.mainboard.reduce((a, c) => a + c.qty, 0)} cards · {saveModal.sideboard.reduce((a, c) => a + c.qty, 0)} sideboard
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setSaveModal(null)} style={xBtn}>Cancel</button>
              <button onClick={confirmSave} style={{ ...xBtn, background: "#c9a84c15", color: "#c9a84c", borderColor: "#c9a84c44" }}>✦ Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
