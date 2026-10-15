import { useState } from 'react';
import { DialogTrigger } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgLightBulb } from '@actual-app/components/icons/v1';
import { Menu } from '@actual-app/components/menu';
import { Popover } from '@actual-app/components/popover';
import { theme } from '@actual-app/components/theme';
import { send } from '@actual-app/core/platform/client/connection';
import type { CategorySuggestion } from '@actual-app/core/server/smart-categorize/types';

import { invalidateSmartCategorySuggestions } from '#hooks/useSmartCategorySuggestions';

type SmartCategorySuggestionProps = {
  transactionId: string;
  suggestions: CategorySuggestion[];
  onSelectCategory: (categoryId: string) => void;
};

export function SmartCategorySuggestion({
  transactionId,
  suggestions,
  onSelectCategory,
}: SmartCategorySuggestionProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const items = suggestions.map(suggestion => ({
    name: suggestion.categoryId ?? '',
    text: `${suggestion.category} — ${suggestion.confidence}%`,
    tooltip: suggestion.rationale,
    disabled: suggestion.categoryId == null,
  }));

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        variant="bare"
        aria-label={t('Show suggested categories')}
        data-testid="smart-category-suggestion"
        style={{ padding: 2, marginRight: 4, color: theme.warningText }}
      >
        <SvgLightBulb style={{ width: 12, height: 12 }} />
      </Button>
      <Popover placement="bottom start" style={{ minWidth: 220 }}>
        <Menu
          header={
            <div
              style={{ padding: '8px 10px 4px', color: theme.pageTextLight }}
            >
              <Trans>Suggested categories</Trans>
            </div>
          }
          items={items}
          onMenuSelect={categoryId => {
            if (!categoryId) {
              return;
            }
            setIsOpen(false);
            onSelectCategory(categoryId);
            void send('smart-categorize/clear', { id: transactionId }).then(
              invalidateSmartCategorySuggestions,
            );
          }}
        />
      </Popover>
    </DialogTrigger>
  );
}
