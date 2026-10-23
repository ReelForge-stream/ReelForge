import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMode } from './install';

test('install: a real prompt when the browser offers one, steps otherwise, nothing on computers or once installed', () => {
  assert.equal(installMode('android-phone', false, true), 'prompt');
  assert.equal(installMode('android-phone', false, false), 'menu'); // plain http, or a browser without the prompt
  assert.equal(installMode('iphone', false, false), 'ios');
  assert.equal(installMode('ipad', false, false), 'ios');
  assert.equal(installMode('iphone', true, false), 'none'); // already opened from the home screen
  assert.equal(installMode('windows', false, true), 'none');
});
