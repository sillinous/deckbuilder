import { useState, useCallback, useRef } from "react";

/**
 * Undo/redo hook for deck editing.
 * @param {Object} initialState - The initial deck state
 * @param {number} maxHistory - Max undo states to keep (default 50)
 */
export default function useUndoRedo(initialState, maxHistory = 50) {
  const [state, setState] = useState(initialState);
  const pastRef = useRef([]);
  const futureRef = useRef([]);

  const set = useCallback((newStateOrFn) => {
    setState(prev => {
      const next = typeof newStateOrFn === "function" ? newStateOrFn(prev) : newStateOrFn;
      if (next === prev) return prev;
      pastRef.current = [...pastRef.current.slice(-(maxHistory - 1)), prev];
      futureRef.current = [];
      return next;
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    setState(prev => {
      if (pastRef.current.length === 0) return prev;
      const previous = pastRef.current[pastRef.current.length - 1];
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [...futureRef.current, prev];
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setState(prev => {
      if (futureRef.current.length === 0) return prev;
      const next = futureRef.current[futureRef.current.length - 1];
      futureRef.current = futureRef.current.slice(0, -1);
      pastRef.current = [...pastRef.current, prev];
      return next;
    });
  }, []);

  const reset = useCallback((newState) => {
    pastRef.current = [];
    futureRef.current = [];
    setState(newState);
  }, []);

  return {
    state,
    set,
    undo,
    redo,
    reset,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    historySize: pastRef.current.length,
  };
}
