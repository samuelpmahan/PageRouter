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

async function scenario(query = null) {
  const fixtureProvider = createFixtureProvider({fixture: true, storage: null});
  const portCalls = {};
  const provider = {...fixtureProvider, services: {}};
  for (const [port, service] of Object.entries(fixtureProvider.services)) {
    provider.services[port] = async input => {
      portCalls[port] = (portCalls[port] || 0) + 1;
      return service(input);
    };
  }
  const runtime = createServiceRuntime(provider);
  const community = createCommunity({storage: null});
  let tree;
  const controller = createPublicController({runtime, storage: null, community,
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  const byId = id => walk(tree).find(node => node.attrs?.id === id);
  const routeLink = page => walk(tree).find(node => node.tag === 'a' && node.attrs?.['data-public-route'] === page);
  const click = async node => {
    if (!node?.attrs?.['data-event']) throw new Error('Rendered event control missing.');
    return controller.dispatch(node.attrs['data-event']);
  };
  await controller.initialize('#/');
  const homeRandomButton = byId('hh-home-random-teacher');
  if (!homeRandomButton || homeRandomButton.attrs['data-event'] !== 'public:random-teacher') throw new Error('Home rendered random-teacher control missing.');
  let search = null;
  if (query !== null) {
    const findLink = byId('hh-home-find-teachers');
    if (!findLink?.attrs.href) throw new Error('Rendered Find Teachers route link missing.');
    await controller.navigate(findLink.attrs.href);
    controller.updateDraft('query', query);
    const form = walk(tree).find(node => node.tag === 'form' && node.attrs?.['data-submit'] === 'public:directory-search');
    if (!form) throw new Error('Rendered directory-search form missing.');
    const payload = {};
    for (const input of walk(form)) {
      const name = input.attrs?.name;
      if (name && typeof input.attrs.value === 'string' && input.attrs.value) payload[name] = input.attrs.value;
    }
    if (payload.query !== query) payload.query = query;
    const result = await controller.dispatch(form.attrs['data-submit'], payload);
    search = {formEvent: form.attrs['data-submit'], payload, ok: result.ok,
      resultIds: controller.state.journey.matches.items.map(item => item.id),
      resultNames: controller.state.journey.matches.items.map(item => item.name)};
    const home = routeLink('home');
    if (!home?.attrs.href) throw new Error('Rendered Home route link missing.');
    await controller.navigate(home.attrs.href);
  }
  const randomControl = byId('hh-home-random-teacher');
  if (!randomControl || randomControl.attrs['data-event'] !== 'public:random-teacher') throw new Error('Home rendered random-teacher control missing after navigation.');
  const result = await click(randomControl);
  const summary = {
    query,
    storageCapability: runtime.capabilities.persistence,
    fixtureCapability: runtime.capabilities.fixture,
    beforeClick: {route: 'home', matchesStatus: controller.state.journey.matches.status,
      matchesIds: controller.state.journey.matches.items.map(item => item.id),
      matchesNames: controller.state.journey.matches.items.map(item => item.name)},
    search,
    renderedAction: {id: randomControl.attrs.id, event: randomControl.attrs['data-event'], label: randomControl.children?.join('') || ''},
    dispatch: {ok: result.ok, errorCode: result.error?.code || null},
    selectedProfileId: controller.route.profileId || null,
    resultingRoute: controller.route.page,
    portCalls,
    runtimeReceiptCount: runtime.inspect().receipts.length,
  };
  return summary;
}

const output = {
  operation: 'volatile-fixture actual rendered-control/form baseline for H1 E3501',
  safety: {provider: 'createFixtureProvider({fixture:true, storage:null})', persistentStorage: false,
    browser: false, server: false, accountOrProfileWrites: false, productionProvider: false},
  scenarios: [await scenario(null), await scenario('Avery'), await scenario('Jordan')],
};
console.log(JSON.stringify(output, null, 2));
