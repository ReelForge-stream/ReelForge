import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectPlatform, formatBytes, playability, suggestedOption } from './device';
import type { DownloadOptions } from './types';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const file = (over: Partial<DownloadOptions>): DownloadOptions => ({
  ItemId: 'x', MediaSourceId: 'x', Title: 'T', FileName: 'T.mkv', SizeBytes: 4e9, DurationSeconds: 7200, Container: 'mkv',
  VideoCodec: 'hevc', BitDepth: 10, Width: 3840, Height: 2160, Range: 'Hdr10', AudioCodecs: ['truehd'], AudioTracks: [],
  TextSubtitles: 0, PictureSubtitles: 0, UsesGpu: true,
  Options: [{ Id: '1080p', Label: '1080p', MaxWidth: 1920, VideoBitrate: 6e6, EstimatedBytes: 5.6e9 }, { Id: '720p', Label: '720p', MaxWidth: 1280, VideoBitrate: 3e6, EstimatedBytes: 2.9e9 }],
  ...over,
});

// Safari-like: H.264, HEVC, AAC, AC-3 yes; no Opus in MP4 terms here, no DTS/TrueHD.
const safari = (m: string) => /avc1|hvc1|mp4a|ac-3|ec-3|audio\/mpeg/.test(m);
// Chrome-on-Android-like: H.264, VP9, AV1, AAC, Opus, FLAC; no HEVC, no Dolby.
const chrome = (m: string) => /avc1|vp9|av01|mp4a|opus|vorbis|flac|audio\/mpeg/.test(m);

test('detects the device', () => {
  assert.equal(detectPlatform(IPHONE), 'iphone');
  assert.equal(detectPlatform(PIXEL), 'android-phone');
  assert.equal(detectPlatform(WIN), 'windows');
  assert.equal(detectPlatform(IPAD_DESKTOP, 5), 'ipad');
  assert.equal(detectPlatform(IPAD_DESKTOP, 0), 'mac');
});

test('a 4K HEVC MKV with TrueHD needs converting for an iPhone', () => {
  const r = playability(file({}), 'iphone', safari);
  assert.equal(r.verdict, 'no');
  assert.deepEqual(r.problems, ['MKV files', 'Dolby TrueHD sound']);
});

test('an H.264/AAC MP4 plays everywhere', () => {
  const mp4 = file({ FileName: 'T.mp4', Container: 'mov,mp4,m4a', VideoCodec: 'h264', BitDepth: 8, AudioCodecs: ['aac'] });
  assert.equal(playability(mp4, 'iphone', safari).verdict, 'yes');
  assert.equal(playability(mp4, 'android-phone', chrome).verdict, 'yes');
  assert.equal(playability(mp4, 'windows', chrome).verdict, 'yes');
});

test('Android plays MKV, but not HEVC in Chrome terms; computers get "needs VLC" not "no"', () => {
  const mkv = file({ VideoCodec: 'h264', BitDepth: 8, AudioCodecs: ['aac'] });
  assert.equal(playability(mkv, 'android-phone', chrome).verdict, 'yes');
  assert.equal(playability(mkv, 'mac', safari).verdict, 'app');
  assert.deepEqual(playability(file({ AudioCodecs: ['aac'] }), 'android-phone', chrome).problems, ['HEVC (H.265) video']);
});

test('suggests a smaller size on phones', () => {
  assert.equal(suggestedOption(file({}), 'iphone'), '720p');
  assert.equal(suggestedOption(file({}), 'windows'), '1080p');
});

test('formats sizes', () => {
  assert.equal(formatBytes(5.6e9), '5.6 GB');
  assert.equal(formatBytes(12.4e9), '12 GB');
  assert.equal(formatBytes(734e6), '734 MB');
});

test('names the device for the server', async () => {
  const { describeDevice } = await import('./device');
  assert.equal(describeDevice(WIN), 'Chrome on Windows PC');
  assert.equal(describeDevice(IPHONE), 'Safari on iPhone');
  assert.equal(describeDevice(PIXEL), 'Chrome on Android phone');
});
