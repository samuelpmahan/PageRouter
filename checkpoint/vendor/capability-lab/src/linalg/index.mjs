export * from './basics.mjs';
export * from './numerics.mjs';

import { basicCapabilities } from './basics.mjs';
import { numericalCapabilities } from './numerics.mjs';

export { basicCapabilities, numericalCapabilities };
export const capabilities = [...basicCapabilities, ...numericalCapabilities];
