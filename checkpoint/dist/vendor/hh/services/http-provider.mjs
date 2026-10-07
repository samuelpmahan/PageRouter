import {HH_PORTS, HH_HTTP_DECLARATIONS, HH_MESSAGES, failure, initialJourney, deepFreeze} from './contract.mjs';

/** Shape-only adapter. No verified backend connection, requests, or fixture fallback. */
export function createHttpProvider() {
  const services = Object.fromEntries(HH_PORTS.map((port) => [port, async () => failure(port, 'http',
    'unsupported', HH_MESSAGES.unsupported, {data: {declaration: HH_HTTP_DECLARATIONS[port], requestSent: false}})]));
  return Object.freeze({mode: 'http', fixture: false,
    capabilities: deepFreeze({mode: 'http', fixture: false, productionAuthority: 'Python backend when connected',
      services: Object.fromEntries(HH_PORTS.map((port) => [port, {supported: false, reason: 'unverified'}])),
      profileEdit: false, realMail: false, passwordAuthentication: false, payments: false}),
    diagnostics: deepFreeze({connection: 'not-configured', requestsSent: 0}),
    services: Object.freeze(services), snapshot: () => initialJourney('http')});
}
