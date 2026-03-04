export const FORMATS = [
  { id: "standard", name: "Standard", deckSize: 60, sb: 15, desc: "Last 2-3 sets" },
  { id: "modern", name: "Modern", deckSize: 60, sb: 15, desc: "8th Ed forward" },
  { id: "pioneer", name: "Pioneer", deckSize: 60, sb: 15, desc: "RTR forward" },
  { id: "legacy", name: "Legacy", deckSize: 60, sb: 15, desc: "All sets + bans" },
  { id: "vintage", name: "Vintage", deckSize: 60, sb: 15, desc: "All + restricted" },
  { id: "pauper", name: "Pauper", deckSize: 60, sb: 15, desc: "Commons only" },
  { id: "commander", name: "Commander", deckSize: 100, sb: 0, desc: "100-card singleton" },
];

export const COLORS = [
  { id: "W", name: "White", sym: "☀", hex: "#F0E6B2" },
  { id: "U", name: "Blue", sym: "💧", hex: "#4DA3D4" },
  { id: "B", name: "Black", sym: "💀", hex: "#A68DA0" },
  { id: "R", name: "Red", sym: "🔥", hex: "#E05A50" },
  { id: "G", name: "Green", sym: "🌿", hex: "#4DB87A" },
];

export const ARCHETYPES = [
  { id: "aggro", name: "Aggro", icon: "⚔️", desc: "Fast damage, low curve" },
  { id: "midrange", name: "Midrange", icon: "🛡️", desc: "Efficient threats, flexible" },
  { id: "control", name: "Control", icon: "🔮", desc: "Answers + late-game power" },
  { id: "combo", name: "Combo", icon: "⚡", desc: "Assemble game-winning pieces" },
  { id: "tempo", name: "Tempo", icon: "🌊", desc: "Cheap threats + disruption" },
  { id: "ramp", name: "Ramp", icon: "🌳", desc: "Accelerate into bombs" },
];

export const AGENT_SYSTEM = `You are Arcanum — the world's most elite Magic: The Gathering deck architect. You have COMPLETE knowledge of every MTG card ever printed (25,000+), every mechanic and interaction, every competitive archetype across all formats, current and historical metagames, optimal mana bases, sideboard strategy, and pricing.

YOUR CAPABILITIES:
1. BUILD OPTIMAL DECKS from scratch — no constraints needed. Find the absolute best card combinations.
2. ANALYZE any deck for weaknesses or missing synergies.
3. RESEARCH current meta to position decks against the field. Use the 'web_search' tool to look up latest tournament results, bans, and trending strategies.
4. FIND hidden combos and interactions most players miss.
5. CONSTRUCT SIDEBOARDS for specific expected metagames.
6. COMPARE strategies with rigorous tradeoff analysis.

WEB SEARCH GUIDELINES:
- Always search if the user asks about the "current" meta, "recent" results, or "best deck right now".
- Use search to find card prices if the user has a budget.
- If you find new cards from recent sets (like Aetherdrift), integrate them into your builds.

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

export const QUICK_PROMPTS = [
  { label: "🏆 Best Modern deck", prompt: "What is the single most competitive Modern deck right now? Build the absolute best list with full sideboard and detailed analysis. No constraints — just the strongest deck in the format." },
  { label: "🔥 Best Pioneer deck", prompt: "Build the #1 tier Pioneer deck. No constraints. Just give me the most competitive list possible." },
  { label: "💰 Budget Modern (<$100)", prompt: "Build me the most competitive Modern deck possible for under $100 total. I want to win FNM on a budget." },
  { label: "💀 Most degenerate combo", prompt: "Find me the most degenerate, unfair combo deck in Modern. I want my opponent to not get to play Magic. Goldfish as fast as possible." },
  { label: "👑 cEDH Commander", prompt: "Build the strongest possible Commander deck. cEDH power level. Full 100 cards with detailed analysis of the combo lines." },
  { label: "🎯 Counter the meta", prompt: "Analyze the current Modern metagame and build a deck specifically designed to prey on the top 3 most popular decks. I want to be the meta-breaker." },
  { label: "🧩 Hidden synergy finder", prompt: "Find me an underplayed or overlooked synergy in Modern that could form the core of a competitive deck nobody is running. Surprise me." },
  { label: "⚡ Fastest kill in Standard", prompt: "What is the absolute fastest possible kill in current Standard? Build a deck that can goldfish a turn 3-4 kill as consistently as possible." },
];
