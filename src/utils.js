import { AI_PROVIDERS, VAULT_KEY } from "./constants";

// ═══════════════════════════════════════════════════════════
// SCRYFALL API
// ═══════════════════════════════════════════════════════════

export async function sfSearch(q) {
  const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`);
  return r.ok ? (await r.json()).data : [];
}
export async function sfNamed(n) {
  const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(n)}`);
  return r.ok ? await r.json() : null;
}

// ═══════════════════════════════════════════════════════════
// DECK PARSING & ANALYSIS
// ═══════════════════════════════════════════════════════════

export function parseDecklist(text) {
  const mainboard = [], sideboard = [], commander = [];
  let isSideboard = false;
  const lines = text.split("\n");
  for (let l of lines) {
    l = l.trim();
    if (!l || l.startsWith("//")) continue;
    if (l.toLowerCase() === "sideboard") { isSideboard = true; continue; }
    const m = l.match(/^(\d+)x?\s+(.+)$/);
    if (m) {
      const entry = { qty: parseInt(m[1]), name: m[2], cardData: null };
      if (isSideboard) sideboard.push(entry); else mainboard.push(entry);
    }
  }
  return { mainboard, sideboard, commander, analysis: "" };
}

export function hasDeck(text) {
  return text.includes("===DECKLIST_START===") || text.includes("Mainboard");
}

export function computeCurve(cards) {
  const curve = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7+": 0 };
  cards.forEach(c => {
    if (!c.cardData || c.cardData.type_line?.includes("Land")) return;
    const cmc = Math.floor(c.cardData.cmc || 0);
    const k = cmc >= 7 ? "7+" : cmc.toString();
    curve[k] += c.qty;
  });
  return curve;
}

export function computeTypes(cards) {
  const t = { Creature: 0, Planeswalker: 0, Land: 0, Battle: 0, Instant: 0, Sorcery: 0, Enchantment: 0, Artifact: 0, Other: 0 };
  cards.forEach(c => {
    const tl = c.cardData?.type_line || "Other";
    let found = false;
    // Prioritize certain types for multi-type cards (e.g. Creature Lands -> Creature, Artifact Lands -> Land)
    const priority = ["Creature", "Planeswalker", "Land", "Battle", "Instant", "Sorcery", "Enchantment", "Artifact"];
    for (const type of priority) {
      if (tl.includes(type)) {
        t[type] += c.qty;
        found = true;
        break;
      }
    }
    if (!found) t.Other += c.qty;
  });
  return t;
}

export const manaColor = (c) => ({ W: "#F0E6B2", U: "#4DA3D4", B: "#A68DA0", R: "#E05A50", G: "#4DB87A" }[c] || "#888");

export function computePrice(cards) {
  return cards.reduce((s, c) => s + (parseFloat(c.cardData?.prices?.usd || 0) * c.qty), 0);
}

export function analyzeManaBase(cards) {
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, Any: 0 };

  cards.forEach(c => {
    if (!c.cardData) return;

    // Calculate Pips
    if (c.cardData.mana_cost) {
      const ms = c.cardData.mana_cost;
      const symbols = ms.match(/\{[WUBRGC]\}/g) || [];
      symbols.forEach(s => {
        const sym = s.replace(/[{}]/g, "");
        if (pips[sym] !== undefined) pips[sym] += c.qty;
      });
    }

    // Calculate Sources
    if (c.cardData.type_line?.includes("Land")) {
      const ci = c.cardData.color_identity || [];
      if (ci.length === 0) {
        sources.C += c.qty;
      } else if (ci.length >= 3) {
        sources.Any += c.qty;
      } else {
        ci.forEach(clr => {
          if (sources[clr] !== undefined) sources[clr] += c.qty;
        });
      }
    }
  });

  return { pips, sources };
}

// ═══════════════════════════════════════════════════════════
// GOLDFISH SIMULATOR
// ═══════════════════════════════════════════════════════════

export function generateDeckArray(deck) {
  const arr = [];
  deck.mainboard.forEach(c => { for (let i = 0; i < c.qty; i++) arr.push(c.name); });
  return arr;
}
export const shuffleArray = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[r[i], r[j]] = [r[j], r[i]]; } return r; };
export const drawHand = (deck, n = 7) => shuffleArray(deck).slice(0, n);

export function exportDeck(deck) {
  const lines = ["Mainboard"];
  deck.mainboard.forEach(c => lines.push(`${c.qty} ${c.name}`));
  if (deck.sideboard?.length) { lines.push("", "Sideboard"); deck.sideboard.forEach(c => lines.push(`${c.qty} ${c.name}`)); }
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${deck.name || "decklist"}.txt`;
  a.click();
}

export function runGoldfishSim(deck, iterations = 1000) {
  const deckArr = generateDeckArray(deck);
  const lands = deck.mainboard.filter(c => c.cardData?.type_line?.includes("Land")).map(c => c.name);
  const results = { avgLandsTurn3: 0, avgLandsTurn4: 0, turn3PlayPct: 0, manaScrewPct: 0 };
  for (let i = 0; i < iterations; i++) {
    const hand = drawHand(deckArr, 7);
    const landInHand = hand.filter(c => lands.includes(c)).length;
    results.avgLandsTurn3 += landInHand + 1.5;
    results.avgLandsTurn4 += landInHand + 2.0;
    if (landInHand >= 2) results.turn3PlayPct++;
    if (landInHand < 2) results.manaScrewPct++;
  }
  return {
    avgLandsTurn3: (results.avgLandsTurn3 / iterations).toFixed(2),
    avgLandsTurn4: (results.avgLandsTurn4 / iterations).toFixed(2),
    turn3PlayPct: Math.round((results.turn3PlayPct / iterations) * 100),
    manaScrewPct: Math.round((results.manaScrewPct / iterations) * 100),
  };
}

// ═══════════════════════════════════════════════════════════
// SHARED HELPERS & AI LOGIC
// ═══════════════════════════════════════════════════════════

export function loadProviderConfig() {
  const saved = localStorage.getItem("arcanum_provider_config");
  return saved ? JSON.parse(saved) : { providerId: "groq-free", modelId: "llama-3.3-70b-versatile", apiKey: "", tavilyKey: "" };
}

export function saveProviderConfig(cfg) {
  localStorage.setItem("arcanum_provider_config", JSON.stringify(cfg));
}

export function getApiHeaders(cfg) {
  const p = AI_PROVIDERS.find(x => x.id === cfg.providerId) || AI_PROVIDERS[0];
  const h = { "Content-Type": "application/json" };
  if (p.id === "anthropic") h["X-Anthropic-Key"] = cfg.apiKey;
  else if (p.id === "openai") h["Authorization"] = `Bearer ${cfg.apiKey}`;
  else if (p.id === "groq") h["X-Groq-Key"] = cfg.apiKey;
  else if (p.id === "openrouter") h["Authorization"] = `Bearer ${cfg.apiKey}`;
  return h;
}

export function deckColorIds(deck) {
  const s = new Set();
  [...deck.mainboard, ...(deck.sideboard || [])].forEach(c => {
    (c.cardData?.color_identity || []).forEach(cc => s.add(cc));
  });
  return Array.from(s);
}

export function deckToText(deck) {
  return [...deck.mainboard, ...(deck.sideboard || [])].map(c => `${c.qty} ${c.name}`).join("\n");
}

export function loadVault() {
  const saved = localStorage.getItem(VAULT_KEY);
  return saved ? JSON.parse(saved) : [];
}

export function saveVault(v) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(v));
}

export function serializeDeck(deck) {
  return {
    mainboard: deck.mainboard.map(c => ({ qty: c.qty, name: c.name, cardData: c.cardData ? { name: c.cardData.name, type_line: c.cardData.type_line, cmc: c.cardData.cmc, mana_cost: c.cardData.mana_cost, colors: c.cardData.colors, color_identity: c.cardData.color_identity, image_uris: c.cardData.image_uris, card_faces: c.cardData.card_faces } : null })),
    sideboard: (deck.sideboard || []).map(c => ({ qty: c.qty, name: c.name, cardData: c.cardData ? { name: c.cardData.name, type_line: c.cardData.type_line, cmc: c.cardData.cmc, mana_cost: c.cardData.mana_cost, colors: c.cardData.colors, color_identity: c.cardData.color_identity, image_uris: c.cardData.image_uris, card_faces: c.cardData.card_faces } : null })),
  };
}

export async function runToolLoop(system, messages, providerCfg, onUpdateStatus) {
  let resp;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) { onUpdateStatus(`Rate limited — retrying in ${3 * Math.pow(2, attempt)}s...`); await new Promise(r => setTimeout(r, 3000 * Math.pow(2, attempt))); }
    resp = await fetch("/api/chat", {
      method: "POST", headers: getApiHeaders(providerCfg),
      body: JSON.stringify({
        max_tokens: 4000,
        system,
        tools: [{
          name: "web_search",
          description: "Search the web for the latest MTG metagame, tournament results, and deck prices.",
          input_schema: {
            type: "object",
            properties: { query: { type: "string", description: "The search query." } },
            required: ["query"]
          }
        }],
        messages
      }),
    });
    if (resp.status !== 429) break;
  }
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  let data = await resp.json();
  let finalData = data;
  let loopCount = 0;
  const history = [...messages];

  while (finalData.stop_reason === "tool_use" && loopCount < 5) {
    loopCount++;
    const toolUses = finalData.content.filter(b => b.type === "tool_use");
    const searches = toolUses.filter(t => t.name === "web_search").map(t => t.input?.query || "");
    if (searches.length) onUpdateStatus(`Searching: ${searches.join(", ")}...`);

    history.push({ role: "assistant", content: finalData.content });

    const toolResults = await Promise.all(toolUses.map(async tu => {
      if (tu.name === "web_search") {
        try {
          const res = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Tavily-Key": providerCfg.tavilyKey || "" },
            body: JSON.stringify({ query: tu.input.query })
          });
          const searchData = await res.json();
          if (!res.ok) throw new Error(searchData.error || "Search failed");
          return { type: "tool_result", tool_use_id: tu.id, content: searchData.content };
        } catch (err) {
          return { type: "tool_result", tool_use_id: tu.id, content: `Search Error: ${err.message}` };
        }
      }
      return { type: "tool_result", tool_use_id: tu.id, content: "Tool not found." };
    }));

    history.push({ role: "user", content: toolResults });
    onUpdateStatus("Processing search results and building strategy...");

    const contResp = await fetch("/api/chat", {
      method: "POST", headers: getApiHeaders(providerCfg),
      body: JSON.stringify({
        max_tokens: 4000, system,
        tools: [{ name: "web_search", description: "...", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }],
        messages: history
      }),
    });

    if (!contResp.ok) break;
    finalData = await contResp.json();
    history.push({ role: "assistant", content: finalData.content });
  }
  return finalData;
}
