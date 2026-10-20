import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editDistance, normalize, rank, score } from './fuzzy';

const titles = [
  'The Lord of the Rings: The Fellowship of the Ring',
  'The Lord of the Rings: The Two Towers',
  'Breaking Bad',
  'Better Call Saul',
  'The Matrix',
  'The Matrix Reloaded',
  'Spider-Man: No Way Home',
  'The Dark Knight',
  'Dark',
  'Pokémon Detective Pikachu',
  'Fast & Furious',
  'Mad Max: Fury Road',
  'Harry Potter and the Sorcerer’s Stone',
  'Toy Story 3',
].map((name) => ({ name }));

const top = (q: string) => rank(q, titles, 3).map((r) => r.item.name);

test('normalize strips accents and punctuation', () => {
  assert.equal(normalize('Pokémon: Detective Pikachu!'), 'pokemon detective pikachu');
  assert.equal(normalize('Fast & Furious'), 'fast and furious');
});

test('edit distance counts swaps as one', () => {
  assert.equal(editDistance('matrx', 'matrix', 2), 1);
  assert.equal(editDistance('braeking', 'breaking', 2), 1);
});

test('prefix and exact rank first', () => {
  assert.equal(top('matrix')[0], 'The Matrix');
  assert.equal(top('the mat')[0], 'The Matrix');
  assert.equal(top('dark')[0], 'Dark');
});

test('any word, in order', () => {
  assert.equal(top('dark kn')[0], 'The Dark Knight');
  assert.equal(top('fury road')[0], 'Mad Max: Fury Road');
  assert.equal(top('no way home')[0], 'Spider-Man: No Way Home');
});

test('initials', () => {
  assert.ok(top('lotr').some((t) => t.startsWith('The Lord of the Rings')));
  assert.equal(top('bcs')[0], 'Better Call Saul');
});

test('typos', () => {
  assert.equal(top('breking bad')[0], 'Breaking Bad');
  assert.equal(top('matrx')[0], 'The Matrix');
  assert.equal(top('harry poter')[0], 'Harry Potter and the Sorcerer’s Stone');
  assert.equal(top('spiderman')[0], 'Spider-Man: No Way Home');
  assert.equal(top('pokemon')[0], 'Pokémon Detective Pikachu');
  assert.equal(top('fast and')[0], 'Fast & Furious');
  assert.equal(top('toy story3')[0], 'Toy Story 3');
  assert.equal(top('brkng')[0], 'Breaking Bad');
  assert.equal(top('drk knght')[0], 'The Dark Knight');
});

test('unrelated text matches nothing', () => {
  assert.equal(score('zzzz', { name: 'The Matrix' }), 0);
  assert.equal(rank('xylophone', titles, 5).length, 0);
});
