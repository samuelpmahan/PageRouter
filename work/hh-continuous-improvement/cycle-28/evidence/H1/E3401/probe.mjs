import {createFixtureProvider} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createCommunity} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function walk(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  found.push(node);
  for (const child of node.children || []) walk(child, found);
  return found;
}

const fixture = createFixtureProvider({fixture: true, storage: null});
const runtime = createServiceRuntime(fixture);
const community = createCommunity({storage: null});
let tree = null;
const controller = createPublicController({runtime, storage: null, community,
  onChange(state, route) {
    tree = renderPublicSite({route, state, journey: state.journey});
  },
});
const snapshot = (label) => {
  const nodes = walk(tree);
  const controls = nodes
    .filter(node => node.tag === 'button' && node.attrs?.['data-event'] === 'public:retry')
    .map(node => ({id: node.attrs.id || null, label: (node.children || []).join('')}));
  const texts = nodes.filter(node => node.tag === 'p').map(node => (node.children || []).join(''));
  return {
    label,
    route: controller.route.page,
    lookupError: controller.state.journey.lookupError,
    lookupRetryable: controller.state.journey.lookupRetryable,
    matchesStatus: controller.state.journey.matches.status,
    canRetry: controller.canRetry,
    retryControls: controls,
    visibleFailureText: texts.filter(text => /Simulated local school-data failure|Could not load results|try the search again/i.test(text)),
    counties: controller.state.journey.lookups.counties,
  };
};

await controller.initialize('#/directory');
const initial = snapshot('initialized directory');
await controller.dispatch('public:fail-next');
const failed = await controller.selectSchool('state', 'Demo Washington');
const failure = snapshot('retryable school lookup failure');
const retried = await controller.dispatch('public:retry');
const recovered = snapshot('explicit public:retry dispatch');

console.log(JSON.stringify({
  fixtureCapabilities: runtime.capabilities,
  initial,
  selectSchoolResult: {ok: failed.ok, errorCode: failed.error?.code || null},
  failure,
  retryDispatchResult: {ok: retried.ok, errorCode: retried.error?.code || null},
  recovered,
}, null, 2));
