// Departures: deliberate variations of terminals away from their defaults, grouped under the frame terminal they vary ("Frame.terminal").
// generate.mjs walks FRAMES x terminals x DEPARTURES, so every Case is a departure from a named frame terminal, plus seeded pairs of compatible departures.
// Each departure has an executable expectation: checks on the enriched, linked result and on what the page displays. Expected numbers come from
// oracle.mjs (plain loops over the raw instances) or from the dates/seconds the departure itself set, never from the code under test.
import { BASE } from './frames.mjs';
import { NAME_POOLS } from './scene.mjs';
import { addDays, dayDiff, fmt1, fmt2, mmss, monthFirst, monthLast, monthName, mergeIntervals, signed } from './util.mjs';
import { latestViews } from './world.mjs';
import { naiveMean } from './oracle.mjs';

const other = (s, pool, current) => s.rng.pick(pool.filter((x) => x !== current));
const withThrow = (s, key, video, disc, a, b) => { s.newCard(key, video, disc, a, b); s.newThrow(`${key}Throw`, video, disc, a, b); };
const R = BASE.releaseDate;

export const DEPARTURES = {
  'Video.publishedAt': [
    {
      id: 'preRelease', kind: 'release-timing', title: 'Card shown 12 days before its mold\'s release (pre-release hype)', touches: ['Video.publishedAt', 'release'], pool: true,
      apply: (s) => s.vary(s.k.video, 'publishedAt', addDays(s.k.release.t.date, -12)),
      focus: { kind: 'pre-release', subject: 'disc' },
      expect: (x) => [
        x.check('release class', 'pre-release', x.release('disc').class),
        x.check('offset in days (published − release)', -12, x.release('disc').offsetDays),
        x.check('alternate frame PreReleaseAppearance selected, certainty', 'certain', x.alts('PreReleaseAppearance')[0]?.t.certainty),
        x.check('release support lists this video at −12 days', true, x.panel().releaseRows.some((r) => r.items.some((i) => i.videoId === x.ids.video && i.offsetDays === -12))),
        x.check('release chip on the card row', 'PRE-RELEASE −12 d', x.row('disc').chips.find((c) => c.kind === 'release')?.text),
        x.attCheck('disc'),
        ...x.says('pre-release', 'disc', '12 days before', x.attPhrase('disc')),
      ],
    },
    {
      id: 'releaseWindow', kind: 'release-timing', title: 'Card shown 9 days after release (inside the 30-day release window)', touches: ['Video.publishedAt', 'release'], pool: true,
      apply: (s) => s.vary(s.k.video, 'publishedAt', addDays(s.k.release.t.date, 9)),
      focus: { kind: 'release-window', subject: 'disc' },
      expect: (x) => [
        x.check('release class', 'release-window', x.release('disc').class),
        x.check('offset in days', 9, x.release('disc').offsetDays),
        x.check('no PreReleaseAppearance selected', 0, x.alts('PreReleaseAppearance').length),
        x.check('release support lists this video at +9 days', true, x.panel().releaseRows.some((r) => r.items.some((i) => i.videoId === x.ids.video && i.offsetDays === 9))),
        x.check('release chip', 'RELEASE WINDOW +9 d', x.row('disc').chips.find((c) => c.kind === 'release')?.text),
        x.attCheck('disc'),
        ...x.says('release-window', 'disc', '9 days after its release', x.attPhrase('disc')),
      ],
    },
  ],
  'Release.datePrecision': [
    {
      id: 'monthInside', kind: 'release-timing', title: 'Release known only to the month, and the video falls inside that month', touches: ['Release.date', 'Release.datePrecision', 'Video.publishedAt', 'release'], pool: true,
      apply: (s) => { s.vary(s.k.release, 'date', s.k.video.t.publishedAt.slice(0, 7)); s.vary(s.k.release, 'datePrecision', 'month'); },
      focus: { kind: 'release-month', subject: 'disc' },
      expect: (x) => {
        const p = x.k.video.t.publishedAt, ym = x.k.release.t.date, row = x.release('disc'), alt = x.alts('PreReleaseAppearance')[0];
        return [
          x.check('release class', 'release-month', row.class),
          x.check('offset range lower bound (published − last day of month)', dayDiff(p, monthLast(ym)), row.offsetMin),
          x.check('offset range upper bound (published − first day of month)', dayDiff(p, monthFirst(ym)), row.offsetMax),
          x.check('PreReleaseAppearance selected with certainty "possible"', 'possible', alt?.t.certainty),
          x.check('the month-precision mismatch selected the interval-offsets transformation', true, x.noted('dayPrecision', 'release')),
          x.check('release chip', 'RELEASE MONTH (day unknown)', x.row('disc').chips.find((c) => c.kind === 'release')?.text),
          x.attCheck('disc'),
          ...x.says('release-month', 'disc', monthName(ym), 'day is unknown'),
        ];
      },
    },
  ],
  'Release.date': [
    {
      id: 'monthBefore', kind: 'release-timing', title: 'Release known only to the month, and the video was published before that month', touches: ['Release.date', 'Release.datePrecision', 'Video.publishedAt', 'release'], pool: true,
      apply: (s) => { s.vary(s.k.release, 'date', '2026-06'); s.vary(s.k.release, 'datePrecision', 'month'); },
      focus: { kind: 'pre-release', subject: 'disc' },
      expect: (x) => {
        const p = x.k.video.t.publishedAt, row = x.release('disc'), alt = x.alts('PreReleaseAppearance')[0];
        const near = dayDiff('2026-06-01', p), far = dayDiff('2026-06-30', p);
        return [
          x.check('release class', 'pre-release', row.class),
          x.check('certain, not merely possible', 'certain', alt?.t.certainty),
          x.check('days before release: nearest', near, alt?.t.daysBeforeMin),
          x.check('days before release: farthest', far, alt?.t.daysBeforeMax),
          x.check('release chip shows the range', `PRE-RELEASE ${signed(-near)} to ${signed(-far)} d`, x.row('disc').chips.find((c) => c.kind === 'release')?.text),
          x.attCheck('disc'),
          ...x.says('pre-release', 'disc', `${near} to ${far} days before`, 'June 2026'),
        ];
      },
    },
  ],
  'Disc.runLabel': [
    {
      id: 'newRun', kind: 'release-timing', title: 'A new run of an old mold: the disc is judged against its own run\'s release, not the mold\'s original', touches: ['Disc.runLabel', 'Video.publishedAt', 'release'],
      apply: (s) => {
        s.vary(s.k.disc, 'runLabel', 'Tour Series');
        const r2 = s.newRelease('release2', s.k.mold, '2026-06-01', { runLabel: 'Tour Series', kind: 'new-run' });
        s.mark(r2, 'runLabel'); s.mark(r2, 'kind');
      },
      focus: { kind: 'pre-release', subject: 'disc' },
      expect: (x) => {
        const row = x.release('disc'), want = dayDiff(x.k.video.t.publishedAt, '2026-06-01');
        return [
          x.check('the disc links to the Tour Series release, not the mold\'s February release', x.ids.release2, x.E.discs[x.ids.disc].releaseId),
          x.check('release class against the run', 'pre-release', row.class),
          x.check('offset in days', want, row.offsetDays),
          x.check('the original release exists and is not used', true, !!x.k.release && x.E.discs[x.ids.disc].releaseId !== x.ids.release),
          x.attCheck('disc'),
          ...x.says('pre-release', 'disc', `${-want} days before`, 'Tour Series'),
        ];
      },
    },
  ],
  'Bag.appliedToVideoIds': [
    {
      id: 'manyVideos', kind: 'bag', title: 'The same physical disc appears in three videos through one Bag', touches: ['Bag.appliedToVideoIds', 'scene:video2'], solo: true,
      apply: (s) => {
        const { k, p } = s;
        const v2 = s.newVideo('video2', k.creatorChannel, { title: 'Second round, same bag', publishedAt: '2026-05-24', viewSnapshots: [{ at: '2026-05-31', views: p.views * 2 }] });
        const v3 = s.newVideo('video3', k.creatorChannel, { title: 'Third round, same bag', publishedAt: '2026-06-07', viewSnapshots: [{ at: '2026-06-14', views: p.views * 3 }] });
        withThrow(s, 'card2', v2.video, k.disc, p.a, p.b); withThrow(s, 'card3', v3.video, k.disc, p.a, p.b);
        s.vary(k.bag, 'appliedToVideoIds', [k.video.id, v2.video.id, v3.video.id]);
      },
      focus: { kind: 'multi-video', subject: 'disc' },
      expect: (x) => {
        const vids = ['video', 'video2', 'video3'], per = vids.map((v) => x.oracle(v, 'disc').value);
        return [
          x.check('appearances of the disc (one per video)', 3, x.E.appearances.filter((a) => a.discId === x.ids.disc).length),
          x.check('all three videos use the same bag snapshot', 1, new Set(vids.map((v) => x.E.videos[x.ids[v]].bagId)).size),
          ...vids.map((v, i) => x.check(`attention in ${v} = oracle`, per[i], x.att('disc', v), 'near')),
          x.check('disc total = sum over the three videos', per.reduce((s, v) => s + v, 0), x.M.attention.byDisc[x.ids.disc].value, 'near'),
          x.check('creator panel shows the disc in three videos', 3, x.panel().videos.filter((v) => v.discs.some((d) => d.discId === x.ids.disc)).length),
          ...x.says('multi-video', 'disc', '3 videos', fmt1(per.reduce((s, v) => s + v, 0))),
        ];
      },
    },
  ],
  'Bag.discIds': [
    {
      id: 'bagChange', kind: 'bag', title: 'The Bag changes between videos: one disc leaves, another joins', touches: ['Bag.discIds', 'scene:video2', 'scene:disc2', 'Video.publishedAt'], solo: true,
      apply: (s) => {
        const { k, p } = s;
        const m2 = s.newMold('mold2', k.brand, other(s, NAME_POOLS.MOLDS, p.moldName)); s.newRelease('release2', m2, R);
        const m3 = s.newMold('mold3', k.brand, other(s, NAME_POOLS.MOLDS.filter((n) => n !== m2.t.name), p.moldName)); s.newRelease('release3', m3, R);
        const d2 = s.newDisc('disc2', k.creator, k.creatorShelf, m2, {}, { record: true });
        const d3 = s.newDisc('disc3', k.creator, k.creatorShelf, m3, {}, { record: true });
        const v2 = s.newVideo('video2', k.creatorChannel, { title: 'The next round, new bag', publishedAt: '2026-05-24', viewSnapshots: [{ at: '2026-05-31', views: p.views * 2 }] });
        s.vary(k.bag, 'discIds', [k.disc.id, d2.id]);
        s.newBag('bag2', k.creator, [k.disc, d3], [v2.video]);
        withThrow(s, 'card2', k.video, d2, p.a + 40, p.a + 60);
        withThrow(s, 'card3', v2.video, k.disc, p.a, p.b); withThrow(s, 'card4', v2.video, d3, p.a + 40, p.a + 60);
      },
      focus: { kind: 'bag-change', subject: 'creator' },
      expect: (x) => [
        x.check('disc 1 appears in both videos', ['video', 'video2'], x.M.attention.byDisc[x.ids.disc].videoIds.map((id) => Object.keys(x.ids).find((k) => x.ids[k] === id)).sort((a, b) => a.length - b.length || a.localeCompare(b))),
        x.check('the removed disc appears only in the first video', [x.ids.video], x.E.appearances.filter((a) => a.discId === x.ids.disc2).map((a) => a.videoId)),
        x.check('the added disc appears only in the second video', [x.ids.video2], x.E.appearances.filter((a) => a.discId === x.ids.disc3).map((a) => a.videoId)),
        x.check('the two videos point at different bag snapshots', true, x.E.videos[x.ids.video].bagId !== x.E.videos[x.ids.video2].bagId),
        x.attCheck('disc2'), x.attCheck('disc3', 'video2'),
        ...x.says('bag-change', 'creator', 'added', 'removed'),
      ],
    },
    {
      id: 'bagDiscNoCard', kind: 'bag', title: 'A disc is in the Bag but never gets a card or a marked throw', touches: ['Bag.discIds', 'scene:disc2', 'scene:mold2'], pool: true,
      apply: (s) => {
        const m2 = s.newMold('mold2', s.k.brand, other(s, NAME_POOLS.MOLDS, s.p.moldName)); s.newRelease('release2', m2, R);
        const d2 = s.newDisc('disc2', s.k.creator, s.k.creatorShelf, m2, {}, { record: true });
        s.vary(s.k.bag, 'discIds', [s.k.disc.id, d2.id]);
      },
      focus: { kind: 'bag-no-card', subject: 'disc2' },
      expect: (x) => [
        x.check('the bag snapshot lists both discs', 2, x.k.bag.t.discIds.length),
        x.check('the carried-but-never-shown disc has 0 appearances', 0, x.E.appearances.filter((a) => a.discId === x.ids.disc2).length),
        x.check('and no attention row', true, x.M.attention.byDisc[x.ids.disc2] === undefined),
        x.check('the panel lists the disc in the bag, not among the cards', [true, false], [x.panel().videos[0].bag.discs.length === 2, x.panel().videos[0].discs.some((d) => d.discId === x.ids.disc2)]),
        x.attCheck('disc'),
        ...x.says('bag-no-card', 'disc2', 'not being on screen', '0 appearances'),
      ],
    },
  ],
  'Shelf.discIds': [
    {
      id: 'twoPlastics', kind: 'shelf', title: 'Two discs of the same mold, in different plastics, on one Shelf', touches: ['Shelf.discIds', 'Bag.discIds', 'scene:disc2'], solo: true,
      apply: (s) => {
        const { k, p } = s;
        const d2 = s.newDisc('disc2', k.creator, k.creatorShelf, k.mold, { plastic: other(s, NAME_POOLS.PLASTICS.filter((n) => n !== 'Pro'), p.plastic) }, { record: true });
        s.mark(d2, 'plastic');
        s.vary(k.bag, 'discIds', [k.disc.id, d2.id]);
        withThrow(s, 'card2', k.video, d2, p.b + 10, p.b + 30);
      },
      focus: { kind: 'two-plastics', subject: 'creator' },
      expect: (x) => {
        const o1 = x.oracle('video', 'disc').value, o2 = x.oracle('video', 'disc2').value;
        return [
          x.check('two separate discs on the shelf', 2, x.k.creatorShelf.t.discIds.length),
          x.check('each has its own appearance', [1, 1], [x.apps('disc').length, x.apps('disc2').length]),
          x.check('both link to the same mold', x.ids.mold, x.E.discs[x.ids.disc2].moldId),
          x.check('the plastics differ', true, x.k.disc.t.plastic !== x.k.disc2.t.plastic),
          x.attCheck('disc'), x.attCheck('disc2'),
          x.check('mold total for this creator = sum of the two discs', o1 + o2, x.M.attention.byMold[x.ids.mold].perCreator[x.ids.creator], 'near'),
          ...x.says('two-plastics', 'creator', fmt1(o1), fmt1(o2), fmt1(o1 + o2)),
        ];
      },
    },
  ],
  'Disc.moldId': [
    {
      id: 'unknownMold', kind: 'catalog', title: 'A disc whose mold is unknown to the catalog', touches: ['Disc.moldId', 'Disc.moldName', 'bucket', 'release'], pool: true,
      apply: (s) => { s.vary(s.k.disc, 'moldId', null); s.vary(s.k.disc, 'moldName', 'Gloaming X-7'); },
      focus: { kind: 'provisional-mold', subject: 'disc' },
      expect: (x) => [
        x.check('mold resolved by', 'provisional', x.E.discs[x.ids.disc].resolvedBy),
        x.check('alternate frame ProvisionalMold selected, with the typed name', ['Gloaming X-7'], x.alts('ProvisionalMold').map((a) => a.t.typedName)),
        x.check('no manufacturer and no release can be attached', [null, null], [x.E.discs[x.ids.disc].manufacturerId, x.E.discs[x.ids.disc].releaseId]),
        x.check('sponsor bucket falls to "unknown-brand"', 'unknown-brand', x.apps('disc')[0].bucket),
        x.check('chips say so', ['MOLD NOT IN CATALOG', 'BRAND UNKNOWN'], [x.row('disc').chips.find((c) => c.kind === 'catalog')?.text, x.row('disc').chips.find((c) => c.kind === 'sponsor')?.text]),
        x.attCheck('disc'),
        ...x.says('provisional-mold', 'disc', 'not in the mold catalog', 'Gloaming X-7'),
      ],
    },
    {
      id: 'sloppyName', kind: 'catalog', title: 'The creator typed the mold name sloppily (capitals, trailing space); it still links', touches: ['Disc.moldId', 'Disc.moldName', 'release'], pool: true,
      apply: (s) => { s.vary(s.k.disc, 'moldId', null); s.vary(s.k.disc, 'moldName', `${s.p.moldName.toUpperCase()} `); },
      focus: { kind: 'normalized-name', subject: 'disc' },
      expect: (x) => [
        x.check('mold resolved by', 'normalized', x.E.discs[x.ids.disc].resolvedBy),
        x.check('it links to the real catalog mold', x.ids.mold, x.E.discs[x.ids.disc].moldId),
        x.check('and through it to the release', x.ids.release, x.E.discs[x.ids.disc].releaseId),
        x.check('no provisional mold was made', 0, x.alts('ProvisionalMold').length),
        x.check('the name-resolution transformation was recorded', true, x.noted('moldResolved', 'disc')),
        x.attCheck('disc'),
        ...x.says('normalized-name', 'disc', 'normalised spelling'),
      ],
    },
  ],
  'SponsorDeal.end': [
    {
      id: 'brandSwitch', kind: 'sponsor', title: 'The sponsor deal changes brand in the middle of a quarter', touches: ['SponsorDeal.end', 'scene:video2', 'scene:disc2', 'Video.publishedAt', 'bucket'], solo: true,
      apply: (s) => {
        const { k, p } = s;
        s.vary(k.deal, 'end', '2026-05-15');
        const brandB = s.newBrand('brandB', other(s, NAME_POOLS.BRANDS, p.brandName));
        const moldB = s.newMold('moldB', brandB, other(s, NAME_POOLS.MOLDS, p.moldName)); s.newRelease('releaseB', moldB, R);
        const dealB = s.newDeal('dealB', k.creator, brandB, '2026-05-16', BASE.dealEnd); s.mark(dealB, 'start');
        const discB = s.newDisc('discB', k.creator, k.creatorShelf, moldB, {}, { record: true });
        const v2 = s.newVideo('video2', k.creatorChannel, { title: 'First video under the new sponsor', publishedAt: '2026-05-20', viewSnapshots: [{ at: '2026-05-27', views: p.views * 2 }] });
        s.newBag('bag2', k.creator, [k.disc, discB], [v2.video]);
        withThrow(s, 'card2', v2.video, discB, p.a, p.b); withThrow(s, 'card3', v2.video, k.disc, p.b + 10, p.b + 30);
      },
      focus: { kind: 'brand-switch', subject: 'creator' },
      expect: (x) => {
        const oA = x.oracle('video', 'disc').value, oB = x.oracle('video2', 'discB').value, oOld = x.oracle('video2', 'disc').value;
        const rows = x.M.exposure.rows;
        const sponsorA = rows.find((r) => r.kind === 'sponsor' && r.manufacturerId === x.ids.brand), sponsorB = rows.find((r) => r.kind === 'sponsor' && r.manufacturerId === x.ids.brandB), otherA = rows.find((r) => r.kind === 'other' && r.manufacturerId === x.ids.brand);
        return [
          x.check('before the switch the first video counts for brand A', 'sponsor', x.apps('disc', 'video')[0].bucket),
          x.check('after the switch the new brand\'s disc counts for brand B', 'sponsor', x.apps('discB', 'video2')[0].bucket),
          x.check('after the switch the old brand\'s disc is another brand', 'other-brand', x.apps('disc', 'video2')[0].bucket),
          x.check('both videos are in the same quarter', 'Q2', `Q${Math.ceil(+x.k.video.t.publishedAt.slice(5, 7) / 3)}` === `Q${Math.ceil(+x.k.video2.t.publishedAt.slice(5, 7) / 3)}` ? 'Q2' : 'split'),
          x.check('Q2 sponsor exposure minutes, brand A = first video only', oA / 60, sponsorA?.minutes, 'near'),
          x.check('Q2 sponsor exposure minutes, brand B = second video\'s new disc only', oB / 60, sponsorB?.minutes, 'near'),
          x.check('the old brand\'s later card is other-brand minutes, not sponsor minutes', oOld / 60, otherA?.entries.filter((e) => e.videoId === x.ids.video2).reduce((s, e) => s + e.minutes, 0), 'near'),
          ...x.says('brand-switch', 'creator', 'May 16, 2026'),
        ];
      },
    },
    {
      id: 'dealEnded', kind: 'sponsor', title: 'No sponsor deal is active on the day the video was published (the deal ended earlier)', touches: ['SponsorDeal.end', 'Video.publishedAt', 'bucket'], pool: true,
      apply: (s) => s.vary(s.k.deal, 'end', addDays(s.k.video.t.publishedAt, -10)),
      focus: { kind: 'other-brand', subject: 'disc' },
      expect: (x) => [
        x.check('sponsor bucket', 'no-deal', x.apps('disc')[0].bucket),
        x.check('no active deal is linked to the video', [], x.E.videos[x.ids.video].dealIds),
        x.check('no sponsor exposure row exists', 0, x.M.exposure.rows.filter((r) => r.kind === 'sponsor').length),
        x.check('chip', 'NO DEAL', x.row('disc').chips.find((c) => c.kind === 'sponsor')?.text),
        x.attCheck('disc'),
        ...x.says('other-brand', 'disc', 'no sponsor deal was active'),
      ],
    },
  ],
  'SponsorDeal.manufacturerId': [
    {
      id: 'nonSponsorBrand', kind: 'sponsor', title: 'A disc of a non-sponsor brand appears', touches: ['SponsorDeal.manufacturerId', 'bucket'], pool: true,
      apply: (s) => {
        const brandB = s.newBrand('brandB', other(s, NAME_POOLS.BRANDS, s.p.brandName));
        s.vary(s.k.deal, 'manufacturerId', brandB.id);
      },
      focus: { kind: 'other-brand', subject: 'disc' },
      expect: (x) => {
        const o = x.oracle('video', 'disc');
        const row = x.M.exposure.rows.find((r) => r.kind === 'other' && r.manufacturerId === x.ids.brand);
        return [
          x.check('sponsor bucket', 'other-brand', x.apps('disc')[0].bucket),
          x.check('no sponsor exposure row (the sponsor\'s discs never appeared)', 0, x.M.exposure.rows.filter((r) => r.kind === 'sponsor').length),
          x.check('the disc\'s brand has an other-brand row with minutes = attention / 60', o.value == null ? null : o.value / 60, o.value == null ? null : row?.minutes, 'near'),
          x.check('chip', 'OTHER BRAND', x.row('disc').chips.find((c) => c.kind === 'sponsor')?.text),
          x.attCheck('disc'),
          ...x.says('other-brand', 'disc', 'is the active sponsor', 'not sponsor exposure'),
        ];
      },
    },
  ],
  'SponsorDeal.moldsCovered': [
    {
      id: 'moldNotCovered', kind: 'sponsor', title: 'The sponsor\'s brand appears, but on a mold the deal does not cover', touches: ['SponsorDeal.moldsCovered', 'bucket', 'scene:mold2'], pool: true,
      apply: (s) => {
        const m2 = s.newMold('mold2', s.k.brand, other(s, NAME_POOLS.MOLDS, s.p.moldName));
        s.vary(s.k.deal, 'moldsCovered', [m2.id]);
      },
      focus: { kind: 'other-brand', subject: 'disc' },
      expect: (x) => [
        x.check('sponsor bucket', 'mold-not-covered', x.apps('disc')[0].bucket),
        x.check('the active deal is still linked to the video', [x.ids.deal], x.E.videos[x.ids.video].dealIds),
        x.check('no sponsor exposure minutes', 0, x.M.exposure.rows.filter((r) => r.kind === 'sponsor').length),
        x.check('chip', 'MOLD NOT COVERED', x.row('disc').chips.find((c) => c.kind === 'sponsor')?.text),
        x.attCheck('disc'),
        ...x.says('other-brand', 'disc', 'does not cover'),
      ],
    },
  ],
  'CardPlacement.discId': [
    {
      id: 'shownNotThrown', kind: 'appearance-mode', title: 'A card is on screen but the disc is never marked as thrown', touches: ['CardPlacement.discId', 'throw'], pool: true,
      apply: (s) => s.remove(s.k.throw),
      focus: { kind: 'shown-only', subject: 'disc' },
      expect: (x) => [
        x.check('appearance modes', ['shown'], x.apps('disc')[0].modes),
        x.check('evidence', ['card'], x.apps('disc')[0].evidence),
        x.check('alternate frame ShownOnlyAppearance selected', 1, x.alts('ShownOnlyAppearance').length),
        x.check('chip', 'SHOWN ONLY', x.row('disc').chips.find((c) => c.kind === 'mode')?.text),
        x.attCheck('disc'),
        ...x.says('shown-only', 'disc', 'never marked the disc as thrown'),
      ],
    },
  ],
  'Appearance.discId': [
    {
      id: 'thrownNoCard', kind: 'appearance-mode', title: 'The disc is thrown but no card is on screen', touches: ['Appearance.discId', 'card'], pool: true,
      apply: (s) => s.remove(s.k.card),
      focus: { kind: 'thrown-no-card', subject: 'disc' },
      expect: (x) => [
        x.check('appearance modes', ['thrown'], x.apps('disc')[0].modes),
        x.check('no card behind it', false, x.apps('disc')[0].hasCard),
        x.check('alternate frame CardlessAppearance selected', 1, x.alts('CardlessAppearance').length),
        x.check('chip', 'THROWN, NO CARD', x.row('disc').chips.find((c) => c.kind === 'mode')?.text),
        x.check('the panel warns that no link prompt was shown', true, x.panel().notices.some((n) => n.includes('without a card'))),
        x.attCheck('disc'),
        ...x.says('thrown-no-card', 'disc', 'no card on screen'),
      ],
    },
  ],
  'Appearance.mode': [
    {
      id: 'talkedOnly', kind: 'appearance-mode', title: 'The creator only talks about the disc: no card, no throw', touches: ['Appearance.mode', 'card', 'throw'], pool: true,
      apply: (s) => { s.vary(s.k.throw, 'mode', 'talked'); s.vary(s.k.throw, 'evidence', 'creator-marked'); s.remove(s.k.card); },
      focus: { kind: 'talked', subject: 'disc' },
      expect: (x) => [
        x.check('appearance modes', ['talked'], x.apps('disc')[0].modes),
        x.check('evidence', ['creator-marked'], x.apps('disc')[0].evidence),
        x.check('chip', 'TALKED, NO CARD', x.row('disc').chips.find((c) => c.kind === 'mode')?.text),
        x.attCheck('disc'),
        ...x.says('talked', 'disc', 'only talked about'),
      ],
    },
  ],
  'CardPlacement.endSec': [
    {
      id: 'pastVideoEnd', kind: 'placement-geometry', title: 'A card runs past the end of the video', touches: ['CardPlacement.endSec', 'CardPlacement.startSec', 'card', 'throw', 'Video.durationSeconds'], pool: true,
      apply: (s) => {
        const dur = s.k.video.t.durationSeconds;
        s.vary(s.k.card, 'startSec', dur - 10); s.vary(s.k.card, 'endSec', dur + 20); s.remove(s.k.throw);
      },
      focus: { kind: 'clamped', subject: 'disc' },
      expect: (x) => {
        const dur = x.k.video.t.durationSeconds, a = x.apps('disc')[0];
        return [
          x.check('the appearance is clamped to the video end', [dur - 10, dur], [a.start, a.end]),
          x.check('seconds counted', 10, a.seconds),
          x.check('the clamp transformation was recorded', true, x.noted('withinVideo', 'card')),
          x.check('a clamped-placement issue is listed on the video', true, x.panel().videos[0].issues.some((i) => i.type === 'clamped-placement')),
          x.attCheck('disc'),
          ...x.says('clamped', 'disc', '20 s past the end', 'only the 10 s'),
        ];
      },
    },
    {
      id: 'zeroLength', kind: 'placement-geometry', title: 'A zero-length card placement', touches: ['CardPlacement.endSec', 'CardPlacement.startSec', 'card', 'throw', 'click'], pool: true,
      apply: (s) => { s.vary(s.k.card, 'startSec', 95); s.vary(s.k.card, 'endSec', 95); s.remove(s.k.throw); },
      focus: { kind: 'zero-length', subject: 'disc' },
      expect: (x) => [
        x.check('no appearance is created', 0, x.apps('disc').length),
        x.check('no attention is credited', true, x.M.attention.byDisc[x.ids.disc] === undefined),
        x.check('the drop transformation was recorded', true, x.noted('hasLength', 'card')),
        x.check('the issue is listed on the video', true, x.panel().videos[0].issues.some((i) => i.type === 'zero-length-placement')),
        x.check('the disc\'s click is still counted for its link', 1, x.M.clicks.byLink[x.ids.link].total),
        x.check('but it has no appearance to be credited to', 'unattributed', x.click().attribution.kind),
        ...x.says('zero-length', 'disc', 'ignored', 'no appearance and no attention'),
      ],
    },
    {
      id: 'inverted', kind: 'placement-geometry', title: 'A card placement that ends before it starts', touches: ['CardPlacement.endSec', 'card', 'throw', 'click'], pool: true,
      apply: (s) => { s.vary(s.k.card, 'endSec', s.k.card.t.startSec - 8); s.remove(s.k.throw); },
      focus: { kind: 'inverted', subject: 'disc' },
      expect: (x) => [
        x.check('no appearance is created', 0, x.apps('disc').length),
        x.check('the drop transformation was recorded', true, x.noted('notInverted', 'card')),
        x.check('the issue is listed', true, x.panel().videos[0].issues.some((i) => i.type === 'inverted-placement')),
        x.check('nothing about this card shows up as attention', true, x.M.attention.byDisc[x.ids.disc] === undefined),
        ...x.says('inverted', 'disc', 'before it starts', 'not guessed at'),
      ],
    },
  ],
  'CardPlacement.startSec': [
    {
      id: 'overlapDifferentDiscs', kind: 'placement-geometry', title: 'Two different discs of the same sponsor have overlapping cards', touches: ['CardPlacement.startSec', 'scene:disc2'], solo: true,
      apply: (s) => {
        const { k, p } = s;
        const m2 = s.newMold('mold2', k.brand, other(s, NAME_POOLS.MOLDS, p.moldName)); s.newRelease('release2', m2, R);
        const d2 = s.newDisc('disc2', k.creator, k.creatorShelf, m2, {}, { record: true });
        s.vary(k.bag, 'discIds', [k.disc.id, d2.id]);
        withThrow(s, 'card2', k.video, d2, p.a + 5, p.b + 5); s.mark(k.card2, 'startSec');
      },
      focus: { kind: 'sponsor-exposure', subject: 'brand' },
      expect: (x) => {
        const { a, b } = x.cardSpan('card'), a2 = x.k.card2.t.startSec, b2 = x.k.card2.t.endSec;
        const o1 = x.oracle('video', 'disc').value, o2 = x.oracle('video', 'disc2').value, ou = x.oracle('video', 'disc', 'disc2').value;
        const row = x.exposure('sponsor', 'brand'), e = row?.entries[0];
        return [
          x.check('two separate appearances (different discs are never merged)', 2, x.E.appearances.length),
          x.attCheck('disc'), x.attCheck('disc2'),
          x.check('the overlap in seconds', Math.max(0, Math.min(b, b2) - Math.max(a, a2)), e ? e.unionSeconds - 0 === 0 ? 0 : (b - a) + (b2 - a2) - e.unionSeconds : null),
          x.check('sponsor exposure counts the union once: attention', ou, e?.unionAttention, 'near'),
          x.check('whereas the two discs\' attention sums to', o1 + o2, e?.sumAttention, 'near'),
          x.check('exposure minutes = union attention / 60', ou / 60, row?.minutes, 'near'),
          x.check('union is smaller than the sum', true, e ? e.unionAttention < e.sumAttention : false),
          ...x.says('sponsor-exposure', 'brand', 'counted once'),
        ];
      },
    },
  ],
  'CardPlacement.layout': [
    {
      id: 'overlapSameDisc', kind: 'placement-geometry', title: 'Two overlapping cards for the same disc (a second layout)', touches: ['CardPlacement.layout', 'scene:card2', 'card'], pool: true,
      apply: (s) => {
        const { k, p } = s;
        s.newCard('card2', k.video, k.disc, p.a + 10, p.b + 10, { layout: 'corner' }); s.mark(k.card2, 'layout');
      },
      focus: { kind: 'merged-overlap', subject: 'disc' },
      expect: (x) => {
        const a1 = x.k.card.t, a2 = x.k.card2.t, apps = x.apps('disc');
        return [
          x.check('one merged appearance, not two', 1, apps.length),
          x.check('it spans both cards', [Math.min(a1.startSec, a2.startSec), Math.max(a1.endSec, a2.endSec)], [apps[0].start, apps[0].end]),
          x.check('it points at both placements', 2, apps[0].placementIds.length),
          x.attCheck('disc'),
          x.check('chip', '2 CARDS MERGED', x.row('disc').chips.find((c) => c.kind === 'flag')?.text),
          ...x.says('merged-overlap', 'disc', 'merged into one'),
        ];
      },
    },
  ],
  'Click.linkId': [
    {
      id: 'discNeverAppeared', kind: 'click', title: 'A click on a link whose disc never appeared in that video', touches: ['Click.linkId', 'scene:disc2', 'scene:mold2', 'scene:link2'], pool: true,
      apply: (s) => {
        const { k } = s;
        const m2 = s.newMold('mold2', k.brand, other(s, NAME_POOLS.MOLDS, s.p.moldName)); s.newRelease('release2', m2, R);
        const d2 = s.newDisc('disc2', k.creator, k.creatorShelf, m2, {}, { record: true });
        const l2 = s.newLink('link2', k.creator, d2, k.video);
        const c2 = s.newClick('click2', l2); s.mark(c2, 'linkId');
      },
      focus: { kind: 'click-unattributed', subject: 'disc2' },
      expect: (x) => [
        x.check('the click is counted for its link', 1, x.M.clicks.byLink[x.ids.link2].total),
        x.check('but credited to no appearance', 'unattributed', x.click('click2').attribution.kind),
        x.check('reason', 'disc-not-in-video', x.click('click2').attribution.reason),
        x.check('the disc has no appearance in that video', 0, x.apps('disc2').length),
        x.check('alternate frame UnattributedClick selected', true, x.alts('UnattributedClick').some((a) => a.t.clickId === x.ids.click2)),
        x.check('the other disc\'s own click is still credited', true, x.click('click').attribution.kind !== 'unattributed'),
        ...x.says('click-unattributed', 'disc2', 'counted for the link', 'credited to no appearance'),
      ],
    },
  ],
  'Link.placement': [
    {
      id: 'bioLink', kind: 'click', title: 'A click on a bio link that belongs to no video', touches: ['Link.placement', 'scene:link2'], pool: true,
      apply: (s) => {
        const { k } = s;
        const l2 = s.newLink('link2', k.creator, k.disc, null, { placement: 'bio', code: `${k.link.t.code}-bio` }); s.mark(l2, 'placement');
        s.newClick('click2', l2, { refererHost: 'instagram.com', country: 'CA' });
      },
      focus: { kind: 'click-unattributed', subject: 'click2' },
      expect: (x) => [
        x.check('the click is counted for the link', 1, x.M.clicks.byLink[x.ids.link2].total),
        x.check('and for the disc', true, x.M.clicks.byDisc[x.ids.disc].total >= 1),
        x.check('credited to no appearance, reason', ['unattributed', 'no-video'], [x.click('click2').attribution.kind, x.click('click2').attribution.reason]),
        x.check('the video\'s own click is still credited', true, x.click('click').attribution.kind !== 'unattributed'),
        ...x.says('click-unattributed', 'click2', 'bio link'),
      ],
    },
  ],
  'Click.videoTimestamp': [
    {
      id: 'insideCard', kind: 'click', title: 'A click carrying a YouTube timestamp that falls inside a card placement', touches: ['Click.videoTimestamp', 'click'], pool: true,
      apply: (s) => s.vary(s.k.click, 'videoTimestamp', Math.floor((s.k.card.t.startSec + s.k.card.t.endSec) / 2)),
      focus: { kind: 'click-moment', subject: 'disc' },
      expect: (x) => {
        const ts = x.k.click.t.videoTimestamp, a = x.apps('disc')[0], c = x.click();
        return [
          x.check('click attribution kind', 'moment', c.attribution.kind),
          x.check('credited to the appearance containing that second', a.id, c.attribution.appearanceId),
          x.check('the timestamp lies inside the card', true, ts >= x.k.card.t.startSec && ts < x.k.card.t.endSec),
          x.check('the panel says which moment', `credited to the card on screen at ${mmss(ts)}`, x.panel().videos[0].clicks[0]?.text),
          x.check('the appearance shows one credited click', 1, x.row('disc').clicksCredited),
          ...x.says('click-moment', 'disc', mmss(ts), 'on-screen moment'),
        ];
      },
    },
    {
      id: 'outsideCard', kind: 'click', title: 'A click with a YouTube timestamp that is outside every card', touches: ['Click.videoTimestamp', 'click'], pool: true,
      apply: (s) => s.vary(s.k.click, 'videoTimestamp', s.k.card.t.endSec + 5),
      focus: { kind: 'click-video-level', subject: 'disc' },
      expect: (x) => {
        const ts = x.k.click.t.videoTimestamp, c = x.click();
        return [
          x.check('click attribution kind (video-level, not a moment)', 'video', c.attribution.kind),
          x.check('still credited to the disc\'s appearance in that video', x.apps('disc')[0].id, c.attribution.appearanceId),
          x.check('the timestamp-outside transformation was recorded', true, x.noted('insidePlacement', 'click')),
          x.check('the panel explains it', 'credited to the disc in this video', x.panel().videos[0].clicks[0]?.text),
          ...x.says('click-video-level', 'disc', mmss(ts), 'not to a moment'),
        ];
      },
    },
  ],
  'Click.at': [
    {
      id: 'beforePublish', kind: 'click', title: 'A click dated before the video was published', touches: ['Click.at', 'click', 'Video.publishedAt'], pool: true,
      apply: (s) => s.vary(s.k.click, 'at', `${addDays(s.k.video.t.publishedAt, -3)}T09:00:00Z`),
      focus: { kind: 'click-unattributed', subject: 'click' },
      expect: (x) => [
        x.check('click attribution', ['unattributed', 'predates-publish'], [x.click().attribution.kind, x.click().attribution.reason]),
        x.check('still counted for its link', 1, x.M.clicks.byLink[x.ids.link].total),
        x.check('the transformation was recorded', true, x.noted('notBeforePublish', 'click')),
        ...x.says('click-unattributed', 'click', 'dated before'),
      ],
    },
  ],
  'Click.refererHost': [
    {
      id: 'manyReferrers', kind: 'click', title: 'Several clicks from different referrer hosts and countries', touches: ['Click.refererHost', 'click', 'scene:clicks'], pool: true,
      apply: (s) => {
        [['google.com', 'DE'], ['reddit.com', 'CA'], ['discord.com', 'BR'], ['youtube.com', 'US']].forEach(([host, country], i) => {
          const c = s.newClick(`clickX${i}`, s.k.link, { refererHost: host, country, at: `2026-05-${13 + i}T1${i}:20:00Z` });
          if (host !== 'youtube.com') s.mark(c, 'refererHost');
        });
      },
      focus: { kind: 'click-credited', subject: 'click' },
      expect: (x) => {
        const r = x.M.clicks.byLink[x.ids.link];
        return [
          x.check('five clicks counted for the link', 5, r.total),
          x.check('all five are credited to the disc in the video', 5, r.video + r.moment),
          x.check('referrer hosts tallied', { 'discord.com': 1, 'google.com': 1, 'reddit.com': 1, 'youtube.com': 2 }, Object.fromEntries(Object.entries(r.hosts).sort())),
          x.check('countries tallied', { BR: 1, CA: 1, DE: 1, US: 2 }, Object.fromEntries(Object.entries(r.countries).sort())),
          x.check('the panel lists all five', 5, x.panel().videos[0].clicks.length),
          x.check('the appearance shows 5 credited clicks', 5, x.row('disc').clicksCredited),
          ...x.says('click-credited', 'click', 'clicks, not people, sales or revenue'),
        ];
      },
    },
  ],
  'Video.kind': [
    {
      id: 'short', kind: 'video', title: 'A Short: vertical and under 60 seconds', touches: ['Video.kind', 'Video.orientation', 'Video.durationSeconds', 'curve', 'card', 'throw', 'CardPlacement.startSec', 'CardPlacement.endSec', 'CardPlacement.layout', 'CardPlacement.endSec'], pool: true,
      apply: (s) => {
        const { k } = s;
        s.vary(k.video, 'kind', 'short'); s.vary(k.video, 'orientation', 'vertical'); s.vary(k.video, 'durationSeconds', 40);
        s.vary(k.videoCurve, 'seconds', 40);
        s.vary(k.card, 'startSec', 5); s.vary(k.card, 'endSec', 25); s.vary(k.card, 'layout', 'vertical-stack');
        s.vary(k.throw, 'startSec', 5); s.vary(k.throw, 'endSec', 25);
      },
      focus: { kind: 'short', subject: 'disc' },
      expect: (x) => [
        x.check('video format', 'short', x.E.videos[x.ids.video].format),
        x.check('retention curve has one point per second of the Short', 40, x.k.videoCurve.t.fractions.length),
        x.check('seconds on screen', 20, x.apps('disc')[0].seconds),
        x.attCheck('disc'),
        x.check('the panel marks it as a vertical Short', ['short', 'vertical'], [x.panel().videos[0].format, x.panel().videos[0].orientation]),
        ...x.says('short', 'disc', 'Shorts are reported apart'),
      ],
    },
  ],
  'Video.viewSnapshots': [
    {
      id: 'zeroViews', kind: 'video', title: 'A published video with zero views so far (no retention curve yet)', touches: ['Video.viewSnapshots', 'curve'], pool: true,
      apply: (s) => { s.vary(s.k.video, 'viewSnapshots', [{ at: BASE.snapshotAt, views: 0 }]); s.remove(s.k.videoCurve); },
      focus: { kind: 'awaiting-views', subject: 'disc' },
      expect: (x) => [
        x.check('retention state', 'awaiting-views', x.E.videos[x.ids.video].retentionState),
        x.check('attention is null (not measurable), not zero', null, x.M.attention.attention[x.apps('disc')[0].id].value),
        x.check('alternate frame AwaitingViewsVideo selected', 1, x.alts('AwaitingViewsVideo').length),
        x.check('the appearance itself is still recorded', 1, x.apps('disc').length),
        x.check('the panel says "not measurable yet", not 0', 'not measurable yet (no views)', x.row('disc').attention.text),
        x.check('clicks do not depend on retention and are still credited', 'video', x.click().attribution.kind),
        ...x.says('awaiting-views', 'disc', 'no views yet', 'not the same as zero'),
      ],
    },
    {
      id: 'growth', kind: 'video', title: 'Views growing over three snapshots', touches: ['Video.viewSnapshots'], pool: true,
      apply: (s) => {
        const v = s.p.views;
        s.vary(s.k.video, 'viewSnapshots', [{ at: '2026-05-11', views: Math.round(v / 10) }, { at: '2026-05-14', views: Math.round(v * 0.4) }, { at: BASE.snapshotAt, views: v }]);
      },
      focus: { kind: 'views-growth', subject: 'disc' },
      expect: (x) => {
        const snaps = x.k.video.t.viewSnapshots, a = x.apps('disc')[0], series = x.M.attention.attention[a.id].series, o = x.oracle('video', 'disc');
        return [
          x.check('three snapshots are carried through', 3, series.length),
          ...snaps.map((s, i) => x.check(`attention at ${s.views} views = ${s.views} x ${fmt1(o.retentionSum)} (retention sum)`, s.views * o.retentionSum, series[i].value, 'near')),
          x.check('attention grows with views', true, series[0].value < series[1].value && series[1].value < series[2].value),
          x.check('the headline number uses the latest snapshot', latestViews(x.k.video) * o.retentionSum, x.att('disc'), 'near'),
          ...x.says('views-growth', 'disc', 'Views grew'),
        ];
      },
    },
  ],
  'Channel.studioConnected': [
    {
      id: 'notConnected', kind: 'video', title: 'YouTube Studio is not connected: clicks only, no retention', touches: ['Channel.studioConnected', 'curve'], pool: true,
      apply: (s) => { s.vary(s.k.creatorChannel, 'studioConnected', false); s.remove(s.k.videoCurve); },
      focus: { kind: 'not-connected', subject: 'disc' },
      expect: (x) => [
        x.check('retention state', 'not-connected', x.E.videos[x.ids.video].retentionState),
        x.check('alternate frame ClicksOnlyChannel selected', 1, x.alts('ClicksOnlyChannel').length),
        x.check('attention is unavailable', null, x.M.attention.attention[x.apps('disc')[0].id].value),
        x.check('the panel says so', 'unavailable (Studio not connected)', x.row('disc').attention.text),
        x.check('clicks are still counted and credited', ['video', 1], [x.click().attribution.kind, x.M.clicks.byLink[x.ids.link].total]),
        x.check('exposure minutes are not invented', 0, x.M.exposure.rows.reduce((s, r) => s + r.entries.length, 0)),
        ...x.says('not-connected', 'disc', 'not connected', 'clicks are still counted'),
      ],
    },
  ],
  'RetentionCurve.dip': [
    {
      id: 'dip', kind: 'retention', title: 'Retention dips while the card is on screen', touches: ['RetentionCurve.dip', 'curve'], pool: true,
      apply: (s) => s.vary(s.k.videoCurve, 'dip', { from: s.k.card.t.startSec, to: s.k.card.t.endSec, depth: 0.3 }),
      focus: { kind: 'dip', subject: 'disc' },
      expect: (x) => {
        const f = x.k.videoCurve.t.fractions, { a, b } = x.cardSpan('card');
        const inside = naiveMean(f.slice(a, b)), around = naiveMean([...f.slice(Math.max(0, a - 5), a), ...f.slice(b, Math.min(f.length, b + 5))]);
        const d = x.M.dips.dips[x.apps('disc')[0].id];
        return [
          x.check('mean retention inside the card', inside, d?.windowMean, 'near'),
          x.check('mean retention in the 5 s around it', around, d?.surroundMean, 'near'),
          x.check('dip detected (drop above 0.05)', true, d?.dipped),
          x.check('drop = around − inside', around - inside, d?.drop, 'near'),
          x.attCheck('disc'),
          x.check('chip', `RETENTION DIP −${fmt2(around - inside)}`, x.row('disc').chips.find((c) => c.kind === 'retention')?.text),
          ...x.says('dip', 'disc', `${fmt2(around)} to ${fmt2(inside)}`, 'correlation'),
        ];
      },
    },
  ],
  'RetentionCurve.shape': [
    {
      id: 'flat', kind: 'retention', title: 'Flat retention through the placement', touches: ['RetentionCurve.shape', 'curve'], pool: true,
      apply: (s) => { s.vary(s.k.videoCurve, 'shape', 'flat'); s.vary(s.k.videoCurve, 'endLevel', 0.7); },
      focus: { kind: 'steady', subject: 'disc' },
      expect: (x) => {
        const a = x.apps('disc')[0], views = latestViews(x.k.video), d = x.M.dips.dips[a.id];
        return [
          x.check('every point of the curve is 0.7', true, x.k.videoCurve.t.fractions.every((f) => f === 0.7)),
          x.check(`attention-seconds = ${views} views x 0.7 x ${a.seconds} s`, views * 0.7 * a.seconds, x.att('disc'), 'near'),
          x.check('no dip', false, d?.dipped),
          x.check('chip', 'RETENTION STEADY', x.row('disc').chips.find((c) => c.kind === 'retention')?.text),
          ...x.says('steady', 'disc', 'held steady', '0.70'),
        ];
      },
    },
  ],
  'Disc.creatorId': [
    {
      id: 'crossCreator', kind: 'cross-creator', title: 'Two creators share a mold and a sponsor', touches: ['Disc.creatorId', 'scene:creatorB', 'Video.publishedAt', 'bucket'], solo: true,
      apply: (s) => {
        const { k, p } = s;
        const who = s.rng.pick(NAME_POOLS.CREATORS.filter((w) => w[0] !== p.who[0]));
        const B = s.newCreator('creatorB', who);
        s.newDeal('dealB', B.creator, k.brand, BASE.dealStart, BASE.dealEnd);
        const discB = s.newDisc('discB', B.creator, B.shelf, k.mold, { plastic: other(s, NAME_POOLS.PLASTICS.filter((n) => n !== 'Pro'), p.plastic) }, { record: true });
        s.mark(discB, 'creatorId');
        const vB = s.newVideo('videoB', B.channel, { title: 'My first look at it', publishedAt: '2026-05-14', viewSnapshots: [{ at: '2026-05-21', views: p.views * 3 }] });
        s.newBag('bagB', B.creator, [discB], [vB.video]);
        withThrow(s, 'cardB', vB.video, discB, p.a + 5, p.b + 10);
      },
      focus: { kind: 'cross-creator', subject: 'mold' },
      expect: (x) => {
        const oA = x.oracle('video', 'disc').value, oB = x.oracle('videoB', 'discB').value;
        const row = x.exposure('sponsor', 'brand'), pa = x.panel('creator'), pb = x.panel('creatorB');
        return [
          x.check('both creators feed one mold rollup', 2, x.M.attention.byMold[x.ids.mold].creators.length),
          x.check('mold rollup = creator A + creator B', oA + oB, x.M.attention.byMold[x.ids.mold].value, 'near'),
          x.check('each creator\'s own share', [oA, oB], [x.M.attention.byMold[x.ids.mold].perCreator[x.ids.creator], x.M.attention.byMold[x.ids.mold].perCreator[x.ids.creatorB]], 'near'),
          x.check('the sponsor sees one Q2 row covering both creators', [2, (oA + oB) / 60], [row?.creators.length, row?.minutes], 'near'),
          x.check('sponsor minutes split by creator', [oA / 60, oB / 60], [row?.byCreator[x.ids.creator], row?.byCreator[x.ids.creatorB]], 'near'),
          x.check('creator A\'s panel shows only creator A\'s disc', [true, false], [pa.videos.some((v) => v.discs.some((d) => d.discId === x.ids.disc)), pa.videos.some((v) => v.discs.some((d) => d.discId === x.ids.discB))]),
          x.check('creator B\'s panel shows only creator B\'s disc', [true, false], [pb.videos.some((v) => v.discs.some((d) => d.discId === x.ids.discB)), pb.videos.some((v) => v.discs.some((d) => d.discId === x.ids.disc))]),
          x.check('each panel knows one other creator shares the mold', [1, 1], [pa.moldRollups[0]?.otherCreators, pb.moldRollups[0]?.otherCreators]),
          ...x.says('cross-creator', 'mold', fmt1(oA + oB), '2 creators'),
        ];
      },
    },
  ],
};

export const BASELINE = {
  id: 'baseline', kind: 'baseline', title: 'Every terminal at its default: the ordinary situation', touches: [],
  apply: () => {},
  focus: { kind: 'attention', subject: 'disc' },
  expect: (x) => {
    const card = x.k.card.t, f = x.k.videoCurve.t.fractions, views = latestViews(x.k.video);
    const hand = views * f.slice(card.startSec, card.endSec).reduce((s, v) => s + v, 0);
    const a = x.apps('disc')[0], rel = x.release('disc');
    return [
      x.check('one appearance of the disc in the video', 1, x.apps('disc').length),
      x.check('the appearance is the card interval', [card.startSec, card.endSec], [a?.start, a?.end]),
      x.attCheck('disc'),
      x.check('by hand: views x sum of retention over the card seconds', hand, x.att('disc'), 'near'),
      x.check('release: published long after release', ['established', dayDiff(x.k.video.t.publishedAt, x.k.release.t.date)], [rel.class, rel.offsetDays]),
      x.check('sponsor bucket', 'sponsor', a?.bucket),
      x.check('modes: card shown and disc thrown', ['shown', 'thrown'], a?.modes),
      x.check('the click is credited to the disc in the video', 'video', x.click().attribution.kind),
      x.check('no mismatch selected an alternate frame', 0, x.E.alternates.length),
      x.check('linked: appearance → disc → mold → manufacturer → release', true, x.edge(a.id, 'of', 'disc') && x.edge('disc', 'isMold', 'mold') && x.edge('mold', 'madeBy', 'brand') && x.edge('mold', 'releasedAs', 'release')),
      x.check('linked: appearance ↔ card placement, click → link → disc, bag → video, video → sponsor deal', true, x.edge(a.id, 'shownBy', 'card') && x.edge('click', 'via', 'link') && x.edge('link', 'for', 'disc') && x.edge('bag', 'appliedTo', 'video') && x.edge('video', 'underDeal', 'deal')),
      ...x.says('attention', 'disc', fmt1(hand), 'attention-seconds'),
    ];
  },
};

// What each departure reads (besides what it changes): used to keep seeded pairs compatible. Every departure implicitly reads the card
// (its appearance) unless it changes the card itself.
const EXTRA_READS = {
  zeroViews: ['click'], notConnected: ['click'], bioLink: ['click'], discNeverAppeared: ['click'], manyReferrers: [],
  thrownNoCard: ['throw'], overlapSameDisc: ['throw'], growth: ['curve'],
};
for (const d of Object.values(DEPARTURES).flat()) {
  d.reads = [...(d.reads ?? []), ...(EXTRA_READS[d.id] ?? []), ...(d.touches.includes('card') ? [] : ['card'])];
}
