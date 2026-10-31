import test from 'node:test';
import assert from 'node:assert/strict';
import { moldMentions } from './mold-mentions.mjs';

const records = [
  { id: 'innova-destroyer', manufacturer: 'Innova', mold: 'Destroyer' },
  { id: 'innova-roc3', manufacturer: 'Innova', mold: 'Roc3' },
  { id: 'innova-roc', manufacturer: 'Innova', mold: 'Roc' },
  { id: 'innova-rocplus', manufacturer: 'Innova', mold: 'Roc+' },
  { id: 'innova-atlas', manufacturer: 'Innova', mold: 'Atlas' },
];
const index = { stableIds: records.map(r => r.id), recordForId: id => records.find(r => r.id === id) };
const dictionary = [
  { disc_id: 'innova-champion-discs/destroyer', manufacturer: 'Innova Champion Discs', mold: 'Destroyer', plastics: ['Star', 'Halo Star', 'Champion'] },
  { disc_id: 'innova-champion-discs/atlas', manufacturer: 'Innova Champion Discs', mold: 'Atlas', plastics: ['Star'] },
];
const candidate = (video, text, disc = 'innova-champion-discs/destroyer') => ({ candidate: { disc_id: disc, video_id: video, source: 'title', source_text: text } });

test('postings match molds on letters and digits, with + read as plus', () => {
  const r = moldMentions(index, [
    { disc_id: 'innova-champion-discs/roc-3', video_id: 'a' },
    { disc_id: 'innova-champion-discs/roc', video_id: 'b' },
    { disc_id: 'innova-champion-discs/roc+', video_id: 'c' },
  ]);
  assert.deepEqual(r.mentions, { 'innova-roc': 1, 'innova-roc3': 1, 'innova-rocplus': 1 });
  assert.deepEqual(r.unmatched, {});
  assert.equal(r.candidateEvidence, undefined);
});

test('a candidate counts only when its own video ties the mold to its maker', () => {
  const videos = [
    { video_id: 'maker', title: 'Innova Destroyer review', description: '' },
    { video_id: 'plastic', title: 'My Halo Star Destroyers', description: '' },
    { video_id: 'alone', title: 'Destroyer putting drills', description: '' },
    { video_id: 'hashtag', title: 'Ace run #destroyer', description: '' },
    { video_id: 'shop', title: '', description: '' },
    { video_id: 'atlas', title: 'Use code at Atlas DG Supply', description: '' },
  ];
  const r = moldMentions(index, [], { videos, dictionary, candidates: [
    candidate('maker', 'Destroyer'), candidate('plastic', 'Destroyer'), candidate('alone', 'Destroyer'), candidate('hashtag', 'destroyer'),
    candidate('shop', 'https://proshop.innovadiscs.com/destroyer'), candidate('atlas', 'Atlas', 'innova-champion-discs/atlas'), candidate('gone', 'Destroyer'),
  ] });
  assert.deepEqual(r.mentions, { 'innova-destroyer': 3 });
  assert.deepEqual(r.candidateEvidence, { maker: 1, plastic: 1, alone: 3, link: 1, missing: 1 });
});

test('a video counts once per mold, whether a posting or a candidate names it', () => {
  const videos = [{ video_id: 'v', title: 'Innova Destroyer review', description: '' }];
  const r = moldMentions(index, [{ disc_id: 'innova-champion-discs/destroyer', video_id: 'v' }], { videos, dictionary, candidates: [candidate('v', 'Destroyer')] });
  assert.deepEqual(r.mentions, { 'innova-destroyer': 1 });
});
