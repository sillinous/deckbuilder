import { useEffect } from "react";

/**
 * Global keyboard shortcut handler.
 * @param {Object} shortcuts - Map of key combos to callbacks
 *   e.g. { "ctrl+s": () => save(), "Escape": () => close() }
 * @param {boolean} enabled - Whether shortcuts are active
 */
export default function useKeyboardShortcuts(shortcuts, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e) => {
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push("ctrl");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");

      const key = e.key === " " ? "Space" : e.key;
      parts.push(key.toLowerCase());
      const combo = parts.join("+");

      // Also try without modifiers for simple keys like Escape
      const simpleKey = key;

      if (shortcuts[combo]) {
        e.preventDefault();
        shortcuts[combo](e);
      } else if (shortcuts[simpleKey] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only fire simple key shortcuts if no modifier is held
        // and the target isn't an input/textarea
        const tag = e.target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        shortcuts[simpleKey](e);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts, enabled]);
}
