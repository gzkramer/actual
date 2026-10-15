import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';

import { Error } from '#components/alerts';
import { Link } from '#components/common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '#components/common/Modal';
import { FormField, FormLabel } from '#components/forms';
import type { Modal as ModalType } from '#modals/modalsSlice';
import { getSecretsError } from '#util/error';

type SmartCategorizeInitialiseModalProps = Extract<
  ModalType,
  { name: 'smart-categorize-init' }
>['options'];

export function SmartCategorizeInitialiseModal({
  onSuccess,
}: SmartCategorizeInitialiseModalProps) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(t('It is required to provide a token.'));

  const onSubmit = async (close: () => void) => {
    const trimmed = token.trim();
    if (!trimmed) {
      setIsValid(false);
      setError(t('It is required to provide a token.'));
      return;
    }

    setIsLoading(true);
    const result = await send('secret-set', {
      name: 'smart_categorize_claudeToken',
      value: trimmed,
    });
    setIsLoading(false);

    if (result?.error) {
      setIsValid(false);
      setError(getSecretsError(result.error, result.reason));
      return;
    }

    onSuccess?.();
    close();
  };

  return (
    <Modal
      name="smart-categorize-init"
      containerProps={{ style: { width: 360 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Set up smart categorization')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ display: 'flex', gap: 10 }}>
            <Text>
              <Trans>
                Smart categorization uses your Claude subscription. On a
                computer with{' '}
                <Link
                  variant="external"
                  to="https://docs.anthropic.com/en/docs/claude-code/setup"
                  linkColor="purple"
                >
                  Claude Code
                </Link>{' '}
                installed, run <code>claude setup-token</code> and paste the
                token it prints here.
              </Trans>
            </Text>
            <Text>
              <Trans>
                The token is stored on your sync server and is used for every
                user of this server. Only a server admin can change it.
              </Trans>
            </Text>

            <FormField>
              <FormLabel
                title={t('Claude token:')}
                htmlFor="claude-token-field"
              />
              <Input
                id="claude-token-field"
                type="password"
                value={token}
                onChangeValue={value => {
                  setToken(value);
                  setIsValid(true);
                }}
              />
            </FormField>

            {!isValid && <Error>{error}</Error>}
          </View>

          <ModalButtons>
            <ButtonWithLoading
              variant="primary"
              autoFocus
              isLoading={isLoading}
              onPress={() => {
                void onSubmit(() => state.close());
              }}
            >
              <Trans>Save</Trans>
            </ButtonWithLoading>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
}
