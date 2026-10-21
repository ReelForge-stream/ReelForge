import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atEnd, DEFAULT_PREFS, describePrefs, showUpNext } from './autoplay';

test('plays the next two episodes by itself, then asks', () => {
  // Episode 1 started by hand (0 autoplayed so far) -> 2 plays itself -> 3 plays itself -> ask at the end of 3.
  assert.equal(atEnd(DEFAULT_PREFS, 0, true, false), 'next');
  assert.equal(atEnd(DEFAULT_PREFS, 1, true, false), 'next');
  assert.equal(atEnd(DEFAULT_PREFS, 2, true, false), 'ask');
});

test('stops at the last episode, when off, or when the card was dismissed', () => {
  assert.equal(atEnd(DEFAULT_PREFS, 0, false, false), 'stop');
  assert.equal(atEnd({ on: false, askAfter: 2 }, 0, true, false), 'stop');
  assert.equal(atEnd(DEFAULT_PREFS, 0, true, true), 'stop');
  assert.equal(atEnd({ on: true, askAfter: 0 }, 50, true, false), 'next'); // never ask
});

test('the Up Next card shows only in the last seconds, and not when it is about to ask', () => {
  assert.equal(showUpNext(DEFAULT_PREFS, 0, true, false, 1310, 1320), true);
  assert.equal(showUpNext(DEFAULT_PREFS, 0, true, false, 1200, 1320), false);
  assert.equal(showUpNext(DEFAULT_PREFS, 2, true, false, 1310, 1320), false);
  assert.equal(showUpNext(DEFAULT_PREFS, 0, true, false, 50, 60), false); // short clip
});

test('describes the setting', () => {
  assert.equal(describePrefs(DEFAULT_PREFS), 'On · asks after 2');
  assert.equal(describePrefs({ on: false, askAfter: 2 }), 'Off');
});
