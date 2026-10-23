import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobStep } from './jobStep';

const d = (s: number) => `${Math.round(s / 60)} min`;

test('each agent step reads plainly', () => {
  assert.equal(jobStep({ Progress: 0.4, Phase: 'downloading', BytesPerSecond: 85e6, EtaSeconds: 120, AgentName: 'GAMING-PC' }, d), 'Copying the original to GAMING-PC · 40% · 85 MB/s · about 2 min left');
  assert.equal(jobStep({ Progress: 0.62, Phase: 'converting', Speed: 6.14, Encoder: 'hevc_nvenc', AgentName: 'GAMING-PC' }, d), 'Converting 62% · 6.1× real time · GPU · on GAMING-PC');
  assert.equal(jobStep({ Progress: 0.3, Phase: 'uploading', BytesPerSecond: 2.5e6, AgentName: 'X' }, d, false), 'Converted; sending it back · 30% · 2.5 MB/s');
});

test('an old agent uploading no longer looks frozen at 100%', () => {
  assert.match(jobStep({ Progress: 0.999, Phase: 'uploading', AgentName: 'CADE-MAIN' }, d), /sending it back to the server/);
});

test('conversions on the server read as before', () => {
  assert.equal(jobStep({ Progress: 0.5, Speed: 3, EtaSeconds: 600, Encoder: 'libx265' }, d), '50% · 3.0× real time · about 10 min left · CPU');
  assert.equal(jobStep({ Progress: 0.9999 }, d), '99%');
});
