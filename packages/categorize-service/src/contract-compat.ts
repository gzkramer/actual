// Compile-time check that loot-core's copy of the contract types still
// matches this service's. loot-core can't import them (it's published and
// this package isn't), so the check lives here. Nothing here runs.
import type * as Client from '@actual-app/core/server/smart-categorize/types';

import type * as Service from './contract';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type Assert<T extends true> = T;

export type ContractChecks = [
  Assert<Equal<Client.CategorySuggestion, Service.CategorySuggestion>>,
  Assert<Equal<Client.ClassifyRequest, Service.ClassifyRequest>>,
  Assert<Equal<Client.ClassifyResponseData, Service.ClassifyResponseData>>,
];
