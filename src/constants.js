export const AI_PROVIDERS = [
  {
    id: "groq-free", name: "Groq (Free)", desc: "Llama 3.3 70B — no key needed, shared rate limit", needsKey: false,
    models: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" }], defaultModel: "llama-3.3-70b-versatile"
  },
  {
    id: "groq", name: "Groq", desc: "Your own key — higher rate limits", needsKey: true, url: "https://console.groq.com/keys",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (fast)" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
      { id: "gemma2-9b-it", name: "Gemma 2 9B" },
    ], defaultModel: "llama-3.3-70b-versatile"
  },
  {
    id: "anthropic", name: "Anthropic", desc: "Claude — best quality, paid", needsKey: true, url: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (fast)" },
    ], defaultModel: "claude-sonnet-4-20250514"
  },
  {
    id: "openrouter", name: "OpenRouter", desc: "Access any model — pay per token", needsKey: true, url: "https://openrouter.ai/keys",
    models: [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
      { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3" },
      { id: "mistralai/mistral-medium-3", name: "Mistral Medium 3" },
    ], defaultModel: "anthropic/claude-sonnet-4"
  },
  {
    id: "openai", name: "OpenAI", desc: "GPT-4o — paid", needsKey: true, url: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini (fast)" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    ], defaultModel: "gpt-4o"
  },
];

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

export const SB_GUIDE_SYSTEM = `You are Arcanum — the tactical MTG analyst.
Generate a Sideboard Guide in JSON format for the provided deck against the current meta.
Use the web_search tool to find the current top tier decks if you don't know them.

OUTPUT FORMAT (JSON):
{
  "analysis": "2-3 sentence overview of sideboarding strategy",
  "matchups": [
    {
      "opponent": "Deck Name",
      "in": "Cards to bring in (quantities + names)",
      "out": "Cards to take out (quantities + names)"
    }
  ]
}`;

export const BUDGET_SYSTEM = `You are Arcanum — the MTG budget optimizer.
Analyze the provided deck and suggest replacements for the 3-5 most expensive cards to make it more budget-friendly. 
Alternatively, suggest 'Power Up' replacements if the user wants the most powerful version.

OUTPUT FORMAT (JSON):
{
  "analysis": "Brief budget/power overview",
  "suggestions": [
    { "original": "Card Name", "replacement": "New Card Name", "reason": "Why this swap?" }
  ]
}`;

export const SIM_SYSTEM = `You are Arcanum — the world's most elite MTG match simulator. You simulate games of Magic: The Gathering between two decks with EXTREME realism.

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

export const IMPORT_ANALYSIS_PROMPT = "Please analyze the following imported decklist. Identify any weaknesses, suggest potential improvements, and provide recommendations for enhancements to make this a more competitive deck in its given format. Be specific with card replacements and strategic advice. Here is the deck:\n\n";

export const VAULT_KEY = "arcanum_vault";
export const xBtn = { background: "#0f0f0f", border: "1px solid #1f1f1f", color: "#777", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "'Cinzel', serif" };
