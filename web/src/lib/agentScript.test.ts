import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encoderLabel, installScript, looksLocalOnly } from './agentScript';

test('install script carries the server, key and version, safely quoted', () => {
  const s = installScript('http://192.168.1.10:8096/', 'ABCD-EFGH-JKLM', '0.9.0');
  assert.match(s, /\$Server {2}= 'http:\/\/192\.168\.1\.10:8096'/); // trailing slash trimmed
  assert.match(s, /\$Key {5}= 'ABCD-EFGH-JKLM'/);
  assert.match(s, /releases\/download\/v\$Version\/ReelForge-Agent\.exe/);
  assert.match(s, /pair --server \$Server --key \$Key/);
  assert.match(s, /New-Service -Name ReelForgeAgent/);
  assert.ok(installScript("http://o'brien:8096", 'K', '1.0.0').includes("'http://o''brien:8096'"));
});

test('helpers', () => {
  assert.equal(encoderLabel('hevc_amf'), 'AMD HEVC');
  assert.equal(looksLocalOnly('http://localhost:8096'), true);
  assert.equal(looksLocalOnly('http://192.168.1.10:8096'), false);
});
