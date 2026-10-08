export * from './core.mjs';
export * from './order.mjs';
export * from './inference.mjs';

import { capabilities as coreCapabilities } from './core.mjs';
import { capabilities as orderCapabilities } from './order.mjs';
import { capabilities as inferenceCapabilities } from './inference.mjs';

export const capabilities = [
  ...coreCapabilities,
  ...orderCapabilities,
  ...inferenceCapabilities
];
