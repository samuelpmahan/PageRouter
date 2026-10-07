import { PXC_SCENE_HOST_API } from '../scene-host.mjs';

const fieldCalculations = Object.freeze({
  'fn.studio.graphicFields': ({ disc, resolved }) => {
    const fields = [
      { path: 'disc.photo', type: 'image', label: 'Depiction', value: disc.depiction.src },
      { path: 'disc.mold.manufacturer.name', label: 'Manufacturer', value: resolved.manufacturer },
      { path: 'disc.mold.name', label: 'Mold', value: resolved.name },
      { path: 'disc.nickname', label: 'Nickname', value: disc.nickname },
    ];
    for (const key of ['speed', 'glide', 'turn', 'fade']) fields.push({ path: `disc.mold.flight.${key}`, label: key, value: resolved[key], type: 'number' });
    return fields;
  },
  'fn.studio.graphicArt': ({ disc, art }) => ({ kind: 'photo', src: art, sourceKind: disc.depiction.kind }),
});
const sceneCalculationAddresses = Object.freeze([
  'fn.studio.graphicFields', 'fn.studio.graphicArt', 'fn.studio.card',
  'fn.pxcube.scenePlacement', 'fn.studio.graphic',
]);

function placementCalculation(composeOverlay) {
  return ({ card, frame, design }) => {
    if (!['landscape', 'portrait'].includes(design.orientation) ||
        !['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-right'].includes(design.placement)) throw Error('Choose a supported orientation and placement.');
    return composeOverlay({ cards: { single: card }, frame, layout: {
      orientation: design.orientation, arrangement: 'row', anchor: design.placement,
      scale: Number(design.scale) || 1, gap: 0,
    } });
  };
}

const saveOutputs = operation => [
  `ds.px.draft.${operation}`, `ds.px.depiction.${operation}`, `ds.px.recipe.${operation}`,
  `ds.px.photo.${operation}`, `ds.px.choice.${operation}`, `ds.px.disc.${operation}`,
  `ds.px.resolved.${operation}`, `ds.px.art.${operation}`,
  `ds.px.stage.${operation}`, `ds.px.tick.${operation}.specialize`,
  `ds.px.tick.${operation}.depict`, `ds.px.tick.${operation}.retain`,
  `ds.px.shelf.${operation}`, `ds.px.receipt.${operation}`,
];

export function installDiscStudioSceneCalculations(experience, { Part, composeCard, composeOverlay, materializeOverlay } = {}) {
  const pxc = experience?.pxc;
  if (!pxc || typeof pxc.set !== 'function' || typeof pxc.entries !== 'function') throw Error('DiscStudio PxC store required.');
  if (typeof Part !== 'function' || typeof composeCard !== 'function' || typeof composeOverlay !== 'function' || typeof materializeOverlay !== 'function')
    throw Error('The Part-first handler must supply its Part type and existing Studio renderer Calculations.');
  const calculationParts = {
    ...fieldCalculations,
    'fn.studio.card': composeCard,
    'fn.pxcube.scenePlacement': placementCalculation(composeOverlay),
    'fn.studio.graphic': ({ scene, frame }) => materializeOverlay({ scene, frame }),
  };
  for (const [address, calculation] of Object.entries(calculationParts)) {
    if (pxc.entries().some(([candidate]) => candidate === address)) throw Error(`Calculation already installed: ${address}`);
    pxc.set(address, new Part(calculation));
  }
  return sceneCalculationAddresses;
}

// The scene is an adapter around the existing DiscStudio save Calculations and
// renderer. It records the fixture photo as supplied; it does not classify it.
export function discStudioPhotoCardScene({ id = 'photo-card-placement', photoAddress = `ds.px.scene.${id}.photo-input`,
  designAddress = `ds.px.scene.${id}.design`, presetAddress = `ds.px.scene.${id}.preset`, frameAddress = `ds.px.scene.${id}.frame` } = {}) {
  const operation = 'save-1';
  const prefix = `ds.px.scene.${id}`;
  const fields = `${prefix}.fields`, art = `${prefix}.art`, card = `${prefix}.card`, placementPart = `${prefix}.placement`, graphic = `${prefix}.graphic`;
  const outputs = [...saveOutputs(operation), fields, art, card, placementPart, graphic];
  return Object.freeze({
    api: PXC_SCENE_HOST_API,
    id,
    services: ['discstudio.experience'],
    requires: [{ address: 'ds.px.seed.buzzz', scope: 'provider' }, { address: 'ds.px.shelf.0', scope: 'provider' },
      { address: photoAddress, scope: 'world' }, { address: designAddress, scope: 'world' },
      { address: presetAddress, scope: 'world' }, { address: frameAddress, scope: 'world' }],
    calculations: ['fn.paintRecipe', 'oc.create', 'fn.read', 'fn.renderDepiction', 'fn.addToShelf', 'fn.tick',
      ...sceneCalculationAddresses],
    provides: outputs.map(address => ({ address, scope: 'world' })),
    async mount(ctx) {
      if (!await ctx.has('ds.px.seed.buzzz')) throw Error('The DiscStudio Buzzz seed is unavailable.');
      const experience = ctx.service('discstudio.experience');
      if (!experience || typeof experience.save !== 'function') throw Error('The world has no live DiscStudio producer.');
      const seed = await ctx.get('ds.px.seed.buzzz');
      const photo = await ctx.get(photoAddress);
      if (typeof photo !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo)) throw Error('The photo input Part must hold a base64 image.');
      const design = (await ctx.get(designAddress));
      const depiction = Object.freeze({ kind: 'photo', name: 'scene-input-photo', src: photo });
      const draft = Object.freeze({
        mold: 'ds.px.seed.buzzz', nickname: '', weight: 170, plastic: 'Photo study',
        Color1: '#98d4ba', Color2: '#f8b393', paintMode: 'split', colorPainting: false,
        speed: seed.speed, glide: seed.glide, turn: seed.turn, fade: seed.fade,
      });
      const discAddress = await experience.save(draft, depiction, { photo: depiction });
      if (discAddress !== `ds.px.disc.${operation}`) throw Error(`Expected a fresh DiscStudio world; encountered ${discAddress}.`);
      const disc = discAddress, resolved = `ds.px.resolved.${operation}`, savedArt = `ds.px.art.${operation}`;
      await ctx.compose({ into: fields, calculation: 'fn.studio.graphicFields', inputs: { disc, resolved } });
      await ctx.compose({ into: art, calculation: 'fn.studio.graphicArt', inputs: { disc, art: savedArt } });
      await ctx.compose({ into: card, calculation: 'fn.studio.card', inputs: {
        fields, art, preset: presetAddress,
      } });
      await ctx.compose({ into: placementPart, calculation: 'fn.pxcube.scenePlacement', inputs: {
        card, frame: frameAddress, design: designAddress,
      } });
      await ctx.compose({ into: graphic, calculation: 'fn.studio.graphic', inputs: { scene: placementPart, frame: frameAddress } });
      const rendered = await ctx.output(graphic);
      return Object.freeze({ inputPhoto: photoAddress, disc, photoPart: `ds.px.photo.${operation}`, art: savedArt,
        card, placement: placementPart, graphic, dimensions: [rendered.width, rendered.height] });
    },
  });
}
