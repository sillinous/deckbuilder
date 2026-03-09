import { AI_PROVIDERS, VAULT_KEY, SYNERGY_SYSTEM, META_SYSTEM, MATCHUP_SYSTEM, RECOMMEND_SYSTEM } from "./constants";

// ═══════════════════════════════════════════════════════════
// SCRYFALL API
// ═══════════════════════════════════════════════════════════

export async function sfSearch(q) {
  const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`);
  return r.ok ? (await r.json()).data : [];
}
// ─── Card Data Fetching: 4-tier cascade ──────────────────────────────────────
// 1. Scryfall exact name  →  fastest, most detailed
// 2. Scryfall fuzzy name  →  handles AI/typo variants
// 3. Scryfall full-text search  →  catches pre-release / new sets
// 4. magicthegathering.io (MTGJSON-backed)  →  independent second source
export async function sfNamed(n) {
  // 1) Exact match
  try {
    const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(n)}`);
    if (r.ok) return await r.json();
  } catch (_) { /* network error, try next */ }

  // 2) Fuzzy match — handles minor typos or punctuation differences
  try {
    const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(n)}`);
    if (r.ok) return await r.json();
  } catch (_) { /* ignore */ }

  // 3) Full-text search — catches pre-release / very new sets (e.g. TMNT 2026)
  try {
    const searchQ = encodeURIComponent(`!"${n}"`);
    const sr = await fetch(`https://api.scryfall.com/cards/search?q=${searchQ}&order=released&dir=desc`);
    if (sr.ok) {
      const data = await sr.json();
      if (data.data?.length > 0) return data.data[0];
    }
  } catch (_) { /* ignore */ }

  // 4) magicthegathering.io (MTGJSON-backed) — independent second source
  try {
    const r = await fetch(`https://api.magicthegathering.io/v1/cards?name=${encodeURIComponent(n)}&pageSize=5`);
    if (r.ok) {
      const json = await r.json();
      const match = json.cards?.find(c => c.name?.toLowerCase() === n.toLowerCase()) || json.cards?.[0];
      if (match) {
        // Normalize to Scryfall-like format so the rest of the app works
        return {
          name: match.name,
          type_line: match.type,
          mana_cost: match.manaCost || "",
          cmc: match.cmc || 0,
          oracle_text: match.text || "",
          // MTGio cards have multiverseid — use it to build a Gatherer image
          multiverse_ids: match.multiverseid ? [match.multiverseid] : [],
          image_uris: null,  // filled in by getCardImage using Gatherer CDN
          prices: null,
          _mtgio: true,  // flag so we know the image must come from Gatherer
        };
      }
    }
  } catch (_) { /* ignore */ }

  return null;
}

// ─── Image Resolution: 3-tier cascade ──────────────────────────────────────
// 1. Scryfall image_uris (all sizes)
// 2. Scryfall card_faces image_uris (transform/flip/meld cards)
// 3. Gatherer CDN via multiverse_id (works even when Scryfall art isn't loaded yet)
//    URL pattern: https://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=XXX&type=card
export function getCardImage(cd) {
  if (!cd) return null;
  const getUri = (uris) => uris ? (uris.normal || uris.large || uris.png || uris.small) : null;

  // 1) Scryfall top-level image
  const mainImage = getUri(cd.image_uris);
  if (mainImage) return mainImage;

  // 2) Scryfall card_faces (transform, flip, aftermath, meld)
  if (cd.card_faces) {
    for (const face of cd.card_faces) {
      const faceImage = getUri(face.image_uris);
      if (faceImage) return faceImage;
    }
  }

  // 3) Gatherer CDN — works for cards Scryfall knows about but hasn't
  //    uploaded art for yet, or for data sourced from magicthegathering.io
  const mid = cd.multiverse_ids?.[0];
  if (mid) return `https://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=${mid}&type=card`;

  return null;
}


// ═══════════════════════════════════════════════════════════
// DECK PARSING & ANALYSIS
// ═══════════════════════════════════════════════════════════

export function parseDecklist(text) {
  const mainboard = [], sideboard = [], commander = [];
  let isSideboard = false;
  const lines = text.split("\n");

  const parseCmc = (cost) => {
    if (!cost) return 0;
    let cmc = 0;
    const symbols = cost.match(/\{[^}]+\}/g) || [];
    symbols.forEach(s => {
      const val = s.replace(/[{}]/g, "");
      if (/^\d+$/.test(val)) cmc += parseInt(val);
      else if (val.includes("/")) cmc += 1; // Hybrid
      else if (val !== "X") cmc += 1; // Colored or other symbols
    });
    return cmc;
  };

  const mainMap = new Map(), sideMap = new Map();

  for (let l of lines) {
    l = l.trim();
    if (!l || l.startsWith("//")) continue;
    if (l.toLowerCase() === "sideboard") { isSideboard = true; continue; }
    const m = l.match(/^(\d+)x?\s+(.+)$/);
    if (m) {
      const fullPart = m[2];
      const parts = fullPart.split("|").map(p => p.trim());
      const name = parts[0];
      const type = parts[1] || "";
      const cost = parts[2] || "";

      const currentMap = isSideboard ? sideMap : mainMap;
      const existing = currentMap.get(name);

      if (existing) {
        existing.qty += parseInt(m[1]);
        // If the new entry has more data, use it
        if (!existing.cardData && (type || cost)) {
          existing.cardData = {
            name: name,
            type_line: type,
            mana_cost: cost,
            cmc: parseCmc(cost),
            image_uris: null,
            prices: null
          };
        }
      } else {
        currentMap.set(name, {
          qty: parseInt(m[1]),
          name: name,
          cardData: type || cost ? {
            name: name,
            type_line: type,
            mana_cost: cost,
            cmc: parseCmc(cost),
            image_uris: null,
            prices: null
          } : null
        });
      }
    }
  }

  return {
    mainboard: Array.from(mainMap.values()),
    sideboard: Array.from(sideMap.values()),
    commander: commander,
    analysis: ""
  };
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

export function generateOptimalLands(deck, format = "standard") {
  const { pips } = analyzeManaBase([...deck.mainboard, ...(deck.sideboard || [])]);
  const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);
  const colors = Object.entries(pips).filter(([k, v]) => v > 0 && k !== "C").map(([k]) => k);

  if (totalPips === 0) return []; // No spells, can't suggest lands

  const formatCfg = FORMATS.find(f => f.id === format) || FORMATS[0];
  const targetLands = Math.max(1, Math.floor(formatCfg.deckSize * 0.4)); // ~40% lands
  const currentLands = deck.mainboard.filter(c => c.cardData?.type_line?.includes("Land")).reduce((a, c) => a + c.qty, 0);
  const toAdd = targetLands - currentLands;

  if (toAdd <= 0) return [];

  const basics = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
  const suggestions = [];
  let remaining = toAdd;

  // Multi-color fixing basics
  if (colors.length > 1) {
    if (format === "commander") {
      suggestions.push({ name: "Command Tower", qty: 1 });
      remaining--;
    } else if (remaining >= 1) {
      const wildsQty = Math.max(1, Math.floor(toAdd / 6));
      if (wildsQty > 0) {
        suggestions.push({ name: "Terramorphic Expanse", qty: wildsQty });
        remaining -= wildsQty;
      }
    }
  }

  // Distribute basics
  colors.forEach(c => {
    const share = Math.round((pips[c] / totalPips) * remaining);
    if (share > 0) {
      suggestions.push({ name: basics[c], qty: share });
    }
  });

  // Final adjustment to hit exact target
  let currentSuggested = suggestions.reduce((a, c) => a + c.qty, 0);
  while (currentSuggested < toAdd) {
    const top = colors.sort((a, b) => pips[b] - pips[a])[0] || "W";
    const entry = suggestions.find(s => s.name === basics[top]);
    if (entry) entry.qty++; else suggestions.push({ name: basics[top], qty: 1 });
    currentSuggested++;
  }
  while (currentSuggested > toAdd && suggestions.length > 0) {
    const top = suggestions.sort((a, b) => b.qty - a.qty)[0];
    top.qty--;
    currentSuggested--;
  }

  return suggestions.filter(s => s.qty > 0);
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

export function runGoldfishSim(deck, iterations = 500) {
  const deckArr = generateDeckArray(deck);
  const lands = deck.mainboard.filter(c => c.cardData?.type_line?.includes("Land")).map(c => c.name);
  const creatures = deck.mainboard.filter(c => !c.cardData?.type_line?.includes("Land")).map(c => ({
    name: c.name,
    cmc: c.cardData?.cmc || 0,
    power: parseInt(c.cardData?.power) || c.cardData?.cmc || 0
  }));

  const killTurns = [];
  const turnData = {
    manaScrew: 0,
    turn3Land: 0,
    turn4Land: 0,
    dpt: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] // Damage Per Turn (Avg)
  };

  for (let i = 0; i < iterations; i++) {
    const shuf = shuffleArray(deckArr);
    let hand = shuf.slice(0, 7);
    let library = shuf.slice(7);
    let battlefield = [];
    let landCount = 0;
    let totalDamage = 0;
    let killed = false;

    // Simplify: hand is just strings, we need to know what they are
    const getCardInfo = (name) => {
      if (lands.includes(name)) return { type: "land" };
      return creatures.find(c => c.name === name) || { type: "spell", cmc: 0, power: 0 };
    };

    for (let turn = 1; turn <= 10; turn++) {
      if (turn > 1) {
        if (library.length > 0) hand.push(library.shift());
      }

      // 1. Play Land
      const landIdx = hand.findIndex(n => getCardInfo(n).type === "land");
      if (landIdx !== -1) {
        landCount++;
        hand.splice(landIdx, 1);
      }

      // Stats
      if (turn === 3) turnData.turn3Land += landCount;
      if (turn === 4) turnData.turn4Land += landCount;
      if (turn === 3 && landCount < 2) turnData.manaScrew++;

      // 2. Battle (Summoning Sickness check)
      let turnDamage = 0;
      battlefield.forEach(c => {
        if (c.turnPlayed < turn) turnDamage += c.power;
      });
      totalDamage += turnDamage;
      turnData.dpt[turn - 1] += turnDamage;

      if (totalDamage >= 20 && !killed) {
        killTurns.push(turn);
        killed = true;
      }

      // 3. Play highest CMC creature possible
      let availableMana = landCount;
      while (availableMana > 0) {
        let playable = hand.map((n, idx) => ({ ...getCardInfo(n), idx })).filter(c => c.type !== "land" && c.cmc <= availableMana).sort((a, b) => b.cmc - a.cmc);
        if (playable.length > 0) {
          const boss = playable[0];
          battlefield.push({ ...boss, turnPlayed: turn });
          availableMana -= boss.cmc;
          hand.splice(boss.idx, 1);
        } else break;
      }
    }
  }

  const avgKill = killTurns.length ? (killTurns.reduce((a, b) => a + b, 0) / killTurns.length).toFixed(1) : ">10";
  const reliability = Math.round(((iterations - turnData.manaScrew) / iterations) * 100);

  return {
    avgKillTurn: avgKill,
    reliability,
    avgLandsTurn3: (turnData.turn3Land / iterations).toFixed(1),
    avgLandsTurn4: (turnData.turn4Land / iterations).toFixed(1),
    dpt: turnData.dpt.map(d => (d / iterations).toFixed(1))
  };
}

// ═══════════════════════════════════════════════════════════
// SHARED HELPERS & AI LOGIC
// ═══════════════════════════════════════════════════════════

export function loadProviderConfig() {
  const saved = localStorage.getItem("arcanum_provider_config");
  const defaults = { providerId: "groq-free", modelId: "llama-3.3-70b-versatile", apiKey: "", keys: {}, tavilyKey: "" };
  if (!saved) return defaults;
  const cfg = JSON.parse(saved);
  if (!cfg.keys) cfg.keys = {};
  if (cfg.apiKey && cfg.providerId && !cfg.keys[cfg.providerId]) {
    cfg.keys[cfg.providerId] = cfg.apiKey;
  }
  return cfg;
}

export function saveProviderConfig(cfg) {
  localStorage.setItem("arcanum_provider_config", JSON.stringify(cfg));
}

export function getApiHeaders(cfg) {
  const h = { "Content-Type": "application/json" };
  const apiKey = (cfg.keys && cfg.keys[cfg.providerId]) || cfg.apiKey || "";
  h["X-Provider"] = cfg.providerId || "groq-free";
  h["X-API-Key"] = apiKey;
  if (cfg.modelId) h["X-Model"] = cfg.modelId;
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
  const mapCard = c => ({
    qty: c.qty,
    name: c.name,
    cardData: c.cardData ? {
      name: c.cardData.name,
      type_line: c.cardData.type_line,
      cmc: c.cardData.cmc,
      mana_cost: c.cardData.mana_cost,
      colors: c.cardData.colors,
      color_identity: c.cardData.color_identity,
      image_uris: c.cardData.image_uris,
      card_faces: c.cardData.card_faces,
      prices: c.cardData.prices,
      oracle_text: c.cardData.oracle_text,
      rarity: c.cardData.rarity
    } : null
  });

  return {
    mainboard: deck.mainboard.map(mapCard),
    sideboard: (deck.sideboard || []).map(mapCard),
    commander: (deck.commander || []).map(mapCard),
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

export async function aiIdentifySynergies(deck, providerCfg) {
  try {
    const list = deckToText(deck);
    const res = await runToolLoop(SYNERGY_SYSTEM, [{ role: "user", content: `Identify synergies in this deck:\n${list}` }], providerCfg, () => { });
    const textBlob = (res.content || []).map(b => b.text || "").join("");
    const jsonMatch = textBlob.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { synergies: [] };
  } catch { return { synergies: [] }; }
}

export async function fetchMetaDecks(format, providerCfg, onStatus) {
  try {
    const res = await runToolLoop(META_SYSTEM, [{ role: "user", content: `Search for the current top 8 competitive Tier 1 decks for the ${format} format and summarize them.` }], providerCfg, onStatus);
    const textBlob = (res.content || []).map(b => b.text || "").join("");
    const jsonMatch = textBlob.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { decks: [] };
  } catch { return { decks: [] }; }
}

export async function aiAnalyzeMatchups(deck, metaDecks, providerCfg, onStatus) {
  try {
    const list = deckToText(deck);
    const metaStr = JSON.stringify(metaDecks);
    const res = await runToolLoop(MATCHUP_SYSTEM, [{ role: "user", content: `[DECKLIST]:\n${list}\n\n[META_DECKS]:\n${metaStr}` }], providerCfg, onStatus);
    const textBlob = (res.content || []).map(b => b.text || "").join("");
    const jsonMatch = textBlob.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { matchups: [] };
  } catch { return { matchups: [] }; }
}

export async function aiSuggestReplacement(deck, targetCard, providerCfg) {
  try {
    const list = deckToText(deck);
    const res = await runToolLoop(RECOMMEND_SYSTEM, [{ role: "user", content: `[DECKLIST]:\n${list}\n\n[TARGET_CARD]: ${targetCard}` }], providerCfg, () => { });
    const textBlob = (res.content || []).map(b => b.text || "").join("");
    const jsonMatch = textBlob.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { recommendations: [] };
  } catch { return { recommendations: [] }; }
}
