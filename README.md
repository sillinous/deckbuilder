# ✦ Arcanum — AI MTG Deck Architect

An autonomous AI-powered deck architect for Magic: The Gathering with comprehensive knowledge of every card ever printed.

## Features

- **AI Agent** — Conversational deck builder that works with zero constraints. Ask it to find the best deck in any format, discover hidden combos, counter the meta, or build on a budget.
- **Web Search** — Searches live metagame data, tournament results, and tier lists to ensure decks are positioned against the current field.
- **Scryfall Integration** — Every card in the generated decklist is verified and enriched with images, mana costs, and type data from Scryfall's complete MTG database.
- **Guided Builder** — Traditional format/color/archetype selector for structured deck construction.
- **Interactive Deck Display** — Mana curve charts, type distribution breakdowns, card hover previews, copy/download export.

## Tech Stack

- React + Vite
- Claude API (Sonnet 4) with web search tool
- Scryfall API for card data
- Deployed on Netlify

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
