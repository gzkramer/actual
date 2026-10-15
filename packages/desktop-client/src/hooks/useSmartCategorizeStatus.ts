import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';

import { useSyncServerStatus } from './useSyncServerStatus';

export function useSmartCategorizeStatus() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const status = useSyncServerStatus();

  useEffect(() => {
    async function fetch() {
      setIsLoading(true);
      const result = await send('smart-categorize/status');
      setConfigured(result.configured);
      setIsLoading(false);
    }

    if (status === 'online') {
      void fetch();
    }
  }, [status, version]);

  return {
    configured,
    isLoading,
    refetch: () => setVersion(v => v + 1),
  };
}
