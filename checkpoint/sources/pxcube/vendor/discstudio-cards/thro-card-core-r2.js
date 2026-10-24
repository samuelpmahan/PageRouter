// Thro card core, revision 2. Derived from DiscStudio 6.6.1 card-renderer-core.js (build 28ac2b39fab85255),
// which stays pinned and byte-identical beside this file. Exactly two rendering changes, used only for
// B01 and U04 recipes that ask for revision 2 (Sam's rule: disc image > mold name > flight numbers > everything
// else; the disc photo is never rotated, skewed or foreshortened):
//   B01: the hero disc is drawn upright (DiscStudio drew it at tiltDeg 12).
//   U04: the manufacturer label is fitted from 30 px instead of 52 px, so it sits below the 44 px flight numbers.
// U04's frame-layer identities move from kinetic-v3 to kinetic-v4 so cached revision-1 rasters are never reused.
// Parts and rules (24 Oct 2026): B01, B04 and B05 can also be drawn from a recipe of pinned parts (CARD_RECIPES). With no recipe,
// B04 and B05 run the core's own drawing code here unchanged (their one drawing, revision 1), and only report where their parts are.
// SpotlightCard renderer for Disc Studio MVP.
// Each disc in the bag gets an individual card: full-frame transparent PNG
// with the card baked at the bottom-left corner (CapCut overlay track).
// Visual hierarchy: PHOTO > MOLDNAME >> NUMBERS >>> everything else.

import { createFrameRenderer } from './frame-seek.mjs?v=28ac2b39fab85255';
                                       
import { DEFAULT_U01_APPEARANCE, validateU01Appearance, validateCardAppearance,                                         } from './export-queue-core.js?v=28ac2b39fab85255';

                                     
                                              
                                                
                        
                                                        
                                                         
                                   
  
                                                                                                                                            

                                                        

export const CARD_SIZE                                                    = {
  horizontal: { w: 1920, h: 1080 },
  vertical: { w: 1080, h: 1920 },
};

const CARD_BG = 'rgba(14,18,22,0.94)';
const INK = '#ffffff';
const MINT = '#8fe3ae';
const FONT_STACK = '"DS Card Sans", "DejaVu Sans", "Nimbus Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

                     
                                        
                                           
                  
                        
                                                                  
                          
  

function moldIdFromAddress(address        )         {
  const m = /^ds\.px\.seed\.([^.]+)/.exec(address);
  return m ? m[1] : address;
}

export async function resolveCardDisc(environment                       , disc              )                        {
  const id = moldIdFromAddress(disc.mold);
  const supplied = disc.renderer ?? {};
  let moldName = supplied.moldName ?? id;
  let manufacturer = supplied.manufacturer ?? '';
  let flights                           = Array.isArray(supplied.flights) ? supplied.flights : null;
  try {
    // The queue's renderer triple is a captured catalog snapshot. Do not even
    // consult the live catalog when all three facts are present: doing so is
    // unnecessary and makes the preview depend on current catalog state.
    const hasSavedFactSnapshot = ['moldName', 'manufacturer', 'flights']
      .every(key => Object.hasOwn(supplied, key));
    const details      = hasSavedFactSnapshot || !environment.getMoldDetails
      ? null : await environment.getMoldDetails(id);
    if (details) {
      // A queued card holds renderer facts at enqueue time. Catalog lookup can
      // fill a missing value, never replace the held card's provenance.
      if (supplied.moldName === undefined) moldName = details.mold ?? details.name ?? moldName;
      if (supplied.manufacturer === undefined) manufacturer = details.manufacturer ?? manufacturer;
      if (!Array.isArray(supplied.flights) && Array.isArray(details.flight)) flights = details.flight;
    }
  } catch {
    // Browser exports retain their passed-in model facts when detail lookup is unavailable.
  }
  const fields = ['speed', 'glide', 'turn', 'fade']         ;
  // An absent field inherits the mold. An explicitly retained null means the
  // player marked that value unknown; it must never silently fall back.
  if (fields.some(field => Object.hasOwn(disc, field) && disc[field] !== undefined)) {
    const base = Array.isArray(flights) ? [...flights] : [null, null, null, null];
    flights = base.map((value, index) => Object.hasOwn(disc, fields[index]) && disc[fields[index]] !== undefined ? (disc[fields[index]] ?? null) : value);
  }
  return {
    moldName,
    manufacturer,
    plastic: disc.plastic || '',
    weight: disc.weight ?? null,
    flights,
    photoSrc: disc.depiction?.kind === 'photo' ? disc.depiction.src ?? null : disc.depiction?.kind === 'painted' && supplied.artSrc?.startsWith('data:image/svg+xml;') ? supplied.artSrc : null,
  };
}

/** Shrink font until text fits maxWidth. Returns the font string to use. */
function fitFont(ctx     , text        , maxWidth        , weight        , startPx        , family = FONT_STACK)         {
  let px = startPx;
  while (px > 12) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 4;
  }
  return ctx.font;
}

function roundRect(ctx     , x        , y        , w        , h        , r        ) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw image cover-fit inside a circle. Falls back to a placeholder ring. */
function accentRgba(hex        , alpha        )         {
  const value = hex.slice(1);
  const rgb = [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

async function drawPhotoCircle(environment                       , ctx     , src               , cx        , cy        , d        , accent         ) {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  let drew = false;
  if (src) {
    try {
      const img = await environment.loadImage(src);
      // cover-fit: scale to fill, center-crop
      const scale = Math.max(d / img.width, d / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      drew = true;
    } catch (error) {
      if (environment.strictPhoto) throw new Error(`Prepared photo could not be decoded for export: ${String(error)}`);
      drew = false;
    }
  }
  if (!drew) {
    // Placeholder: dark disc with inner ring, like an unprinted disc.
    ctx.fillStyle = '#1c2a24';
    ctx.fillRect(cx - r, cy - r, d, d);
    ctx.strokeStyle = accent ? accentRgba(accent, 0.35) : 'rgba(143,227,174,0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // Mint rim around the photo, echoing the deck's disc-mark ring.
  ctx.strokeStyle = accent ? accentRgba(accent, 0.9) : 'rgba(143,227,174,0.9)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function plasticWeightLine(rd              )         {
  return rd.plastic;
}

/** Card artwork shows plastic when specified; stored weight remains a backward-compatible data field. */
function plasticLine(rd              )         {
  return rd.plastic;
}

function manufacturerPlasticLine(rd              )         {
  return [rd.manufacturer.toUpperCase(), rd.plastic].filter(Boolean).join(' · ');
}

function flightsLine(rd              )                {
  if (!rd.flights || !rd.flights.some(v => v !== null && v !== undefined)) return null;
  return rd.flights.map(v => (v === null || v === undefined ? '?' : String(v))).join('   ');
}

async function drawHorizontal(environment                       , ctx     , rd              ) {
  const M = 48;
  const cardW = 1100, cardH = 440;
  const cardX = M, cardY = 1080 - M - cardH;
  ctx.fillStyle = CARD_BG;
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.fill();

  // Photo: hero, left.
  const d = 360;
  const cx = cardX + 48 + d / 2, cy = cardY + cardH / 2;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, cx, cy, d);

  // Text block: right of photo.
  const tx = cardX + 48 + d + 56;
  const maxW = cardX + cardW - 48 - tx;
  ctx.textBaseline = 'alphabetic';

  const name = rd.moldName.toUpperCase();
  ctx.fillStyle = INK;
  fitFont(ctx, name, maxW, 800, 124);
  ctx.fillText(name, tx, cardY + 196);

  const pw = plasticWeightLine(rd);
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 42px ${FONT_STACK}`;
    ctx.fillText(pw, tx, cardY + 272);
  }

  const fl = flightsLine(rd);
  if (fl) {
    ctx.fillStyle = MINT;
    ctx.font = `600 54px ${FONT_STACK}`;
    ctx.fillText(fl, tx, cardY + 356);
  }
}

async function drawVertical(environment                       , ctx     , rd              ) {
  const M = 48;
  const cardW = 1080 - M * 2, cardH = 780;
  const cardX = M, cardY = 1920 - M - cardH;
  ctx.fillStyle = CARD_BG;
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.fill();

  // Photo: hero, centered top.
  const d = 330;
  const cx = cardX + cardW / 2, cy = cardY + 56 + d / 2;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, cx, cy, d);

  // Text: centered below photo.
  ctx.textAlign = 'center';
  const midX = cardX + cardW / 2;
  const photoBottom = cardY + 56 + d;

  const name = rd.moldName.toUpperCase();
  ctx.fillStyle = INK;
  fitFont(ctx, name, cardW - 96, 800, 104);
  ctx.fillText(name, midX, photoBottom + 122);

  const pw = plasticWeightLine(rd);
  let y = photoBottom + 122;
  if (pw) {
    ctx.fillStyle = MINT;
    ctx.font = `500 40px ${FONT_STACK}`;
    ctx.fillText(pw, midX, y + 64);
    y += 64;
  }

  const fl = flightsLine(rd);
  if (fl) {
    ctx.fillStyle = MINT;
    ctx.font = `600 52px ${FONT_STACK}`;
    ctx.fillText(fl, midX, y + 78);
  }
  ctx.textAlign = 'left';
}

/* ------------------------------------------------------------------
 * UPRIGHT PRESETS (vertical-native, 9:16) — from Spotlight_Card_Visual_Research.
 * Safe areas: top 14% platform UI, bottom 25% captions/controls,
 * right 12% action rail. Key info lives in the 15-70% height guide.
 * Breakout (horizontal) presets register into the same `presetRenderers`
 * registry under b01..b05; renderCard dispatches on the preset id.
 * ------------------------------------------------------------------ */

                                                                                                                                                                               

/** Preset id -> renderer. Breakout presets (b01..b05) register here too. */
export const presetRenderers                                                                                                                                   = {};

const VW = 1080, VH = 1920;
const Z_TOP = VH * 0.14;   // platform UI dead zone
const Z_BOT = VH * 0.75;   // caption/controls dead zone
const Z_RAIL = VW * 0.88;  // action rail starts here (right 12%)
const NIGHT92 = 'rgba(5,7,6,0.92)';
const NIGHT94 = 'rgba(5,7,6,0.94)';
/** Plate fill: the layout's own see-through dark unless the card asks for a solid plate. */
const plateFill = (appearance                           , seeThrough        ) => appearance?.plate === 'solid' ? PLATE : seeThrough;
/** B03's thin frame, offered on B01. */
function drawFrame(ctx     , x        , y        , w        , h        ) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); }
const ACID = '#c8f23d';
const CORAL = '#ff5c47';
const DISPLAY = '"DS Card Sans Condensed", "DejaVu Sans Condensed", "Nimbus Sans Narrow", "DejaVu Sans", sans-serif';
const SCOREBUG_SURFACE = '#1a1b1a';

function luminance(hex        )         {
  const channels = [0, 2, 4].map(index => Number.parseInt(hex.slice(1 + index, 3 + index), 16) / 255);
  return channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first        , second        )         {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function u01AccentContrastOnScorebug(accent        )         { return contrastRatio(accent, SCOREBUG_SURFACE); }
/** Warning only: digit color and recipe backing remain unchanged. */
export function cardDigitAccentContrast(accent        , preset        )         { return contrastRatio(accent, preset.startsWith('b') ? '#202623' : '#38413e'); }

function flightTiles(rd              )           {
  if (!rd.flights) return [];
  return rd.flights.map(v => (v === null || v === undefined ? '?' : String(v)));
}

function tilesRowWidth(n        , tile        , gap        )         {
  return n * tile + Math.max(0, n - 1) * gap;
}

/** Law 5: numbers are objects. Left/right/center aligned tile row. */
function drawTilesRow(
  ctx     , nums          , x        , y        ,
  tile        , gap        , fontPx        ,
  align                              = 'left',
  fill = 'rgba(255,255,255,0.10)',
  ink = '#0e1216',
  fitDigits = false,
) {
  const total = tilesRowWidth(nums.length, tile, gap);
  let sx = x;
  if (align === 'right') sx = x - total;
  if (align === 'center') sx = x - total / 2;
  ctx.font = `600 ${fontPx}px ${FONT_STACK}`;
  for (let i = 0; i < nums.length; i++) {
    const bx = sx + i * (tile + gap);
    ctx.fillStyle = fill;
    roundRect(ctx, bx, y, tile, tile, 10);
    ctx.fill();
    // The caller pairs each tile fill with a contrasting value color.
    ctx.fillStyle = ink;
    if (fitDigits) fitFont(ctx, nums[i], tile - 12, 600, fontPx);
    ctx.textAlign = 'center';
    ctx.fillText(nums[i], bx + tile / 2, y + tile * 0.72);
  }
  ctx.textAlign = 'left';
}

function contrastInk(hex        )         {
  if (contrastRatio(hex, '#111820') >= 4.5) return '#111820';
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}

/** Accent used as TEXT on a dark surface: keep the sponsor colour when it already
 * reads at 4.5:1, otherwise lift it toward white just far enough to read.
 * Fills (tiles, rims, rules) keep the exact chosen colour. */
export function legibleAccent(accent        , surface        )         {
  if (contrastRatio(accent, surface) >= 4.5) return accent;
  const rgb = [1, 3, 5].map(i => Number.parseInt(accent.slice(i, i + 2), 16));
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const hex = '#' + rgb.map(c => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('');
    if (contrastRatio(hex, surface) >= 4.5) return hex;
  }
  return '#ffffff';
}
const PLATE = '#050706';

function drawU01FlightValues(ctx     , nums          , x        , y        , align                  , highlightTarget                    , accent        ) {
  const defaultTile = '#38413e';
  const digitTile = defaultTile;
  drawTilesRow(ctx, nums, x, y, 64, 10, 38, align, highlightTarget === 'tiles' ? accent : digitTile, highlightTarget === 'digits' ? legibleAccent(accent, digitTile) : contrastInk(accent));
}

/** Law 4: one display voice for the name. */
function drawPresetName(
  ctx     , text        , x        , y        ,
  maxW        , startPx        , align                              = 'left',
) {
  const name = text.toUpperCase();
  ctx.fillStyle = INK;
  fitFont(ctx, name, maxW, 800, startPx, DISPLAY);
  ctx.textAlign = align;
  // fitFont's 12px floor is only a preferred font size. Canvas maxWidth is the
  // final geometry guard for names beyond that floor (including stress names).
  ctx.fillText(name, x, y, maxW);
  ctx.textAlign = 'left';
}

/** U01 Compact Scorebug (NFL on Fox, corner card).
 * Card footprint: x 48-508, y ~410-1060. A slim dark scorebug anchors in the
 * safe left; the disc breaks out above it. The MINT rule, flight values, and
 * manufacturer label form one accent. */
async function renderU01(ctx     , rd              , environment                       , appearance                ) {
  // Missing appearance keeps cards already in saved queues byte-compatible.
  // New creator layouts mirror the contents only within the existing 460px
  // scorebug footprint; the photo pixels and flight glyph order never flip.
  const discSide = appearance?.discSide ?? 'right';
  const cardX = 48, cardW = 460, cardY = 700, cardH = 300;
  const align                   = discSide === 'left' ? 'right' : 'left';
  const accent = appearance?.accentColor ?? MINT;
  const highlightTarget = appearance?.highlightTarget ?? 'digits';

  // Hero breaks out above the card.
  const d = 380;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, discSide === 'left' ? 246 : 310, 600, d, accent);

  // Scorebug block: dark protection behind type only.
  ctx.fillStyle = plateFill(appearance, NIGHT92);
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.fillStyle = accent;
  ctx.fillRect(discSide === 'left' ? cardX + cardW - 4 : cardX, cardY, 4, cardH);

  const nameX = align === 'right' ? cardX + cardW - 28 : cardX + 28;
  drawPresetName(ctx, rd.moldName, nameX, cardY + 120, cardW - 56, 96, align);

  const nums = flightTiles(rd);
  const supportMaxWidth = cardW - 56;
  const tilesY = cardY + 150;
  drawU01FlightValues(ctx, nums, nameX, tilesY, align, highlightTarget, accent);

  const details = manufacturerPlasticLine(rd);
  if (details) {
    ctx.fillStyle = legibleAccent(accent, PLATE);
    fitFont(ctx, details, supportMaxWidth, 600, 28);
    // Canvas's maxWidth also protects the column at fitFont's minimum size.
    ctx.textAlign = align;
    ctx.fillText(details, nameX, tilesY + 104, supportMaxWidth);
  }
  ctx.textAlign = 'left';
}
presetRenderers.u01 = renderU01;

/** U02 Stacked Poster (VALORANT Game Changers, corner card).
 * Card footprint: x 48-508, y ~480-1210. Hero owns the top of the card;
 * mold name, flight numbers, then manufacturer and optional plastic form the
 * fixed reading order. */
async function renderU02(ctx     , rd              , environment                       , appearance                ) {
  // Keep the alternate rail outside the right-side action overlay zone.
  const cardW = 460, cardX = appearance?.discSide === 'right' ? Z_RAIL - 48 - cardW : 48;
  const accent = appearance?.accentColor ?? MINT;
  const highlightTarget = appearance?.highlightTarget ?? 'digits';
  const align                   = appearance?.discSide === 'right' ? 'right' : 'left';

  // Hero: top of the card, full card width.
  const d = 400;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, cardX + cardW / 2, 680, d, accent);

  // Name band: dark with the same mint accent as the photo rim.
  const bandY = 830, bandH = 340;
  ctx.fillStyle = plateFill(appearance, NIGHT92);
  ctx.fillRect(cardX, bandY, cardW, bandH);
  ctx.fillStyle = appearance ? accent : MINT;
  if (appearance) ctx.fillRect(appearance.discSide === 'right' ? cardX + cardW - 4 : cardX, bandY, 4, bandH);
  else ctx.fillRect(cardX, bandY, cardW, 4);

  const nameX = align === 'right' ? cardX + cardW - 28 : cardX + 28;
  drawPresetName(ctx, rd.moldName, nameX, bandY + 98, cardW - 56, 100, align);

  // Flight numbers are primary: they always occupy the first row below identity.
  const nums = flightTiles(rd);
  const tilesY = 990;
  if (appearance) drawTilesRow(ctx, nums, align === 'right' ? cardX + cardW - 28 : nameX, tilesY, 68, 12, 40, align,
    highlightTarget === 'tiles' ? accent : '#38413e',
    highlightTarget === 'digits' ? legibleAccent(accent, '#38413e') : contrastInk(accent), true);
  else drawTilesRow(ctx, nums, nameX, tilesY, 68, 12, 40, 'left', '#38413e', MINT);

  const details = manufacturerPlasticLine(rd);
  if (details) {
    ctx.fillStyle = appearance ? legibleAccent(accent, PLATE) : 'rgba(143,227,174,0.78)';
    fitFont(ctx, details, cardW - 56, 600, 30);
    ctx.textAlign = align;
    ctx.fillText(details, nameX, tilesY + 138, cardW - 56);
    ctx.textAlign = 'left';
  }
}
presetRenderers.u02 = renderU02;

/** U3 Compare uses four explicit addresses. The inherited u03 address is the
 * original/front-left alternative, never an acceptance decision. Photo pixels
 * and glyphs keep their orientation when composition positions mirror. */
const U3_COMPARE = ['u03', 'u03-front', 'u03-behind', 'u03-front-mirror', 'u03-behind-mirror'];
export async function cardFrameSnapshot(disc              , preset            , environment                       , appearance                ) {
  const facts = await resolveCardDisc(environment, disc);
  const rd = Object.freeze({...facts,flights:facts.flights ? Object.freeze([...facts.flights]) : null});
  if (!U3_COMPARE.includes(preset) && preset !== 'u04') throw Error('Layer snapshot is scoped to U3/U4');
  // With no appearance, the four historical U3 ids keep their exact side.
  // Once Card Details is supplied, discSide is authoritative for every U3 id.
  const accent = appearance?.accentColor ?? '#c8f23d';
  const mirrored = appearance ? appearance.discSide === 'left' : preset.endsWith('-mirror');
  const highlightTarget = appearance?.highlightTarget ?? 'digits';
  // U04 is a centered group, so move its surface, label, and hero together
  // between the left safe rail and a right position that clears the action rail.
  const u04Shift = preset === 'u04' && appearance?.discSide === 'right' ? Z_RAIL - 48 - 460 - 48 : 0;
  const u04Center = 278 + u04Shift;
  const mirrorX = (x        ) => mirrored ? 584 - x : x;
  let image      = null;
  if (rd.photoSrc) {
    try { image = await environment.loadImage(rd.photoSrc); }
    catch (error) { if (environment.strictPhoto) throw error; }
  }
  const photoSize = 368;
  const photo = { id: 'disc-photo', identity: JSON.stringify([rd.photoSrc, accent, photoSize]), width: photoSize, height: photoSize,
    x: (preset === 'u04' ? u04Center : mirrorX(352)) - photoSize / 2, y: (preset === 'u04' ? 1038 : 810) - photoSize / 2,
    draw(ctx     ) {
      const r = 180, cx = 184, cy = 184;
      ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
      if (image) { const scale = Math.max(360/image.width,360/image.height), w=image.width*scale,h=image.height*scale;ctx.drawImage(image,cx-w/2,cy-h/2,w,h); }
      else { ctx.fillStyle='#1c2a24';ctx.fillRect(4,4,360,360); }
      ctx.restore();ctx.strokeStyle=accent;ctx.lineWidth=7;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
    } };
  const surface = { id: 'card-surface', identity: JSON.stringify([preset === 'u04' ? 'kinetic-v4-fade' : 'spine-v2',mirrored,preset === 'u04' ? rd.manufacturer : '',u04Shift]), draw(ctx     ) {
    if (preset === 'u04') {
      const manufacturer = rd.manufacturer.toUpperCase();
      ctx.save();fitFont(ctx,manufacturer,400,600,30); // Thro r2: manufacturer below the flight numbers (was 52 px)
      const labelTop = manufacturer ? 622 - ctx.measureText(manufacturer).actualBoundingBoxAscent : 634;
      ctx.restore();
      const fadeOpaqueY = Math.max(530,Math.min(632,labelTop - 2));
      const g=ctx.createLinearGradient(0,530,0,1170);g.addColorStop(0,'rgba(24,24,24,0)');g.addColorStop((fadeOpaqueY-530)/640,'rgba(24,24,24,.88)');g.addColorStop(.80,'rgba(24,24,24,.88)');g.addColorStop(1,'rgba(24,24,24,0)');ctx.fillStyle=g;ctx.fillRect(48+u04Shift,530,460,640);
    } else {ctx.fillStyle=NIGHT94;ctx.fillRect(mirrored?326:48,570,210,650);ctx.fillStyle=accent;ctx.fillRect(mirrored?326:255,570,3,650);}
  } };
  const text = { id: 'card-label', identity: JSON.stringify([preset === 'u04'?'kinetic-v4':'spine-v2',mirrored,rd.moldName,preset === 'u04'?rd.manufacturer:'',rd.flights,accent,highlightTarget,u04Shift]), draw(ctx     ) {
    if(preset === 'u04') {
      drawPresetName(ctx,rd.moldName,u04Center,728,410,112,'center');
      ctx.textAlign='center';ctx.fillStyle=legibleAccent(accent,'#181818');fitFont(ctx,rd.manufacturer.toUpperCase(),400,600,30);ctx.fillText(rd.manufacturer.toUpperCase(),u04Center,622);
      drawTilesRow(ctx,flightTiles(rd),u04Center,770,72,10,44,'center',highlightTarget === 'tiles' ? accent : (appearance ? ('#38413e') : accent),highlightTarget === 'digits' ? (appearance ? legibleAccent(accent,'#38413e') : contrastInk(accent)) : contrastInk(accent),true);
    } else {
      const cx=mirrorX(124);ctx.save();ctx.translate(cx,744);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=INK;fitFont(ctx,rd.moldName.toUpperCase(),286,800,76,DISPLAY);ctx.fillText(rd.moldName.toUpperCase(),0,0);ctx.restore();
      ctx.textBaseline='alphabetic';ctx.font=`600 42px ${FONT_STACK}`;ctx.textAlign='center';
      for(const [i,value] of flightTiles(rd).entries()){const y=920+i*72;const tileFill=appearance && highlightTarget==='digits'?('#38413e'):accent;ctx.fillStyle=tileFill;ctx.fillRect(mirrorX(140)-32,y,64,64);ctx.fillStyle=appearance?(highlightTarget==='tiles'?contrastInk(accent):legibleAccent(accent,'#38413e')):contrastInk(accent);fitFont(ctx,value,52,600,42);ctx.fillText(value,mirrorX(140),y+47);}
    }
  } };
  const layers = preset === 'u04' || !preset.includes('behind') ? [surface,text,photo] : [photo,surface,text];
  return Object.freeze({ schema:'discstudio-frame-scene@1',width:1080,height:1920,preset,comparison:U3_COMPARE.includes(preset)?'Compare':undefined,layers:Object.freeze(layers.map(layer=>Object.freeze(layer))) });
}

for (const id of [...U3_COMPARE, 'u04']) presetRenderers[id] = async (ctx, rd, environment, appearance) => { const disc = { mold: '', depiction: rd.photoSrc ? {kind:'photo',src:rd.photoSrc} : {kind:'none'}, plastic:rd.plastic, weight:rd.weight, renderer:rd }       ; const scene=await cardFrameSnapshot(disc,id              ,environment,appearance); if(!environment.createCanvas) throw Error('Canvas adapter required');(environment.frameRenderer ?? createFrameRenderer({createCanvas:environment.createCanvas})).seek(ctx,scene,0); };

/** U05 Glass Stat Drawer (Ultra LoL HUD, corner card).
 * Card footprint: x 48-508, y ~450-1120. A small dark-tinted drawer in the
 * safe left; the hero overlaps it by a third. Dark tint keeps type legible
 * on bright footage (no backdrop blur in a static PNG). Glass highlight
 * line is the one motif. */
async function renderU05(ctx     , rd              , environment                       , appearance                ) {
  const gx = appearance?.discSide === 'right' ? Z_RAIL - 48 - 460 : 48, gw = 460;
  const accent = appearance?.accentColor ?? MINT;
  const highlightTarget = appearance?.highlightTarget ?? 'digits';
  const align                   = appearance?.discSide === 'right' ? 'right' : 'left';
  const d = 380;
  await drawPhotoCircle(environment, ctx, rd.photoSrc, gx + gw / 2, 640, d, accent);

  const gy = 800, gh = 320;
  ctx.fillStyle = appearance?.plate === 'solid' ? '#0a0e0c' : 'rgba(10,14,12,0.62)';
  roundRect(ctx, gx, gy, gw, gh, 24);
  ctx.fill();
  ctx.strokeStyle = appearance ? accentRgba(accent, 0.58) : 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  roundRect(ctx, gx, gy, gw, gh, 24);
  ctx.stroke();
  ctx.strokeStyle = appearance ? accentRgba(accent, 0.25) : 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.moveTo(gx + 24, gy + 3);
  ctx.lineTo(gx + gw - 24, gy + 3);
  ctx.stroke();

  const nameX = align === 'right' ? gx + gw - 36 : gx + 36;
  drawPresetName(ctx, rd.moldName, nameX, gy + 108, gw - 72, 92, align);

  const nums = flightTiles(rd);
  drawTilesRow(ctx, nums, nameX, gy + 154, 64, 10, 38, align,
    appearance ? (highlightTarget === 'tiles' ? accent : '#38413e') : MINT,
    appearance ? (highlightTarget === 'digits' ? legibleAccent(accent, '#38413e') : contrastInk(accent)) : '#0e1216', true);
  const details = manufacturerPlasticLine(rd);
  if (details) {
    ctx.fillStyle = appearance ? legibleAccent(accent, '#0a0e0c') : MINT;
    fitFont(ctx, details, gw - 72, 600, 30);
    ctx.textAlign = align;
    ctx.fillText(details, nameX, gy + 280, gw - 72);
    ctx.textAlign = 'left';
  }
}
presetRenderers.u05 = renderU05;

/* ------------------------------------------------------------------
 * BREAKOUT PRESETS (horizontal-native, 16:9) — from
 * Spotlight_Card_Visual_Research. Hero-led overlays: the disc escapes
 * the rail while the type stays defended. These five use flat bounded
 * surfaces; U04 alone retains its explicitly scoped readability fade.
 * ------------------------------------------------------------------ */

const HW = 1920, HH = 1080;
const NIGHT = (a        ) => `rgba(5,7,6,${a})`;

/** Hero disc: CircleFit photo with optional tilt, rim, and macro zoom (B05 coin). */
async function drawHeroDisc(environment                       , ctx     , src               , cx        , cy        , d        ,
  opts                                                                                                          = {}) {
  const r = d / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (opts.tiltDeg) ctx.rotate((opts.tiltDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  let drew = false;
  if (src) {
    try {
      const img = await environment.loadImage(src);
      if (opts.macro) {
        // Dual-scale: zoom into a sub-rect of the same photo.
        const { zoom, fx, fy } = opts.macro;
        const s = Math.min(img.width, img.height) / zoom;
        const sx = Math.min(Math.max(fx * img.width - s / 2, 0), img.width - s);
        const sy = Math.min(Math.max(fy * img.height - s / 2, 0), img.height - s);
        ctx.drawImage(img, sx, sy, s, s, -r, -r, d, d);
      } else {
        const scale = Math.max(d / img.width, d / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
      drew = true;
    } catch (error) {
      if (environment.strictPhoto) throw new Error(`Prepared photo could not be decoded for export: ${String(error)}`);
      drew = false;
    }
  }
  if (!drew) {
    ctx.fillStyle = '#1d2b25';
    ctx.fillRect(-r, -r, d, d);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = Math.max(4, d * 0.012);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  if (opts.rim) {
    ctx.save();
    ctx.translate(cx, cy);
    if (opts.tiltDeg) ctx.rotate((opts.tiltDeg * Math.PI) / 180);
    ctx.strokeStyle = opts.rim;
    ctx.lineWidth = opts.rimWidth ?? 8;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Flat bounded dark support behind a horizontal recipe's information. */
function scrimH(ctx     , x        , y        , w        , h        , flip = false, appearance                ) {
  ctx.fillStyle = plateFill(appearance, NIGHT(0.82));
  ctx.fillRect(x, y, w, h);
}

/** Flat bounded dark support behind a horizontal recipe's information. */
function scrimV(ctx     , x        , y        , w        , h        , appearance                ) {
  ctx.fillStyle = plateFill(appearance, NIGHT(0.82));
  ctx.fillRect(x, y, w, h);
}

/** Quiet plastic line under the name. */
function drawQuietLine(ctx     , text        , x        , y        , px = 40, align                   = 'left', maxWidth         ) {
  ctx.font = `500 ${px}px ${FONT_STACK}`;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (maxWidth !== undefined) { fitFont(ctx, text, maxWidth, 500, px, FONT_STACK); ctx.fillText(text, x, y, maxWidth); }
  else ctx.fillText(text, x, y);
}

function drawAppearanceTiles(ctx     , nums          , x        , y        , tile        , gap        , fontPx        ,
  appearance                , align                   = 'left') {
  if (!appearance) { drawTilesRow(ctx, nums, x, y, tile, gap, fontPx, align); return; }
  const accent = appearance.accentColor;
  if (appearance.highlightTarget === 'tiles') {
    drawTilesRow(ctx, nums, x, y, tile, gap, fontPx, align, accent, contrastInk(accent));
  } else {
    const tileFill = '#202623';
    drawTilesRow(ctx, nums, x, y, tile, gap, fontPx, align, tileFill, legibleAccent(accent, tileFill));
  }
}

/** B01 Pop Color Eject (VALORANT Game Changers) — CORNER CARD.
 * Small rail in the bottom-left corner. The disc breaks out: tilted 12 deg,
 * crossing the rail's top and right edges. One loud color (acid), used once
 * as the rail's left edge. ASYMMETRY · MAXIMAL HERO · ONE LOUD COLOR */
// ---- B01 from parts and rules (thro, 24 Oct 2026). The first Constraint Lab (Sam, 21 Oct: "click and drag and resize whatever
// the little piece they want and everything else will reform around it") rebuilt B01 from parts and rules instead of fixed
// numbers. A recipe pins some parts; every part not pinned is derived from the rules below. With no recipe, B01 draws exactly
// as before (the fixed numbers). The rules are written so that the starting values reproduce those numbers: plate 620 x 330,
// disc 420 riding the plate's top-right corner (+40, -60), tiles 74, name up to 104.
export const B01_PARTS = Object.freeze({
  plateW: { start: 620, min: 360, max: 1100, label: 'Plate width', unit: 'px' },
  discD: { start: 420, min: 160, max: 700, label: 'Disc size', unit: 'px' },
  discOX: { start: 40 / 420, min: -0.6, max: 0.6, label: 'Disc overhang (× disc size)', unit: '' },
  discOY: { start: -60 / 420, min: -0.8, max: 0.45, label: 'Disc lift (× disc size)', unit: '' },
  tile: { start: 74, min: 40, max: 120, label: 'Number tile', unit: 'px' },
  nameMax: { start: 104, min: 40, max: 180, label: 'Largest name size', unit: 'px' },
});
const B01_RULES = Object.freeze({ margin: 48, pad: 36, gap: 14, nameTop: 28, plasticGap: 50, tileGap: 30, bottom: 44, rimClear: 24 });
/** Solve B01 for a recipe. pinned: { part: value } (any subset of B01_PARTS). nameWidth(px): the drawn name's width at px.
 *  Returns the values, which were derived, and the geometry in the left-anchored frame (the plate at the left margin). */
export function solveB01(pinned, nameWidth) {
  const R = B01_RULES, P = B01_PARTS, has = k => Object.hasOwn(pinned ?? {}, k), msgs = [];
  const clampPart = (k, v) => Math.max(P[k].min, Math.min(P[k].max, v));
  const val = k => (has(k) && Number.isFinite(pinned[k]) ? clampPart(k, pinned[k]) : P[k].start);
  const rowW = t => 4 * t + 3 * R.gap;
  let plateW = val('plateW'), tile = val('tile'), namePx = val('nameMax');
  const discD = val('discD'), discOX = val('discOX'), discOY = val('discOY');
  let plate, disc, nameY, plasticY, tilesY, plateH, nameLane = 0;
  // Where type may run on a band of rows: from the plate's padding to the disc's left edge at those rows, kept clear of the rim.
  const laneRight = (top, bottom) => {
    let right = plate.x + plate.w - R.pad; const r = disc.d / 2 + 4;
    for (let y = top; y <= bottom; y += 4) { const dy = y - disc.cy; if (Math.abs(dy) < r) right = Math.min(right, disc.cx - Math.sqrt(r * r - dy * dy) - R.rimClear); }
    return right;
  };
  for (let pass = 0; pass < 8; pass++) {
    // Rule: the plate hugs its contents (name, plastic line, tiles), with the same spacing the fixed card uses.
    const nameBase = R.nameTop + namePx;
    plateH = Math.round(nameBase + R.plasticGap + R.tileGap + tile + R.bottom);
    plate = { x: R.margin, y: 1080 - R.margin - plateH, w: plateW, h: plateH };
    // Rule: the disc rides the plate's top-right corner.
    disc = { cx: plate.x + plate.w + discOX * discD, cy: plate.y + discOY * discD, d: discD };
    nameY = plate.y + nameBase; plasticY = nameY + R.plasticGap; tilesY = plasticY + R.tileGap;
    const nx = plate.x + R.pad;
    // Rule: the name fills its lane up to its largest size.
    const lane = laneRight(nameY - namePx * 0.75, nameY) - nx; nameLane = lane;
    let fitted = val('nameMax'); while (fitted > 24 && nameWidth(fitted) > lane) fitted -= 2;
    // Rule: the four tiles fit their lane; a pinned tile widens an unpinned plate instead.
    const tileLane = laneRight(tilesY, tilesY + tile) - nx;
    let nextTile = tile, nextPlateW = plateW;
    if (rowW(tile) > tileLane) {
      if (has('tile') && !has('plateW')) nextPlateW = Math.ceil(plateW + rowW(tile) - tileLane);
      else nextTile = Math.max(P.tile.min, Math.floor((tileLane - 3 * R.gap) / 4));
    } else if (!has('tile')) nextTile = Math.min(P.tile.start, Math.floor((tileLane - 3 * R.gap) / 4));
    nextPlateW = Math.min(P.plateW.max, nextPlateW);
    const settled = fitted === namePx && nextTile === tile && nextPlateW === plateW;
    namePx = fitted; tile = nextTile; plateW = nextPlateW;
    if (settled) break;
  }
  if (has('tile') && tile !== val('tile')) msgs.push(['warn', `Number tile held to ${tile}px: there is no room for ${val('tile')}px with the plate width pinned at ${plateW}px.`]);
  if (has('tile') && plateW !== val('plateW')) msgs.push(['ok', `Plate widened to ${plateW}px to hold ${tile}px tiles.`]);
  if (namePx < val('nameMax')) msgs.push([has('nameMax') ? 'warn' : 'ok', `Name set at ${namePx}px: it only fits that size beside the disc.`]);
  if (disc.cy - disc.d / 2 < 0) msgs.push(['warn', 'Disc runs off the top of the frame.']);
  if (disc.cx + disc.d / 2 > 1920) msgs.push(['warn', 'Disc runs off the side of the frame.']);
  const values = { plateW, discD, discOX, discOY, tile, nameMax: val('nameMax') };
  const state = Object.fromEntries(Object.keys(P).map(k => [k, has(k) ? 'pinned' : 'default']));
  if (plateW !== val('plateW')) state.plateW = 'derived';
  if (tile !== val('tile')) state.tile = 'derived';
  return { values, state, derived: { plateH, namePx }, msgs,
    geometry: { plate, disc, name: { x: plate.x + R.pad, y: nameY, px: namePx, lane: Math.max(40, Math.floor(nameLane)) }, plastic: { x: plate.x + R.pad, y: plasticY, px: 34 },
      tiles: { x: plate.x + R.pad, y: tilesY, size: tile, gap: R.gap }, scrim: { x: plate.x, y: plate.y, w: plateW + 140, h: plateH } } };
}
/** Mirror a left-anchored B01 geometry for a disc on the left (the plate in the bottom-right corner). */
function mirrorB01(g) {
  const mx = x => HW - x, rect = r => ({ ...r, x: HW - r.x - r.w });
  return { plate: rect(g.plate), disc: { ...g.disc, cx: mx(g.disc.cx) }, name: { ...g.name, x: mx(g.name.x) }, plastic: { ...g.plastic, x: mx(g.plastic.x) },
    tiles: { ...g.tiles, x: mx(g.tiles.x) }, scrim: rect(g.scrim) };
}
async function renderB01Recipe(ctx, rd, environment, appearance, pinned) {
  const right = (appearance?.discSide ?? 'right') === 'left', align = right ? 'right' : 'left', name = String(rd.moldName ?? '').toUpperCase();
  const nameWidth = px => { ctx.font = `800 ${px}px ${DISPLAY}`; return ctx.measureText(name).width; };
  const solved = solveB01(pinned, nameWidth), g = right ? mirrorB01(solved.geometry) : solved.geometry, { plate, disc } = g;
  scrimH(ctx, g.scrim.x, g.scrim.y, g.scrim.w, g.scrim.h, right, appearance);
  if (appearance?.frame) drawFrame(ctx, g.scrim.x, g.scrim.y, g.scrim.w, g.scrim.h);
  ctx.fillStyle = appearance?.accentColor ?? ACID;
  ctx.fillRect(right ? plate.x + plate.w - 6 : plate.x, plate.y, 6, plate.h);
  await drawHeroDisc(environment, ctx, rd.photoSrc, disc.cx, disc.cy, disc.d, { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // The name was fitted to its lane by the solver; the lane is also the canvas guard, as in the fixed card.
  drawPresetName(ctx, rd.moldName, g.name.x, g.name.y, g.name.lane, g.name.px, align);
  const pw = plasticLine(rd);
  if (pw) drawQuietLine(ctx, pw, g.plastic.x, g.plastic.y, 34, align, g.name.lane);
  drawAppearanceTiles(ctx, flightTiles(rd), g.tiles.x, g.tiles.y, g.tiles.size, g.tiles.gap, Math.round(44 * g.tiles.size / 74), appearance, align);
  environment.solved = { layout: 'b01', side: right ? 'left' : 'right', ...solved, geometry: g };
}

// The fixed card's own parts, reported the same way, so its handles sit on it before anything is pinned (drawing unchanged).
function fixedB01Solved(right) {
  const P = B01_PARTS, start = Object.fromEntries(Object.keys(P).map(k => [k, P[k].start])), y = 1080 - 48 - 330;
  const g = { plate: { x: 48, y, w: 620, h: 330 }, disc: { cx: 48 + 620 + 40, cy: y - 60, d: 420 }, name: { x: 84, y: y + 132, px: 104, lane: 400 },
    plastic: { x: 84, y: y + 182, px: 34 }, tiles: { x: 84, y: y + 212, size: 74, gap: 14 }, scrim: { x: 48, y, w: 760, h: 330 } };
  return { layout: 'b01', side: right ? 'left' : 'right', values: start, state: Object.fromEntries(Object.keys(P).map(k => [k, 'default'])),
    derived: { plateH: 330, namePx: 104 }, msgs: [], fixed: true, geometry: right ? mirrorB01(g) : g };
}

async function renderB01(ctx     , rd              , environment                       , appearance                ) {
  if (environment?.recipe) return renderB01Recipe(ctx, rd, environment, appearance, environment.recipe);
  if (environment) environment.solved = fixedB01Solved((appearance?.discSide ?? 'right') === 'left');
  // Card footprint: bottom-left, 620x380.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const cx0 = right ? HW - 48 - 620 : 48, cy0 = HH - 48 - 330, cw = 620, ch = 330;
  // Defended type zone: scrim behind the card only, fading right.
  scrimH(ctx, right ? cx0 - 140 : cx0, cy0, cw + 140, ch, right, appearance);
  if (appearance?.frame) drawFrame(ctx, right ? cx0 - 140 : cx0, cy0, cw + 140, ch);
  ctx.fillStyle = appearance?.accentColor ?? ACID;
  ctx.fillRect(right ? cx0 + cw - 6 : cx0, cy0, 6, ch);
  // Hero breaks out, upright, crossing the card's top-right corner.
  await drawHeroDisc(environment, ctx, rd.photoSrc, right ? cx0 - 40 : cx0 + cw + 40, cy0 - 60, 420,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 }); // Thro r2: the disc photo is never rotated (was tiltDeg: 12)
  // Type stays inside the card.
  const nx = right ? cx0 + cw - 36 : cx0 + 36;
  drawPresetName(ctx, rd.moldName, nx, cy0 + 132, cw - 220, 104, right ? 'right' : 'left');
  const pw = plasticLine(rd);
  if (pw) drawQuietLine(ctx, pw, nx, cy0 + 182, 34, right ? 'right' : 'left', cw - 220); // typed plastic stays in the name lane
  drawAppearanceTiles(ctx, flightTiles(rd), nx, cy0 + 212, 74, 14, 44, appearance, right ? 'right' : 'left');
}
presetRenderers.b01 = renderB01;

/** B02 Smoky Fade Slab (2024 Topps) — CORNER CARD.
 * Compact slab in the bottom-left. The disc sits just beyond the name's
 * trailing edge: three depth layers (scrim, disc, name).
 * DISCLEGIBILITY · THREE DEPTH LAYERS · GRADIENT NOT BOX */
async function renderB02(ctx     , rd              , environment                       , appearance                ) {
  // Card footprint: bottom-left, 600x360.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const cx0 = right ? HW - 48 - 600 : 48, cy0 = HH - 48 - 315, cw = 600, ch = 315;
  // Layer 1: smoky gradient slab, card-sized, fading up and right.
  scrimV(ctx, cx0 - 20, cy0 - 60, cw + 160, ch + 60, appearance);
  const nx = right ? cx0 + cw - 36 : cx0 + 36;
  // Layer 2: hero at the card's top-right, beyond the name's reading lane.
  ctx.font = `800 120px ${DISPLAY}`;
  const nameW = Math.min(ctx.measureText(rd.moldName.toUpperCase()).width, cw - 200);
  const d = 380;
  const dcx = right ? nx - nameW - 310 : nx + nameW + 310; // enough air protects the name at preview size
  await drawHeroDisc(environment, ctx, rd.photoSrc, dcx, cy0 + 30, d,
    { rim: appearance?.accentColor ?? 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Layer 3: name and stats stay defended inside the slab.
  drawPresetName(ctx, rd.moldName, nx, cy0 + 118, cw - 72, 120, right ? 'right' : 'left');
  const pw = plasticLine(rd);
  if (pw) drawQuietLine(ctx, pw, nx, cy0 + 168, 34, right ? 'right' : 'left', Math.max(260, nameW + 100)); // ends before the disc's near edge (nameW + 120)
  drawAppearanceTiles(ctx, flightTiles(rd), nx, cy0 + 198, 74, 14, 44, appearance, right ? 'right' : 'left');
}
presetRenderers.b02 = renderB02;

/** B03 Trading Plate Break (NFL on Fox) — CORNER CARD.
 * Small rigid plate in the bottom-left. The hero interrupts the plate's
 * top-right corner; the acid pin marks that single rule-break as
 * intentional. PLATE DISCIPLINE · ONE RULE-BREAK */
async function renderB03(ctx     , rd              , environment                       , appearance                ) {
  // Card footprint: bottom-left plate, 580x340.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const px = right ? HW - 48 - 580 : 48, py = HH - 48 - 325, pw = 580, ph = 325;
  ctx.fillStyle = plateFill(appearance, 'rgba(5,7,6,0.82)');
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);
  // The hero breaks the plate's top-right corner.
  const d = 340;
  await drawHeroDisc(environment, ctx, rd.photoSrc, right ? px : px + pw, py, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Type stays disciplined inside the plate, clear of the disc.
  const nx = right ? px + pw - 36 : px + 36;
  drawPresetName(ctx, rd.moldName, nx, py + 128, pw - 220, 100, right ? 'right' : 'left');
  const q = plasticLine(rd);
  if (q) drawQuietLine(ctx, q, nx, py + 178, 34, right ? 'right' : 'left', pw - 220); // typed plastic stays in the name lane
  drawAppearanceTiles(ctx, flightTiles(rd), nx, py + 208, 74, 14, 44, appearance, right ? 'right' : 'left');
}
presetRenderers.b03 = renderB03;

// ---- B04 and B05 from parts and rules (thro, 24 Oct 2026), the first Constraint Lab's rules for these two layouts. As for B01:
// a recipe pins some parts, the rules derive the rest, and with no recipe the card draws exactly as DiscStudio 6.6.1 draws it
// (the code below the solvers is the core's own, unchanged). The rules reproduce the fixed numbers at the starting values.
const pinnedValue = (P, pinned) => {
  const has = k => Object.hasOwn(pinned ?? {}, k);
  const val = k => (has(k) && Number.isFinite(pinned[k]) ? Math.max(P[k].min, Math.min(P[k].max, pinned[k])) : P[k].start);
  return { has, val };
};
const fitNamePx = (nameWidth, maxPx, lane) => { let px = maxPx; while (px > 24 && nameWidth(px) > lane) px -= 2; return px; };
// Where type may run on a band of rows: from the plate's padding to the disc's left edge at those rows, kept clear of the rim.
const laneBeside = (plate, disc, pad, clear, top, bottom) => {
  let right = plate.x + plate.w - pad; const r = disc.d / 2 + 4;
  for (let y = top; y <= bottom; y += 4) { const dy = y - disc.cy; if (Math.abs(dy) < r) right = Math.min(right, disc.cx - Math.sqrt(r * r - dy * dy) - clear); }
  return right;
};
const mirrorX = x => HW - x, mirrorRect = r => ({ ...r, x: HW - r.x - r.w });

export const B04_PARTS = Object.freeze({
  plateW: { start: 620, min: 360, max: 1100, label: 'Plate width', unit: 'px' },
  discD: { start: 280, min: 140, max: 560, label: 'Disc size', unit: 'px' },
  peakAt: { start: 0.55, min: 0.25, max: 0.85, label: 'Peak along the plate (× width)', unit: '' },
  arcRise: { start: 85, min: 30, max: 260, label: 'Arc rise', unit: 'px' },
  tile: { start: 62, min: 40, max: 120, label: 'Number tile', unit: 'px' },
  nameMax: { start: 88, min: 40, max: 180, label: 'Largest name size', unit: 'px' },
});
// From the bottom of the plate up: name baseline, the tiles, the arc's tails, its peak, the plate's top. 44 + (14 + 0.75 × 88) + 62 + 19 + 85 + 90 = 380.
const B04_RULES = Object.freeze({ margin: 48, pad: 36, gap: 14, bottom: 44, nameGap: 14, tailGap: 19, peakPad: 90, seat: 18, tailIn: 40, tailOut: 30, scrimRun: 120 });
/** Solve B04 for a recipe (left-anchored frame). The name runs the plate's full width; the disc sits on the arc's peak like a ball on a hill. */
export function solveB04(pinned, nameWidth) {
  const R = B04_RULES, P = B04_PARTS, { has, val } = pinnedValue(P, pinned), msgs = [];
  const rowW = t => 4 * t + 3 * R.gap, discD = val('discD'), rise = val('arcRise'), peakAt = val('peakAt'), nameMax = val('nameMax');
  let plateW = val('plateW'), tile = val('tile');
  // Rule: the four tiles fit the plate; a pinned tile widens an unpinned plate instead.
  if (rowW(tile) > plateW - 2 * R.pad) {
    if (has('tile') && !has('plateW')) plateW = Math.min(P.plateW.max, Math.ceil(rowW(tile) + 2 * R.pad));
    if (rowW(tile) > plateW - 2 * R.pad) tile = Math.max(P.tile.min, Math.floor((plateW - 2 * R.pad - 3 * R.gap) / 4));
  }
  // Rule: the plate hugs the name, the tiles, the arc and its peak.
  const nameBand = R.nameGap + 0.75 * nameMax;
  const plateH = Math.round(R.bottom + nameBand + tile + R.tailGap + rise + R.peakPad);
  const plate = { x: R.margin, y: 1080 - R.margin - plateH, w: plateW, h: plateH };
  const nameY = plate.y + plateH - R.bottom, tilesY = Math.round(nameY - nameBand - tile), tailY = tilesY - R.tailGap, peakY = tailY - rise;
  const x0 = plate.x + R.tailIn, x1 = plate.x + plateW - R.tailOut, peakX = plate.x + plateW * peakAt;
  // The arc's two bends keep their places between each tail and the peak (6.6.1: at 30% and 78% of the plate).
  const k0 = (0.30 * 620 - R.tailIn) / (0.55 * 620 - R.tailIn), k1 = (0.78 * 620 - 0.55 * 620) / (620 - R.tailOut - 0.55 * 620);
  const arc = { x0, x1, tailY, peakX, peakY, c0: { x: x0 + (peakX - x0) * k0, y: tailY + 10 }, c1: { x: peakX + (x1 - peakX) * k1, y: peakY + 30 } };
  const disc = { cx: peakX, cy: peakY - discD / 2 + R.seat, d: discD };
  const lane = plateW - 2 * R.pad, namePx = fitNamePx(nameWidth, nameMax, lane);
  if (has('tile') && plateW !== val('plateW')) msgs.push(['ok', `Plate widened to ${plateW}px to hold ${tile}px tiles.`]);
  if (has('tile') && tile !== val('tile')) msgs.push(['warn', `Number tile held to ${tile}px: the plate width is pinned at ${plateW}px.`]);
  if (namePx < nameMax) msgs.push([has('nameMax') ? 'warn' : 'ok', `Name set at ${namePx}px: it only fits that size across the plate.`]);
  if (disc.cy - disc.d / 2 < 0) msgs.push(['warn', 'Disc runs off the top of the frame.']);
  const values = { plateW, discD, peakAt, arcRise: rise, tile, nameMax };
  const state = Object.fromEntries(Object.keys(P).map(k => [k, has(k) ? 'pinned' : 'default']));
  if (plateW !== val('plateW')) state.plateW = 'derived';
  if (tile !== val('tile')) state.tile = 'derived';
  return { values, state, derived: { plateH, namePx }, msgs,
    geometry: { plate, disc, arc, name: { x: plate.x + R.pad, y: nameY, px: namePx, lane }, tiles: { x: plate.x + R.pad, y: tilesY, size: tile, gap: R.gap },
      scrim: { x: plate.x, y: plate.y, w: plateW + R.scrimRun, h: plateH } } };
}
function mirrorB04(g) {
  const a = g.arc, pt = p => ({ x: mirrorX(p.x), y: p.y });
  return { plate: mirrorRect(g.plate), disc: { ...g.disc, cx: mirrorX(g.disc.cx) }, name: { ...g.name, x: mirrorX(g.name.x) }, tiles: { ...g.tiles, x: mirrorX(g.tiles.x) },
    arc: { ...a, x0: mirrorX(a.x0), x1: mirrorX(a.x1), peakX: mirrorX(a.peakX), c0: pt(a.c0), c1: pt(a.c1) }, scrim: mirrorRect(g.scrim) };
}
async function renderB04Recipe(ctx, rd, environment, appearance, pinned) {
  const right = (appearance?.discSide ?? 'right') === 'left', align = right ? 'right' : 'left', name = String(rd.moldName ?? '').toUpperCase();
  const nameWidth = px => { ctx.font = `800 ${px}px ${DISPLAY}`; return ctx.measureText(name).width; };
  const solved = solveB04(pinned, nameWidth), g = right ? mirrorB04(solved.geometry) : solved.geometry, a = g.arc;
  scrimH(ctx, g.scrim.x, g.scrim.y, g.scrim.w, g.scrim.h, right, appearance);
  ctx.strokeStyle = appearance?.accentColor ?? ACID; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a.x0, a.tailY); ctx.quadraticCurveTo(a.c0.x, a.c0.y, a.peakX, a.peakY); ctx.quadraticCurveTo(a.c1.x, a.c1.y, a.x1, a.tailY); ctx.stroke();
  await drawHeroDisc(environment, ctx, rd.photoSrc, g.disc.cx, g.disc.cy, g.disc.d, { rim: 'rgba(255,255,255,0.9)', rimWidth: 7 });
  drawAppearanceTiles(ctx, flightTiles(rd), g.tiles.x, g.tiles.y, g.tiles.size, g.tiles.gap, Math.round(36 * g.tiles.size / 62), appearance, align);
  drawPresetName(ctx, rd.moldName, g.name.x, g.name.y, g.name.lane, g.name.px, align);
  environment.solved = { layout: 'b04', side: right ? 'left' : 'right', ...solved, geometry: g };
}
function fixedB04Solved(right) {
  const P = B04_PARTS, x = 48, y = 1080 - 48 - 380, w = 620;
  const arc = { x0: x + 40, x1: x + w - 30, tailY: y + 175, peakX: x + w * 0.55, peakY: y + 90, c0: { x: x + w * 0.30, y: y + 185 }, c1: { x: x + w * 0.78, y: y + 120 } };
  const g = { plate: { x, y, w, h: 380 }, disc: { cx: arc.peakX, cy: arc.peakY - 140 + 18, d: 280 }, arc, name: { x: x + 36, y: y + 336, px: 88, lane: w - 72 },
    tiles: { x: x + 36, y: y + 194, size: 62, gap: 14 }, scrim: { x, y, w: w + 120, h: 380 } };
  return { layout: 'b04', side: right ? 'left' : 'right', values: Object.fromEntries(Object.keys(P).map(k => [k, P[k].start])), state: Object.fromEntries(Object.keys(P).map(k => [k, 'default'])),
    derived: { plateH: 380, namePx: 88 }, msgs: [], fixed: true, geometry: right ? mirrorB04(g) : g };
}

export const B05_PARTS = Object.freeze({
  plateW: { start: 600, min: 360, max: 1100, label: 'Plate width', unit: 'px' },
  discD: { start: 340, min: 160, max: 640, label: 'Disc size', unit: 'px' },
  discOX: { start: 40 / 340, min: -0.6, max: 0.6, label: 'Disc overhang (× disc size)', unit: '' },
  discOY: { start: 130 / 340, min: -0.6, max: 0.9, label: 'Disc drop (× disc size)', unit: '' },
  tile: { start: 58, min: 40, max: 120, label: 'Number tile', unit: 'px' },
  coinD: { start: 120, min: 72, max: 240, label: 'Zoom circle', unit: 'px' },
  nameMax: { start: 96, min: 40, max: 180, label: 'Largest name size', unit: 'px' },
});
// From the top of the plate down: 36, the row of tiles and the zoom circle (as tall as the circle less 4), 100 to the plastic line, then
// 12 + 0.75 × the name to its baseline, then 44. 36 + 116 + 100 + 12 + 72 + 44 = 380. As 6.6.1 draws it, the row keeps
// 18px clear of the disc's rim and the name and plastic line 8px.
const B05_RULES = Object.freeze({ margin: 48, pad: 36, gap: 12, top: 36, coinGap: 24, coinRise: 4, plasticDrop: 100, nameGap: 12, bottom: 44, rowClear: 18, typeClear: 8, nameIn: 116, plasticIn: 220, minCoin: 72, scrimRun: 140 });
/** Solve B05 for a recipe (left-anchored frame). Tiles and the zoom circle on top, plastic and name along the bottom, the hero on the plate's right edge. */
export function solveB05(pinned, nameWidth) {
  const R = B05_RULES, P = B05_PARTS, { has, val } = pinnedValue(P, pinned), msgs = [];
  const rowW = t => 4 * t + 3 * R.gap, discD = val('discD'), nameMax = val('nameMax');
  let plateW = val('plateW'), tile = val('tile'), coinD = val('coinD'), plate, plateH, disc, rowLane = 0;
  for (let pass = 0; pass < 8; pass++) {
    // Rule: the plate hugs the top row, the plastic line and the name.
    plateH = Math.round(R.top + Math.max(tile, coinD - R.coinRise) + R.plasticDrop + R.nameGap + 0.75 * nameMax + R.bottom);
    plate = { x: R.margin, y: 1080 - R.margin - plateH, w: plateW, h: plateH };
    // Rule: the disc rides the plate's right edge.
    disc = { cx: plate.x + plateW + val('discOX') * discD, cy: plate.y + val('discOY') * discD, d: discD };
    const nx = plate.x + R.pad, rowTop = plate.y + R.top - R.coinRise;
    // Rule: the tiles and the zoom circle stay clear of the disc. Too tight: the circle gives way first (to 72px), then the tiles;
    // a pinned tile or circle widens an unpinned plate instead. Room to spare: they grow back to their starting sizes.
    rowLane = laneBeside(plate, disc, R.pad, R.rowClear, rowTop, rowTop + Math.max(tile, coinD)) - nx;
    const need = rowW(tile) + R.coinGap + coinD;
    let nextTile = tile, nextCoin = coinD, nextPlateW = plateW;
    if (need > rowLane) {
      let over = Math.ceil(need - rowLane);
      if ((has('tile') || has('coinD')) && !has('plateW')) nextPlateW = Math.min(P.plateW.max, plateW + over);
      else {
        if (!has('coinD')) { nextCoin = Math.max(R.minCoin, coinD - over); over -= coinD - nextCoin; }
        if (over > 0 && !has('tile')) nextTile = Math.max(P.tile.min, tile - Math.ceil(over / 4));
      }
    } else {
      let spare = Math.floor(rowLane - need);
      if (!has('tile') && tile < P.tile.start) { nextTile = Math.min(P.tile.start, tile + Math.floor(spare / 4)); spare -= 4 * (nextTile - tile); }
      if (!has('coinD') && coinD < P.coinD.start) nextCoin = Math.min(P.coinD.start, coinD + spare);
    }
    const settled = nextTile === tile && nextCoin === coinD && nextPlateW === plateW;
    tile = nextTile; coinD = nextCoin; plateW = nextPlateW;
    if (settled) break;
  }
  const nx = plate.x + R.pad, nameY = plate.y + plateH - R.bottom, plasticY = plate.y + R.top + Math.max(tile, coinD - R.coinRise) + R.plasticDrop;
  // Rule: the name and the plastic line run along the bottom, clear of the disc.
  const nameLane = Math.max(40, Math.floor(Math.min(plateW - R.nameIn, laneBeside(plate, disc, R.pad, R.typeClear, nameY - 0.75 * nameMax, nameY) - nx)));
  const plasticLane = Math.max(40, Math.floor(Math.min(plateW - R.plasticIn, laneBeside(plate, disc, R.pad, R.typeClear, plasticY - 24, plasticY) - nx)));
  const namePx = fitNamePx(nameWidth, nameMax, nameLane);
  const over = Math.ceil(rowW(tile) + R.coinGap + coinD - rowLane);
  if (over > 0) msgs.push(['warn', `Numbers and zoom circle run ${over}px into the disc's clearance: widen the plate or move the disc out.`]);
  if ((has('tile') || has('coinD')) && plateW !== val('plateW')) msgs.push(['ok', `Plate widened to ${plateW}px to hold the tiles and the zoom circle.`]);
  if (!has('coinD') && coinD < P.coinD.start) msgs.push(['ok', `Zoom circle shrank to ${coinD}px to make room beside the disc.`]);
  if (!has('tile') && tile < P.tile.start) msgs.push(['ok', `Number tile shrank to ${tile}px to make room beside the disc.`]);
  if (namePx < nameMax) msgs.push([has('nameMax') ? 'warn' : 'ok', `Name set at ${namePx}px: it only fits that size beside the disc.`]);
  if (disc.cy - disc.d / 2 < 0) msgs.push(['warn', 'Disc runs off the top of the frame.']);
  if (disc.cx + disc.d / 2 > 1920) msgs.push(['warn', 'Disc runs off the side of the frame.']);
  const values = { plateW, discD, discOX: val('discOX'), discOY: val('discOY'), tile, coinD, nameMax };
  const state = Object.fromEntries(Object.keys(P).map(k => [k, has(k) ? 'pinned' : 'default']));
  for (const k of ['plateW', 'tile', 'coinD']) if (values[k] !== val(k)) state[k] = 'derived';
  const tilesY = plate.y + R.top;
  return { values, state, derived: { plateH, namePx }, msgs,
    geometry: { plate, disc, coin: { cx: nx + rowW(tile) + R.coinGap + coinD / 2, cy: tilesY - R.coinRise + coinD / 2, d: coinD },
      name: { x: nx, y: nameY, px: namePx, lane: nameLane }, plastic: { x: nx, y: plasticY, px: 32, lane: plasticLane },
      tiles: { x: nx, y: tilesY, size: tile, gap: R.gap }, scrim: { x: plate.x, y: plate.y, w: plateW + R.scrimRun, h: plateH } } };
}
function mirrorB05(g) {
  return { plate: mirrorRect(g.plate), disc: { ...g.disc, cx: mirrorX(g.disc.cx) }, coin: { ...g.coin, cx: mirrorX(g.coin.cx) }, name: { ...g.name, x: mirrorX(g.name.x) },
    plastic: { ...g.plastic, x: mirrorX(g.plastic.x) }, tiles: { ...g.tiles, x: mirrorX(g.tiles.x) }, scrim: mirrorRect(g.scrim) };
}
async function renderB05Recipe(ctx, rd, environment, appearance, pinned) {
  const right = (appearance?.discSide ?? 'right') === 'left', align = right ? 'right' : 'left', name = String(rd.moldName ?? '').toUpperCase();
  const nameWidth = px => { ctx.font = `800 ${px}px ${DISPLAY}`; return ctx.measureText(name).width; };
  const solved = solveB05(pinned, nameWidth), g = right ? mirrorB05(solved.geometry) : solved.geometry;
  scrimH(ctx, g.scrim.x, g.scrim.y, g.scrim.w, g.scrim.h, right, appearance);
  await drawHeroDisc(environment, ctx, rd.photoSrc, g.disc.cx, g.disc.cy, g.disc.d, { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  drawAppearanceTiles(ctx, flightTiles(rd), g.tiles.x, g.tiles.y, g.tiles.size, g.tiles.gap, Math.round(34 * g.tiles.size / 58), appearance, align);
  await drawHeroDisc(environment, ctx, rd.photoSrc, g.coin.cx, g.coin.cy, g.coin.d,
    { rim: appearance?.accentColor ?? ACID, rimWidth: 5, macro: { zoom: 2.6, fx: appearance?.zoomFocus?.x ?? 0.62, fy: appearance?.zoomFocus?.y ?? 0.38 } });
  const q = plasticLine(rd);
  if (q) drawQuietLine(ctx, q, g.plastic.x, g.plastic.y, 32, align, g.plastic.lane);
  drawPresetName(ctx, rd.moldName, g.name.x, g.name.y, g.name.lane, g.name.px, align);
  environment.solved = { layout: 'b05', side: right ? 'left' : 'right', ...solved, geometry: g };
}
function fixedB05Solved(right) {
  const P = B05_PARTS, x = 48, y = 1080 - 48 - 380, w = 600;
  const g = { plate: { x, y, w, h: 380 }, disc: { cx: x + w + 40, cy: y + 130, d: 340 }, coin: { cx: x + 388, cy: y + 92, d: 120 },
    name: { x: x + 36, y: y + 336, px: 96, lane: w - 116 }, plastic: { x: x + 36, y: y + 252, px: 32, lane: w - 220 },
    tiles: { x: x + 36, y: y + 36, size: 58, gap: 12 }, scrim: { x, y, w: w + 140, h: 380 } };
  return { layout: 'b05', side: right ? 'left' : 'right', values: Object.fromEntries(Object.keys(P).map(k => [k, P[k].start])), state: Object.fromEntries(Object.keys(P).map(k => [k, 'default'])),
    derived: { plateH: 380, namePx: 96 }, msgs: [], fixed: true, geometry: right ? mirrorB05(g) : g };
}
/** The layouts drawn from parts and rules: their parts (start, range, label) and their solver. */
export const CARD_RECIPES = Object.freeze({ b01: Object.freeze({ parts: B01_PARTS, solve: solveB01 }), b04: Object.freeze({ parts: B04_PARTS, solve: solveB04 }), b05: Object.freeze({ parts: B05_PARTS, solve: solveB05 }) });

/** B04 Flight-Path Arc (Trollbäck NFL GameDay) — CORNER CARD.
 * Small card in the bottom-left. One acid S-curve lives inside the card;
 * the disc sits on the arc's peak, breaking out slightly above the card.
 * Name and stats attach like stations. The arc is the single motif.
 * SPORT-AUTHENTIC MOTIF · EXIT SPACE · EDITORIAL DRAMA */
async function renderB04(ctx     , rd              , environment                       , appearance                ) {
  if (environment?.recipe) return renderB04Recipe(ctx, rd, environment, appearance, environment.recipe);
  if (environment) environment.solved = fixedB04Solved((appearance?.discSide ?? 'right') === 'left');
  // Card footprint: bottom-left, 620x380.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const cx0 = right ? HW - 48 - 620 : 48, cy0 = HH - 48 - 380, cw = 620, ch = 380;
  // Defended type zone: scrim behind the card only.
  scrimH(ctx, right ? cx0 - 120 : cx0, cy0, cw + 120, ch, right, appearance);
  // The motif: one small S-curve with a peak, inside the card.
  const mirror = (localX        ) => right ? cx0 + cw - (localX - cx0) : localX;
  // Keep both arc tails above the defended title lane, including its longest
  // current catalog mold, while retaining the one continuous flight-path motif.
  const ax0 = mirror(cx0 + 40), ay0 = cy0 + ch - 205;
  const peakX = mirror(cx0 + cw * 0.55), peakY = cy0 + 90;
  const ax1 = mirror(cx0 + cw - 30), ay1 = cy0 + ch - 205;
  ctx.strokeStyle = appearance?.accentColor ?? ACID;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax0, ay0);
  ctx.quadraticCurveTo(mirror(cx0 + cw * 0.30), ay0 + 10, peakX, peakY);
  ctx.quadraticCurveTo(mirror(cx0 + cw * 0.78), peakY + 30, ax1, ay1);
  ctx.stroke();
  // The disc sits on the peak like a ball on a hill, breaking out above.
  const d = 280;
  await drawHeroDisc(environment, ctx, rd.photoSrc, peakX, peakY - d / 2 + 18, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 7 });
  // Numbers row under the arc, then the name along the bottom with the full
  // plate width to grow into (Sam, 21 Oct 2026: numbers on top, name below).
  const nx = right ? cx0 + cw - 36 : cx0 + 36;
  drawAppearanceTiles(ctx, flightTiles(rd), nx, cy0 + ch - 186, 62, 14, 36, appearance, right ? 'right' : 'left');
  drawPresetName(ctx, rd.moldName, nx, cy0 + ch - 44, cw - 72, 88, right ? 'right' : 'left');
}
presetRenderers.b04 = renderB04;

/** B05 Stamp Macro + Hero (Topps 2020-2025) — CORNER CARD.
 * Small card in the bottom-left. The name reads HORIZONTALLY across the
 * top (the vertical-spine bug is fixed). The hero sits right, breaking
 * out; a small acid-rimmed macro coin shows the same subject at 2.6x.
 * DUAL-SCALE IMAGE · HORIZONTAL NAME · PRODUCT DETAIL */
async function renderB05(ctx     , rd              , environment                       , appearance                ) {
  if (environment?.recipe) return renderB05Recipe(ctx, rd, environment, appearance, environment.recipe);
  if (environment) environment.solved = fixedB05Solved((appearance?.discSide ?? 'right') === 'left');
  // Card footprint: bottom-left, 600x380.
  const right = (appearance?.discSide ?? 'right') === 'left';
  const cx0 = right ? HW - 48 - 600 : 48, cy0 = HH - 48 - 380, cw = 600, ch = 380;
  scrimH(ctx, right ? cx0 - 140 : cx0, cy0, cw + 140, ch, right, appearance);
  // Name: horizontal, top of card. Leave a readable lane beside the hero.
  const nx = right ? cx0 + cw - 36 : cx0 + 36;
  // Hero: right side, breaking out top and right.
  const d = 340;
  await drawHeroDisc(environment, ctx, rd.photoSrc, right ? cx0 - 40 : cx0 + cw + 40, cy0 + 130, d,
    { rim: 'rgba(255,255,255,0.9)', rimWidth: 8 });
  // Numbers on top with the macro coin beside them; the name runs along the
  // bottom where it has the most room (Sam, 21 Oct 2026).
  const side = right ? 'right' : 'left';
  const along = (offset        ) => right ? cx0 + cw - offset : cx0 + offset;
  drawAppearanceTiles(ctx, flightTiles(rd), nx, cy0 + 36, 58, 12, 34, appearance, side);
  await drawHeroDisc(environment, ctx, rd.photoSrc, along(36 + 4 * 58 + 3 * 12 + 24 + 60), cy0 + 92, 120,
    { rim: appearance?.accentColor ?? ACID, rimWidth: 5, macro: { zoom: 2.6, fx: appearance?.zoomFocus?.x ?? 0.62, fy: appearance?.zoomFocus?.y ?? 0.38 } });
  const q = plasticLine(rd);
  if (q) drawQuietLine(ctx, q, nx, cy0 + ch - 128, 32, side, cw - 220);
  drawPresetName(ctx, rd.moldName, nx, cy0 + ch - 44, cw - 116, 96, side);
}
presetRenderers.b05 = renderB05;

/** Draw one existing SpotlightCard layout onto a supplied Canvas2D context. */
export async function drawCard(
  context     ,
  disc              ,
  orientation                 ,
  preset                        ,
  environment                       ,
  appearanceInput                 ,
)                {
  if (orientation !== 'horizontal' && orientation !== 'vertical') {
    throw new Error(`orientation must be 'horizontal' or 'vertical', got ${String(orientation)}`);
  }
  if (preset && (U3_COMPARE.includes(preset) || preset === 'u04')) {
    if (orientation !== 'vertical') throw Error(`preset ${preset} is vertical-native; use orientation 'vertical'`);
    if (!environment.createCanvas) throw Error('U3/U4 frame renderer requires a Canvas adapter');
    const renderer = environment.frameRenderer ?? createFrameRenderer({ createCanvas: environment.createCanvas });
    const appearance = appearanceInput ? validateCardAppearance(appearanceInput) : undefined;
    const scene = await cardFrameSnapshot(disc,preset,environment,appearance);
    environment.onFrame?.(renderer.seek(context,scene,0));
    if (!environment.onFrame) renderer.seek(context,scene,0);
    return;
  }
  const rd = await resolveCardDisc(environment, disc);
  if (preset) {
    const fn = presetRenderers[preset];
    if (!fn) throw new Error(`unknown card preset: ${preset}`);
    if (preset[0] === 'u' && orientation !== 'vertical') {
      throw new Error(`preset ${preset} is vertical-native; use orientation 'vertical'`);
    }
    if (preset[0] === 'b' && orientation !== 'horizontal') {
      throw new Error(`preset ${preset} is horizontal-native; use orientation 'horizontal'`);
    }
    const appearance = appearanceInput ? validateCardAppearance(appearanceInput) : undefined;
    await fn(context, rd, environment, appearance);
  } else if (orientation === 'horizontal') await drawHorizontal(environment, context, rd);
  else await drawVertical(environment, context, rd);
}
