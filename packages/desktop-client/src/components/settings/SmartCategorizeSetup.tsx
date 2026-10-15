import { Trans } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';

import { Link } from '#components/common/Link';
import { useSmartCategorizeStatus } from '#hooks/useSmartCategorizeStatus';
import { useSyncServerStatus } from '#hooks/useSyncServerStatus';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

export function SmartCategorizeSetup() {
  const dispatch = useDispatch();
  const serverStatus = useSyncServerStatus();
  const { configured, refetch } = useSmartCategorizeStatus();

  if (serverStatus !== 'online') {
    return (
      <Text style={{ color: theme.warningText }}>
        <Trans>Smart categorization needs a sync server.</Trans>
      </Text>
    );
  }

  if (configured === null) {
    return null;
  }

  const openSetup = () =>
    dispatch(
      pushModal({
        modal: {
          name: 'smart-categorize-init',
          options: { onSuccess: refetch },
        },
      }),
    );

  return (
    // This sits inside the feature toggle's <label>; stop clicks here from
    // also flipping the checkbox.
    <Text onClick={e => e.preventDefault()}>
      {configured ? (
        <Trans>Claude token saved.</Trans>
      ) : (
        <Trans>Not set up yet.</Trans>
      )}{' '}
      <Link variant="text" onClick={openSetup}>
        {configured ? (
          <Trans>Replace token</Trans>
        ) : (
          <Trans>Set up smart categorization</Trans>
        )}
      </Link>
    </Text>
  );
}
