import { useState, useEffect, useCallback, useRef, useMemo } from "react";

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
function DeckDisplay({ deck, onHover }) {
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

  const copyDeck = () => {
    const lines = []; deck.mainboard.forEach(c => lines.push(`${c.qty} ${c.name}`));
    if (deck.sideboard.length) { lines.push(""); lines.push("Sideboard"); deck.sideboard.forEach(c => lines.push(`${c.qty} ${c.name}`)); }
    navigator.clipboard?.writeText(lines.join("\n"));
  };

  return (
    <div style={{ background: "#090909", border: "1px solid #181818", borderRadius: 10, padding: 14, animation: "fadeIn 0.4s ease" }}>
      {/* Stat pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[["Cards", totalM], ["Lands", lands], ["Avg CMC", avg], ["SB", totalS]].map(([l, v]) => (
          <div key={l} style={{ padding: "4px 10px", background: "#0f0f0f", borderRadius: 5, border: "1px solid #1a1a1a" }}>
            <span style={{ fontSize: 9, color: "#555", letterSpacing: 1, textTransform: "uppercase" }}>{l} </span>
            <span style={{ fontSize: 13, color: "#c9a84c", fontFamily: "'Cinzel', serif" }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 14 }}>
        {/* Decklist */}
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
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

        {/* Charts */}
        <div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 6 }}>MANA CURVE</div>
            <CurveChart data={curve} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 6 }}>TYPES</div>
            <TypeBars data={types} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button onClick={copyDeck} style={xBtn}>📋 Copy</button>
        <button onClick={() => {
          const lines = []; deck.mainboard.forEach(c => lines.push(`${c.qty} ${c.name}`));
          if (deck.sideboard.length) { lines.push(""); lines.push("Sideboard"); deck.sideboard.forEach(c => lines.push(`${c.qty} ${c.name}`)); }
          const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" })); a.download = "deck.txt"; a.click();
        }} style={xBtn}>💾 Download</button>
      </div>
    </div>
  );
}

const xBtn = { background: "#0f0f0f", border: "1px solid #1f1f1f", color: "#777", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "'Cinzel', serif" };

// ═══════════════════════════════════════════════════════════
// AGENT CHAT MESSAGE
// ═══════════════════════════════════════════════════════════

function AgentMessage({ msg, onHover }) {
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
              <span key={i} style={{
                fontSize: 10, color: "#666", padding: "2px 8px",
                background: "#0d0d0d", borderRadius: 10, border: "1px solid #1a1a1a",
              }}>🔍 {s}</span>
            ))}
          </div>
        )}
        {msg.loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: "50%", background: "#c9a84c",
                  animation: `pulse 1.4s ease ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 11, color: "#555", fontStyle: "italic" }}>{msg.status || "Thinking..."}</span>
          </div>
        )}
        {msg.content && (
          <div style={{
            color: "#aaa", fontSize: 13, fontFamily: "'Crimson Text', serif",
            lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {msg.content}
          </div>
        )}
        {msg.deck && <div style={{ marginTop: 12 }}><DeckDisplay deck={msg.deck} onHover={onHover} /></div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// AI AGENT — PRIMARY FEATURE
// ═══════════════════════════════════════════════════════════

function AIAgent() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hoveredCard, setHoveredCard] = useState(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const historyRef = useRef([]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Enrich parsed decklist with Scryfall card data
  const enrichDeck = async (parsed, setStatus) => {
    const cache = {};
    const all = [...parsed.mainboard, ...parsed.sideboard];
    let done = 0;

    for (const entry of all) {
      const k = entry.name.toLowerCase();
      if (cache[k]) { entry.cardData = cache[k]; done++; continue; }
      if (["plains","island","swamp","mountain","forest"].includes(k)) {
        cache[k] = { name: entry.name, type_line: "Basic Land — " + entry.name, cmc: 0, colors: [], color_identity: [] };
        entry.cardData = cache[k]; done++; continue;
      }
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
    const userMsg = { role: "user", content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setBusy(true);

    const lid = Date.now();
    setMessages(prev => [...prev, { role: "assistant", loading: true, status: "Analyzing the format and searching for optimal strategies...", _id: lid }]);

    const updateStatus = (s) => setMessages(prev => prev.map(m => m._id === lid ? { ...m, status: s } : m));

    try {
      historyRef.current.push({ role: "user", content: text.trim() });

      updateStatus("Consulting card database and metagame data...");

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: AGENT_SYSTEM,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: historyRef.current,
        }),
      });

      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();

      // Handle stop_reason === "tool_use" — need to continue conversation
      let finalData = data;
      let allContent = [...data.content];
      let loopCount = 0;

      while (finalData.stop_reason === "tool_use" && loopCount < 5) {
        loopCount++;
        // Extract tool uses and build tool results
        const toolUses = finalData.content.filter(b => b.type === "tool_use");
        const searches = toolUses.filter(t => t.name === "web_search").map(t => t.input?.query || "");
        if (searches.length) {
          updateStatus(`Searching: ${searches.join(", ")}...`);
        }

        // Build the continuation with tool results placeholder
        // For web_search, the API handles it server-side, but we need to send back the assistant turn
        historyRef.current.push({ role: "assistant", content: finalData.content });

        // Send tool results (empty for server-side tools)
        const toolResults = toolUses.map(tu => ({
          type: "tool_result",
          tool_use_id: tu.id,
          content: "Search completed.",
        }));

        historyRef.current.push({ role: "user", content: toolResults });

        updateStatus("Processing search results and building strategy...");

        const contResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 8000,
            system: AGENT_SYSTEM,
            tools: [{ type: "web_search_20250305", name: "web_search" }],
            messages: historyRef.current,
          }),
        });

        if (!contResp.ok) break;
        finalData = await contResp.json();
        allContent = [...allContent, ...finalData.content];
      }

      // Extract text and search topics from all content
      let fullText = "";
      let searches = [];

      for (const block of allContent) {
        if (block.type === "text") fullText += block.text;
        if (block.type === "tool_use" && block.name === "web_search") {
          searches.push(block.input?.query || "meta");
        }
      }

      // Store final assistant text in history
      historyRef.current.push({ role: "assistant", content: fullText });

      // Check for decklist
      let deckObj = null;
      let displayText = fullText;

      if (hasDeck(fullText)) {
        updateStatus("Decklist detected — loading card images from Scryfall...");
        const parsed = parseDecklist(fullText);

        // Clean display text
        const si = fullText.indexOf("===DECKLIST_START===");
        const ei = fullText.indexOf("===DECKLIST_END===");
        if (si !== -1 && ei !== -1) {
          displayText = (fullText.substring(0, si).trim() + "\n\n" + fullText.substring(ei + 18).trim()).trim();
        } else {
          displayText = fullText.split("\n").filter(l => !/^\d+x?\s+[A-Z]/.test(l.trim())).join("\n");
          displayText = displayText.replace(/^(Mainboard|Sideboard)\s*$/gm, "").trim();
        }

        deckObj = await enrichDeck(parsed, updateStatus);
      }

      // Replace loading with final message
      setMessages(prev => prev.map(m => m._id === lid ? {
        role: "assistant",
        content: displayText.trim() || null,
        searches: searches.length ? searches : null,
        deck: deckObj,
      } : m));

    } catch (err) {
      setMessages(prev => prev.map(m => m._id === lid ? {
        role: "assistant",
        content: `Something went wrong: ${err.message}. Try again — I won't give up on finding you the perfect deck.`,
      } : m));
    }

    setBusy(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 110px)", position: "relative" }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 0" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "36px 16px", animation: "fadeIn 0.5s ease" }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%", margin: "0 auto 16px",
              background: "linear-gradient(135deg, #c9a84c22, #c9a84c08)",
              border: "1px solid #c9a84c22",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28,
            }}>✦</div>
            <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#c9a84c", marginBottom: 6, letterSpacing: 2 }}>
              ARCANUM AGENT
            </h2>
            <p style={{ fontFamily: "'Crimson Text', serif", color: "#555", fontSize: 13, maxWidth: 480, margin: "0 auto 28px", lineHeight: 1.6 }}>
              Autonomous deck architect with knowledge of every Magic card ever printed.
              I can search the web for current meta data, build decks with zero constraints,
              find hidden combos, and optimize every card slot. Just tell me what you want.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxWidth: 560, margin: "0 auto" }}>
              {QUICK_PROMPTS.map((qp, i) => (
                <button key={i} onClick={() => send(qp.prompt)} style={{
                  padding: "10px 12px", background: "#0d0d0d", border: "1px solid #181818",
                  borderRadius: 8, cursor: "pointer", textAlign: "left", transition: "all 0.2s",
                }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = "#c9a84c33"; e.currentTarget.style.background = "#121008"; }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = "#181818"; e.currentTarget.style.background = "#0d0d0d"; }}
                >
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#c9a84c", letterSpacing: 1 }}>{qp.label}</div>
                  <div style={{ fontSize: 10, color: "#444", marginTop: 3, fontFamily: "'Crimson Text', serif", lineHeight: 1.4 }}>
                    {qp.prompt.substring(0, 70)}...
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => <AgentMessage key={i} msg={msg} onHover={setHoveredCard} />)}
        <div ref={chatEndRef} />
      </div>

      {/* Hover preview */}
      {hoveredCard && (
        <div style={{ position: "fixed", right: 20, top: 90, zIndex: 200, pointerEvents: "none", animation: "fadeIn 0.12s ease" }}>
          <img src={hoveredCard} alt="" style={{ width: 260, borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.9)" }} />
        </div>
      )}

      {/* Input */}
      <div style={{ borderTop: "1px solid #151515", padding: "10px 0 2px" }}>
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-end",
          background: "#0d0d0d", borderRadius: 12, border: "1px solid #1a1a1a",
          padding: "8px 10px", transition: "border-color 0.2s",
        }}
          onFocus={e => e.currentTarget.style.borderColor = "#c9a84c33"}
          onBlur={e => e.currentTarget.style.borderColor = "#1a1a1a"}
        >
          <textarea
            ref={inputRef} value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={busy}
            placeholder={busy ? "Agent is working..." : "Build me the best deck in Modern... / Find a combo that kills on turn 3... / Analyze my list..."}
            rows={1}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#bbb", fontSize: 13, fontFamily: "'Crimson Text', serif",
              resize: "none", lineHeight: 1.5, minHeight: 22, maxHeight: 100,
            }}
            onInput={e => { e.target.style.height = "22px"; e.target.style.height = e.target.scrollHeight + "px"; }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || busy}
            style={{
              width: 34, height: 34, borderRadius: "50%",
              background: input.trim() && !busy ? "linear-gradient(135deg, #c9a84c, #8a6d2f)" : "#1a1a1a",
              border: "none", cursor: input.trim() && !busy ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, color: "#0a0a0a", fontWeight: 700, flexShrink: 0, transition: "all 0.2s",
            }}
          >↑</button>
        </div>
        <div style={{ fontSize: 9, color: "#282828", textAlign: "center", marginTop: 5 }}>
          Web search for live meta · Scryfall for card verification · Multi-turn memory
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// GUIDED BUILDER (compact)
// ═══════════════════════════════════════════════════════════

function GuidedBuilder() {
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
      let cards = []; let pg = 1, more = true;
      while (more && pg <= 3) { log(`Page ${pg}...`); const r = await sfSearch(qp.join(" "), pg); cards.push(...(r.data||[])); more = r.has_more; pg++; await new Promise(r => setTimeout(r, 120)); }
      log(`${cards.length} candidates`);
      if (cfg.colors.length) { const lr = await sfSearch(`f:${cfg.format} t:land id<=${cfg.colors.join("")} -t:basic`, 1); cards.push(...(lr.data||[]).slice(0,25)); }

      setStatus("AI constructing decklist..."); log("Sending to AI...");
      const tops = cards.slice(0,150).map(c => `${c.name} | ${c.mana_cost||""} | ${c.type_line} | ${(c.oracle_text||"").substring(0,100)}`).join("\n");
      const cn = cfg.colors.map(c => COLORS.find(x => x.id===c)?.name).join("/")||"Colorless";
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 4096,
          system: `Build a tournament-competitive ${cfg.format} ${cfg.arch} deck in ${cn}. Size: ${fmt.deckSize}.${fmt.sb?` SB: ${fmt.sb}.`:""} Use ===DECKLIST_START=== and ===DECKLIST_END=== markers. Then provide analysis.`,
          messages: [{ role: "user", content: `Build it.${cfg.strat?` Strategy: ${cfg.strat}`:""}${cfg.meta?` Beat: ${cfg.meta}`:""}${cfg.cmdr?` Commander: ${cfg.cmdr}`:""}\n\nCards:\n${tops}` }],
        }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json(); const text = data.content.map(b => b.text||"").join("\n");
      log("Parsing..."); const parsed = parseDecklist(text); log(`${parsed.mainboard.length}+${parsed.sideboard.length} entries`);

      setStatus("Loading card images..."); const cache = {}; cards.forEach(c => cache[c.name.toLowerCase()] = c);
      for (const e of [...parsed.mainboard, ...parsed.sideboard]) {
        const k = e.name.toLowerCase();
        if (!cache[k] && !["plains","island","swamp","mountain","forest"].includes(k)) {
          const cd = await sfNamed(e.name); if (cd) cache[k] = cd; await new Promise(r => setTimeout(r, 70));
        }
      }
      const enrich = l => l.map(e => ({ ...e, cardData: cache[e.name.toLowerCase()]||null }));
      log("✓ Complete!");
      setDeck({ mainboard: enrich(parsed.mainboard), sideboard: enrich(parsed.sideboard), analysis: parsed.analysis, commander: parsed.commander });
      setPhase("done");
    } catch (e) { setErr(e.message); log(`ERROR: ${e.message}`); }
  };

  if (phase === "done" && deck) return (
    <div style={{ animation: "fadeIn 0.4s", padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#c9a84c" }}>
          {cfg.colors.map(c => COLORS.find(x=>x.id===c)?.sym).join("")} {ARCHETYPES.find(a=>a.id===cfg.arch)?.name}
        </h3>
        <button onClick={() => {setPhase("cfg");setDeck(null);}} style={xBtn}>← Rebuild</button>
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
      <button onClick={build} disabled={!cfg.colors.length} style={{ width:"100%",padding:"12px",background:cfg.colors.length?"linear-gradient(135deg,#c9a84c,#8a6d2f)":"#1a1a1a",border:"none",borderRadius:7,cursor:cfg.colors.length?"pointer":"not-allowed",fontFamily:"'Cinzel', serif",fontSize:13,fontWeight:700,color:cfg.colors.length?"#0a0a0a":"#444",letterSpacing:2 }}>
        ✦ CONSTRUCT ✦
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════

export default function MTGDeckArchitect() {
  const [tab, setTab] = useState("agent");

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
      <div style={{
        padding: "12px 20px", borderBottom: "1px solid #131313",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{
            fontFamily: "'Cinzel', serif", fontSize: 20, fontWeight: 700,
            background: "linear-gradient(135deg, #c9a84c, #f0d68a, #c9a84c)",
            backgroundSize: "200% 100%", animation: "shimmer 8s ease infinite",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: 3,
          }}>✦ ARCANUM</h1>
          <span style={{ color: "#1a1a1a", fontSize: 16 }}>|</span>
          <span style={{ color: "#333", fontSize: 11, fontStyle: "italic" }}>
            Autonomous MTG Deck Architect
          </span>
        </div>

        <div style={{ display: "flex", background: "#0d0d0d", borderRadius: 7, border: "1px solid #181818", overflow: "hidden" }}>
          {[
            { id: "agent", label: "✦ AI Agent" },
            { id: "builder", label: "⚙ Guided" },
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
      </div>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 16px" }}>
        {tab === "agent" ? <AIAgent /> : <GuidedBuilder />}
      </div>
    </div>
  );
}
