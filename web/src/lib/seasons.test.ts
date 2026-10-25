import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupBySeason, seasonLabel } from './seasons';
import type { Estimate } from './types';

const ep = (show: string, s: number | null, e: number, saves: number): Estimate => ({
  ItemId: `${show}${s}${e}`, MediaSourceId: `${show}-${s}-${e}`, Title: `${show} S0${s}E0${e}`, Kind: 'Episode', Path: '', Summary: '',
  SizeBytes: saves * 2, EstimatedBytes: saves, SavingsBytes: saves, SavingsFraction: 0.5, Note: '',
  SeriesId: show, SeriesName: show, SeasonNumber: s, EpisodeNumber: e,
});

test('episodes group under their show and season, in order', () => {
  const movie = { ...ep('M', 1, 1, 50), Kind: 'Movie' as const, SeriesId: null, SeriesName: null };
  const { movies, shows } = groupBySeason([ep('A', 2, 3, 1), movie, ep('A', 1, 2, 1), ep('B', 1, 1, 10), ep('A', 2, 1, 1), ep('A', 0, 1, 1)]);
  assert.equal(movies.length, 1);
  assert.deepEqual(shows.map((s) => s.name), ['B', 'A']); // most savings first
  const a = shows[1];
  assert.deepEqual(a.seasons.map((s) => s.number), [1, 2, 0]); // specials last
  assert.deepEqual(a.seasons[1].episodes.map((e) => e.EpisodeNumber), [1, 3]);
  assert.equal(a.saves, 4);
  assert.equal(a.seasons[1].size, 4);
});

test('season labels', () => {
  assert.equal(seasonLabel(3), 'Season 3');
  assert.equal(seasonLabel(0), 'Specials');
  assert.equal(seasonLabel(null), 'Other episodes');
});
