import { useState, useMemo, useCallback } from "react";

const SORT_OPTIONS = [
  { id: "type", label: "Type" },
  { id: "cmc", label: "CMC" },
  { id: "name", label: "Name" },
  { id: "price", label: "Price" },
  { id: "color", label: "Color" },
  { id: "rarity", label: "Rarity" },
];

const RARITY_ORDER = { mythic: 0, rare: 1, uncommon: 2, common: 3 };

/**
 * Search, filter, and sort for deck card lists.
 */
export default function useDeckFilters(cards) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("type");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterType, setFilterType] = useState(null); // null = all

  const toggleSort = useCallback((field) => {
    if (sortBy === field) setSortAsc(v => !v);
    else { setSortBy(field); setSortAsc(true); }
  }, [sortBy]);

  const filteredCards = useMemo(() => {
    let result = [...cards];

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.cardData?.type_line || "").toLowerCase().includes(q) ||
        (c.cardData?.oracle_text || "").toLowerCase().includes(q)
      );
    }

    // Filter by type
    if (filterType) {
      result = result.filter(c => (c.cardData?.type_line || "").includes(filterType));
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "cmc":
          cmp = (a.cardData?.cmc || 0) - (b.cardData?.cmc || 0);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "price": {
          const pa = parseFloat(a.cardData?.prices?.usd || a.cardData?.prices?.usd_foil || 0);
          const pb = parseFloat(b.cardData?.prices?.usd || b.cardData?.prices?.usd_foil || 0);
          cmp = pb - pa; // Default expensive first
          break;
        }
        case "color": {
          const ca = (a.cardData?.mana_cost || "").length;
          const cb = (b.cardData?.mana_cost || "").length;
          cmp = ca - cb;
          break;
        }
        case "rarity": {
          const ra = RARITY_ORDER[a.cardData?.rarity] ?? 4;
          const rb = RARITY_ORDER[b.cardData?.rarity] ?? 4;
          cmp = ra - rb;
          break;
        }
        default: // "type" — keep original grouped order
          cmp = 0;
      }
      return sortAsc ? cmp : -cmp;
    });

    return result;
  }, [cards, searchQuery, sortBy, sortAsc, filterType]);

  return {
    searchQuery, setSearchQuery,
    sortBy, setSortBy: toggleSort,
    sortAsc,
    filterType, setFilterType,
    filteredCards,
    SORT_OPTIONS,
  };
}
