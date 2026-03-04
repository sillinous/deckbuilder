// ═══════════════════════════════════════════════════════════
// SCRYFALL API
// ═══════════════════════════════════════════════════════════

export async function sfSearch(q, page = 1) {
  try {
    const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&page=${page}&order=edhrec`);
    return r.ok ? r.json() : { data: [], has_more: false };
  } catch { return { data: [], has_more: false }; }
}

export async function sfNamed(name) {
  try {
    const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// DECK PARSING & STATS
// ═══════════════════════════════════════════════════════════

export function parseDecklist(text) {
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

export function hasDeck(text) {
  let n = 0;
  for (const l of text.split("\n")) if (/^\d+x?\s+[A-Z]/.test(l.trim())) n++;
  return n >= 8;
}

export function computeCurve(cards) {
  const c = {};
  cards.forEach(({ qty, cardData: d }) => {
    if (!d || d.type_line?.includes("Land")) return;
    const k = Math.min(d.cmc || 0, 7); c[k >= 7 ? "7+" : String(k)] = (c[k >= 7 ? "7+" : String(k)] || 0) + qty;
  });
  return c;
}

export function computeTypes(cards) {
  const t = {};
  cards.forEach(({ qty, cardData: d }) => {
    if (!d) return;
    const tl = d.type_line || "";
    let tp = "Other";
    for (const x of ["Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land"])
      if (tl.includes(x)) { tp = x; break; }
    t[tp] = (t[tp] || 0) + qty;
  });
  return t;
}

export function manaColor(d) {
  const c = d?.colors || d?.color_identity || [];
  if (!c.length) return "#666";
  if (c.length > 1) return "#c9a84c";
  return { W: "#F0E6B2", U: "#4DA3D4", B: "#A68DA0", R: "#E05A50", G: "#4DB87A" }[c[0]] || "#666";
}

export function computePrice(cards) {
  return cards.reduce((sum, { qty, cardData }) => {
    if (!cardData || !cardData.prices) return sum;
    const priceStr = cardData.prices.usd || cardData.prices.usd_foil || "0";
    return sum + (parseFloat(priceStr) * qty);
  }, 0);
}

export function analyzeManaBase(cards) {
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, Any: 0 };

  cards.forEach(({ qty, cardData }) => {
    if (!cardData) return;

    // Count Pips required by spells
    if (!cardData.type_line?.includes("Land") && cardData.mana_cost) {
      const match = cardData.mana_cost.match(/{([WUBRGC])}/g);
      if (match) {
        match.forEach(sym => {
          const color = sym.replace(/[{}]/g, "");
          if (pips[color] !== undefined) pips[color] += qty;
        });
      }
    }

    // Count Sources provided by lands
    if (cardData.type_line?.includes("Land")) {
      const oracle = (cardData.oracle_text || "").toLowerCase();
      const produced = new Set();

      // Basic land types map implicitly
      const tls = (cardData.type_line || "").toLowerCase();
      if (tls.includes("plains")) produced.add("W");
      if (tls.includes("island")) produced.add("U");
      if (tls.includes("swamp")) produced.add("B");
      if (tls.includes("mountain")) produced.add("R");
      if (tls.includes("forest")) produced.add("G");

      // Check oracle text for explicit mana producing or fetching
      if (oracle.includes("add {w}") || oracle.includes("plains")) produced.add("W");
      if (oracle.includes("add {u}") || oracle.includes("island")) produced.add("U");
      if (oracle.includes("add {b}") || oracle.includes("swamp")) produced.add("B");
      if (oracle.includes("add {r}") || oracle.includes("mountain")) produced.add("R");
      if (oracle.includes("add {g}") || oracle.includes("forest")) produced.add("G");
      if (oracle.includes("add {c}")) produced.add("C");
      if (oracle.includes("add one mana of any color") || oracle.includes("add mana of any color")) {
        sources.Any += qty;
      } else {
        produced.forEach(c => { sources[c] += qty; });
      }
    }
  });

  return { pips, sources };
}

// ═══════════════════════════════════════════════════════════
// NEW: SAMPLE HAND GENERATOR UTILITIES
// ═══════════════════════════════════════════════════════════

/**
 * Expands a compressed decklist into an array of individual card objects.
 * E.g., { qty: 4, name: "Bolt" } -> 4x { name: "Bolt", ... }
 */
export function generateDeckArray(mainboard) {
  const deck = [];
  for (const entry of mainboard) {
    for (let i = 0; i < entry.qty; i++) {
      // Create a shallow copy so each card gets a unique instance if needed
      deck.push({ ...entry, _uid: Math.random().toString(36).substr(2, 9) });
    }
  }
  return deck;
}

/**
 * Shuffles an array in place using the Fisher-Yates algorithm.
 */
export function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Draws the top N cards from a shuffled deck array.
 */
export function drawHand(shuffledDeck, size) {
  return shuffledDeck.slice(0, size);
}

// ═══════════════════════════════════════════════════════════
// NEW: DECK EXPORT UTILITIES
// ═══════════════════════════════════════════════════════════

export function exportDeck(deck, format = "text") {
  const lines = [];

  if (format === "arena") {
    // MTG Arena / MTGO format (just plain numbers and names, no grouping)
    deck.mainboard.forEach(c => lines.push(`${c.qty} ${c.name}`));
    if (deck.sideboard?.length) {
      lines.push("");
      lines.push("Sideboard");
      deck.sideboard.forEach(c => lines.push(`${c.qty} ${c.name}`));
    }
  } else {
    // Default Human Readable Text Format
    const typeOrder = ["Creature", "Planeswalker", "Instant", "Sorcery", "Enchantment", "Artifact", "Land", "Other"];
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
      lines.push("");
      lines.push("Sideboard");
      deck.sideboard.forEach(c => lines.push(`${c.qty} ${c.name}`));
    }
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════
// NEW: MONTE CARLO SIMULATION
// ═══════════════════════════════════════════════════════════

export function runGoldfishSim(mainboard, iterations = 1000) {
  const deck = generateDeckArray(mainboard);
  const results = {
    avgLandsTurn3: 0,
    avgLandsTurn4: 0,
    turn3PlayPct: 0,
    manaScrewPct: 0,
  };

  for (let i = 0; i < iterations; i++) {
    const shuffled = shuffleArray(deck);
    let hand = drawHand(shuffled, 7);
    let library = shuffled.slice(7);

    let landsInPlay = 0;
    let turn3Lands = 0;
    let turn4Lands = 0;
    let hasTurn3Play = false;

    // Simulate 4 turns
    for (let turn = 1; turn <= 4; turn++) {
      if (turn > 1) {
        hand.push(library.shift());
      }

      // Play a land if available
      const landIdx = hand.findIndex(c => c.cardData?.type_line?.includes("Land"));
      if (landIdx !== -1) {
        landsInPlay++;
        hand.splice(landIdx, 1);
      }

      // Check for turn 3 play
      if (turn === 3) {
        turn3Lands = landsInPlay;
        // Simple heuristic: can we play something with CMC <= landsInPlay?
        if (hand.some(c => c.cardData && !c.cardData.type_line?.includes("Land") && c.cardData.cmc <= landsInPlay && c.cardData.cmc > 0)) {
          hasTurn3Play = true;
        }
      }
      if (turn === 4) {
        turn4Lands = landsInPlay;
      }
    }

    results.avgLandsTurn3 += turn3Lands;
    results.avgLandsTurn4 += turn4Lands;
    if (hasTurn3Play) results.turn3PlayPct++;
    if (turn4Lands < 3) results.manaScrewPct++;
  }

  return {
    avgLandsTurn3: (results.avgLandsTurn3 / iterations).toFixed(2),
    avgLandsTurn4: (results.avgLandsTurn4 / iterations).toFixed(2),
    turn3PlayPct: Math.round((results.turn3PlayPct / iterations) * 100),
    manaScrewPct: Math.round((results.manaScrewPct / iterations) * 100),
  };
}
