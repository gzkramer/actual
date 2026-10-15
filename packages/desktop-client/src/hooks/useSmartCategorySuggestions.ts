import { useEffect, useState, useSyncExternalStore } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import type { CategorySuggestion } from '@actual-app/core/server/smart-categorize/types';

import { useFeatureFlag } from './useFeatureFlag';

let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion() {
  return version;
}

/** Ask every table showing suggestions to fetch them again. */
export function invalidateSmartCategorySuggestions() {
  version++;
  listeners.forEach(listener => listener());
}

/**
 * Stored low-confidence suggestions for the given transactions, keyed by
 * transaction id. Only uncategorized transactions have entries.
 */
export function useSmartCategorySuggestions(ids: string[]) {
  const enabled = useFeatureFlag('smartCategorization');
  const currentVersion = useSyncExternalStore(subscribe, getVersion);
  const [suggestions, setSuggestions] = useState<
    Record<string, CategorySuggestion[]>
  >({});
  const idsKey = ids.join(',');

  useEffect(() => {
    if (!enabled || idsKey === '') {
      setSuggestions({});
      return;
    }

    let cancelled = false;
    void send('smart-categorize/get-suggestions', {
      ids: idsKey.split(','),
    }).then(result => {
      if (!cancelled) {
        setSuggestions(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, idsKey, currentVersion]);

  return suggestions;
}
