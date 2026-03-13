import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "./api.js";

/**
 * Hook that syncs state to the server-side JSON store.
 * Data is loaded once on mount and written back on every change.
 */
export function useStore<T>(key: string, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  const skipNextSave = useRef(true); // skip the initial save after load

  // Load from server on mount
  useEffect(() => {
    let cancelled = false;
    api.storeGet<T>(key)
      .then((val) => {
        if (!cancelled) {
          setData(val);
          skipNextSave.current = true;
          setLoaded(true);
        }
      })
      .catch(() => {
        // Key doesn't exist yet — use fallback
        if (!cancelled) {
          skipNextSave.current = false;
          setLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [key]);

  // Persist to server whenever data changes (after initial load)
  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    api.storePut(key, data).catch(() => {
      // Silent fail — server might be unreachable momentarily
    });
  }, [data, loaded, key]);

  const update = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setData((prev) => {
        const next = typeof updater === "function" ? (updater as (prev: T) => T)(prev) : updater;
        return next;
      });
    },
    []
  );

  return [data, update, loaded] as const;
}
