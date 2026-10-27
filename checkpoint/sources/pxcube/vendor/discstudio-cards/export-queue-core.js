// Environment-neutral queue and manifest semantics shared by Node and browser export.
                                       
import { identityTransform } from './transform-geometry.mjs?v=28ac2b39fab85255';

                                                        
export const orientations                             = ['horizontal', 'vertical'];
                                                                         
                                                                                                                                                                                                                                                                                                                                                                                                                             
export const DEFAULT_U01_APPEARANCE                = Object.freeze({ discSide: 'right', highlightTarget: 'digits', accentColor: '#8fe3ae' });
                                           
export function defaultCardAppearance(preset        )                 {
  return Object.freeze({ discSide: preset.endsWith('-mirror') || ['u02','u04','u05'].includes(preset) ? 'left' : 'right', highlightTarget: preset === 'u01' || preset === 'u02' || preset[0] === 'b' ? 'digits' : 'tiles', accentColor: /^(u03|u04|b0)/.test(preset) ? '#c8f23d' : '#8fe3ae' });
}
                                                                                                                                                                                                                                                                                         
export function validateU01Appearance(value         )                {
  const appearance = value       ;
  if (!appearance || !['left', 'right'].includes(appearance.discSide) || !['tiles', 'digits'].includes(appearance.highlightTarget) || typeof appearance.accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(appearance.accentColor)) throw new Error('invalid U01 appearance.');
  const base = { discSide: appearance.discSide, highlightTarget: appearance.highlightTarget, accentColor: appearance.accentColor.toLowerCase() };
  const extra                         = {};
  if (appearance.zoomFocus !== undefined) {
    const { x, y } = appearance.zoomFocus ?? {};
    if (![x, y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('invalid U01 appearance.');
    extra.zoomFocus = Object.freeze({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  }
  if (appearance.plate !== undefined) { if (!['see-through', 'solid'].includes(appearance.plate)) throw new Error('invalid U01 appearance.'); if (appearance.plate === 'solid') extra.plate = 'solid'; }
  if (appearance.frame !== undefined) { if (typeof appearance.frame !== 'boolean') throw new Error('invalid U01 appearance.'); if (appearance.frame) extra.frame = true; }
  // discShape: 'round' (default) or 'square' (a square disc such as the Doomsday Oxymoron); discCornerRadius is the rounded
  // square's corner radius as a fraction of its side (0..0.5), measured from the cutout.
  if (appearance.discShape !== undefined) { if (!['round', 'square'].includes(appearance.discShape)) throw new Error('invalid U01 appearance.'); if (appearance.discShape === 'square') extra.discShape = 'square'; }
  if (appearance.discCornerRadius !== undefined) { const c = appearance.discCornerRadius; if (!(Number.isFinite(c) && c >= 0 && c <= 0.5)) throw new Error('invalid U01 appearance.'); extra.discCornerRadius = Math.round(c * 1000) / 1000; }
  // discOutline: the disc's own silhouette for a non-round disc, as [x, y] points in 0..1 of the photo frame (16..256 points).
  // The card clips the photo to it and strokes its ring along it, so the frame takes the disc's shape.
  if (appearance.discOutline !== undefined) {
    const o = appearance.discOutline;
    if (!Array.isArray(o) || o.length < 16 || o.length > 256 || !o.every(q => Array.isArray(q) && q.length === 2 && q.every(n => Number.isFinite(n) && n >= 0 && n <= 1))) throw new Error('invalid U01 appearance.');
    extra.discOutline = Object.freeze(o.map(([x, y]) => Object.freeze([Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])));
  }
  return Object.freeze({ ...base, ...extra });
}
export function validateCardAppearance(value         )                 {
  try { return validateU01Appearance(value); } catch { throw new Error('invalid card appearance.'); }
}
                                                                     
                                                                  
export function cardDimensions(orientation                 )                 { return orientation === 'vertical' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }; }
export function pngPixelDimensions(png            )                 {
  const signature=[137,80,78,71,13,10,26,10];
  if(png.length<33||signature.some((value,index)=>png[index]!==value)||String.fromCharCode(...png.slice(12,16))!=='IHDR')throw Error('Renderer returned an invalid PNG.');
  const view=new DataView(png.buffer,png.byteOffset,png.byteLength),width=view.getUint32(16),height=view.getUint32(20);
  if(view.getUint32(8)!==13||width<1||height<1)throw Error('Renderer returned invalid PNG dimensions.');
  return {width,height};
}
const slug = (value        )         => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'card';
export function moldSlug(disc                    )         { const match = /^ds\.px\.seed\.([^.]+)/.exec(disc.mold); return slug(match?.[1] ?? disc.mold.split('.').pop() ?? disc.mold); }
export function cardFilename(card            , taken              = new Set())         {
  const base = `${moldSlug(card.disc)}-${slug(card.cardDesign)}-${card.orientation}`;
  let name = `${base}.png`, n = 2; while (taken.has(name)) name = `${base}-${n++}.png`; taken.add(name); return name;
}
function checkCard(card            , index        )       {
  const where = `queue[${index}]`;
  if (!card || typeof card !== 'object') throw new Error(`${where}: expected a QueuedCard.`);
  if (!card.disc || typeof card.disc.id !== 'string' || !card.disc.id) throw new Error(`${where}: disc needs a non-empty id.`);
  if (typeof card.disc.mold !== 'string' || !card.disc.mold) throw new Error(`${where}: disc needs a mold address.`);
  if (!orientations.includes(card.orientation)) throw new Error(`${where}: orientation must be 'horizontal' or 'vertical'.`);
  if (typeof card.cardDesign !== 'string' || !card.cardDesign.trim()) throw new Error(`${where}: cardDesign must be a non-empty string.`);
  if (card.approvalId !== undefined && (typeof card.approvalId !== 'string' || !/^ds\.approval\.enqueue-\d+\.\d+$/.test(card.approvalId))) throw new Error(`${where}: invalid approval instance identity.`);
  if (card.approvalContentId !== undefined && (typeof card.approvalContentId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(card.approvalContentId))) throw new Error(`${where}: invalid approval content identity.`);
  if (card.u01Appearance !== undefined) {
    if (card.orientation !== 'vertical' || card.cardDesign !== 'u01') throw new Error(`${where}: U01 appearance is only valid for vertical u01 cards.`);
    try { validateU01Appearance(card.u01Appearance); } catch { throw new Error(`${where}: invalid U01 appearance.`); }
  }
  if (card.cardAppearance !== undefined) {
    if (card.u01Appearance !== undefined) throw new Error(`${where}: choose one card appearance field.`);
    try { validateCardAppearance(card.cardAppearance); } catch { throw new Error(`${where}: invalid card appearance.`); }
  }
  const placement = card.placement ?? identityTransform;
  if (![placement.scale, placement.dx, placement.dy].every(Number.isFinite) || placement.scale < 0.5 || placement.scale > 1.5 || Math.abs(placement.dx) > 1 || Math.abs(placement.dy) > 1) throw new Error(`${where}: invalid placement transform.`);
}
/** Queue cards are portable metadata, not arbitrary JavaScript objects. */
function snapshot(value         )      {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)])));
  throw Error('Queued output must contain only plain card metadata.');
}
export function queueCards(items                       )                        {
  if (!Array.isArray(items)) throw new Error('queueCards: expected an array.');
  items.forEach(checkCard);
  return Object.freeze(items.map(card => snapshot(card.cardAppearance ? { ...card, cardAppearance: validateCardAppearance(card.cardAppearance) } : card.u01Appearance ? { ...card, u01Appearance: validateU01Appearance(card.u01Appearance) } : card)));
}
                               
                                                                                                                                                            
                                                                                                   
                                                                                                                      
                                                                                                                                                             
                                                                                                                      
 
                                                                                                                    
                                                                                     
export async function prepareExport(queue                       , renderCard              , sha256                                        )                                                                    {
  const cards = queueCards(queue); if (!cards.length) throw new Error('exportZip: queue is empty. Pick at least one disc.');
  const taken = new Set        (), rendered                   = [], manifestCards                 = [];
  for (const card of cards) {
    const filename = cardFilename(card, taken), png = new Uint8Array(await renderCard(card));
    if (!png.length) throw new Error(`exportZip: renderer returned empty bytes for ${filename}.`);
    const { width, height } = pngPixelDimensions(png);
    rendered.push({ filename, png, card });
    const rendererFlights = (card.disc       ).renderer?.flights                                 ;
    const fields = ['speed', 'glide', 'turn', 'fade']         ;
    const values = Object.fromEntries(fields.map((field, index) => {
      if (Object.hasOwn(card.disc, field) && card.disc[field] !== undefined) return [field, { value: card.disc[field] ?? null, source: card.disc[field] === null ? 'unknown' : 'own' }];
      const inherited = rendererFlights?.[index]; return [field, { value: inherited ?? null, source: inherited == null ? 'unknown' : 'mold' }];
    }))                                                                                               ;
    const u01Appearance = card.cardDesign === 'u01' && card.orientation === 'vertical' ? (card.u01Appearance ?? DEFAULT_U01_APPEARANCE) : undefined;
    const cardAppearance = card.cardAppearance;
    manifestCards.push({ filename, ...(card.approvalId ? { approvalId: card.approvalId } : {}), ...(card.approvalContentId ? { approvalContentId: card.approvalContentId } : {}), discId: card.disc.id, nickname: card.disc.nickname, mold: card.disc.mold, plastic: card.disc.plastic, weight: card.disc.weight,
      flight: { speed: values.speed.value, glide: values.glide.value, turn: values.turn.value, fade: values.fade.value }, flightSource: { speed: values.speed.source, glide: values.glide.source, turn: values.turn.source, fade: values.fade.source }, orientation: card.orientation, cardDesign: card.cardDesign,
      width, height, byteLength: png.length, sha256: await sha256(png), placement: { ...(card.placement ?? identityTransform) }, backgroundIncluded: false,
      ...(cardAppearance ? { cardAppearance: { ...cardAppearance } } : {}),
      ...(!cardAppearance && u01Appearance ? { u01Appearance: { ...u01Appearance } } : {}) });
  }
  return { rendered, manifest: { type: 'discstudio-export', version: 1, cardCount: manifestCards.length, cards: manifestCards } };
}
