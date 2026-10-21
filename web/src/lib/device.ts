// Will a downloaded file play on this device? The browser's own codec support stands in for the
// device's, plus what each platform's built-in video player accepts as a file.

import type { DownloadOptions } from './types';

export type Platform = 'iphone' | 'ipad' | 'android-phone' | 'android-tablet' | 'mac' | 'windows' | 'chromeos' | 'linux' | 'other';

export function detectPlatform(ua: string, touchPoints = 0): Platform {
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ipad'; // iPadOS asks for the desktop site
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'android-phone' : 'android-tablet';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

export const platformName: Record<Platform, string> = {
  iphone: 'this iPhone',
  ipad: 'this iPad',
  'android-phone': 'this phone',
  'android-tablet': 'this tablet',
  mac: 'this Mac',
  windows: 'this PC',
  chromeos: 'this Chromebook',
  linux: 'this computer',
  other: 'this device',
};

export const isMobile = (p: Platform) => p === 'iphone' || p === 'ipad' || p === 'android-phone' || p === 'android-tablet';
export const isPhone = (p: Platform) => p === 'iphone' || p === 'android-phone';

/** "yes": opens in the built-in player. "app": needs a player app such as VLC. "no": won't play. */
export type Verdict = 'yes' | 'app' | 'no';

export interface Playability {
  verdict: Verdict;
  /** Plain-English reasons, e.g. "MKV files", "DTS sound". Empty when it plays. */
  problems: string[];
}

/** Codec strings to ask the browser about. Unknown or legacy codecs get null (treated as unplayable). */
export function videoProbe(codec: string, bitDepth: number): string | null {
  switch (codec.toLowerCase()) {
    case 'h264':
    case 'avc':
      return 'video/mp4; codecs="avc1.640028"';
    case 'hevc':
    case 'h265':
      return bitDepth > 8 ? 'video/mp4; codecs="hvc1.2.4.L150.B0"' : 'video/mp4; codecs="hvc1.1.6.L150.B0"';
    case 'av1':
      return bitDepth > 8 ? 'video/mp4; codecs="av01.0.08M.10"' : 'video/mp4; codecs="av01.0.08M.08"';
    case 'vp9':
      return 'video/webm; codecs="vp9"';
    case 'vp8':
      return 'video/webm; codecs="vp8"';
    default:
      return null; // MPEG-2, MPEG-4 Part 2 (DivX/XviD), VC-1 ...
  }
}

export function audioProbe(codec: string): string | null {
  switch (codec.toLowerCase()) {
    case 'aac':
      return 'audio/mp4; codecs="mp4a.40.2"';
    case 'mp3':
      return 'audio/mpeg';
    case 'ac3':
      return 'audio/mp4; codecs="ac-3"';
    case 'eac3':
      return 'audio/mp4; codecs="ec-3"';
    case 'opus':
      return 'audio/webm; codecs="opus"';
    case 'vorbis':
      return 'audio/webm; codecs="vorbis"';
    case 'flac':
      return 'audio/flac';
    case 'alac':
      return 'audio/mp4; codecs="alac"';
    default:
      return null; // DTS, TrueHD, PCM ...
  }
}

const NAMES: Record<string, string> = {
  mkv: 'MKV files', avi: 'AVI files', webm: 'WebM files', ts: 'TS files', m2ts: 'M2TS files', wmv: 'WMV files', mpg: 'MPEG files', vob: 'DVD files', iso: 'disc images',
  hevc: 'HEVC (H.265) video', av1: 'AV1 video', vp9: 'VP9 video', mpeg2video: 'MPEG-2 video', mpeg4: 'DivX/XviD video', msmpeg4v3: 'DivX video', vc1: 'VC-1 video',
  dts: 'DTS sound', truehd: 'Dolby TrueHD sound', ac3: 'Dolby Digital sound', eac3: 'Dolby Digital Plus sound', opus: 'Opus sound', vorbis: 'Vorbis sound', flac: 'FLAC sound',
};
const nameOf = (x: string) => NAMES[x.toLowerCase()] ?? `${x.toUpperCase()}`;

/** Which file types each platform's built-in player opens from a download. */
function nativeContainers(p: Platform): string[] {
  switch (p) {
    case 'iphone':
    case 'ipad':
    case 'mac':
      return ['mp4', 'm4v', 'mov'];
    case 'android-phone':
    case 'android-tablet':
    case 'chromeos':
      return ['mp4', 'm4v', 'mkv', 'webm', '3gp'];
    case 'windows':
      return ['mp4', 'm4v', 'mov', 'mkv', 'avi', 'wmv'];
    default:
      return ['mp4', 'm4v', 'mov', 'mkv', 'webm'];
  }
}

export function extensionOf(o: Pick<DownloadOptions, 'FileName' | 'Container'>): string {
  const m = /\.([a-z0-9]+)$/i.exec(o.FileName);
  return (m?.[1] ?? o.Container.split(',')[0] ?? '').toLowerCase();
}

/** Decide whether the original file will play on this device. */
export function playability(o: DownloadOptions, platform: Platform, canPlay: (mime: string) => boolean): Playability {
  const problems: string[] = [];
  const ext = extensionOf(o);
  if (!nativeContainers(platform).includes(ext)) problems.push(nameOf(ext));

  const v = videoProbe(o.VideoCodec, o.BitDepth);
  if (!v || !canPlay(v)) problems.push(nameOf(o.VideoCodec));

  // The first (default) sound track is what will play.
  const a = o.AudioCodecs[0];
  if (a) {
    const probe = audioProbe(a);
    if (!probe || !canPlay(probe)) problems.push(nameOf(a));
  }

  if (!problems.length) return { verdict: 'yes', problems };
  // Computers can always install VLC, which plays everything; phones should get a file that just works.
  return { verdict: isMobile(platform) ? 'no' : 'app', problems };
}

/** The browser's answer, asked both ways (MediaSource knows more codecs on some browsers). */
export function browserCanPlay(mime: string): boolean {
  try {
    if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime)) return true;
  } catch {
    /* ignore */
  }
  try {
    return document.createElement('video').canPlayType(mime) !== '';
  } catch {
    return false;
  }
}

/** Which size to suggest when converting: phones get 720p (smaller), everything else the biggest offered. */
export function suggestedOption(o: DownloadOptions, platform: Platform): string {
  const ids = o.Options.map((x) => x.Id);
  if (isPhone(platform) && ids.includes('720p')) return '720p';
  return ids[0] ?? '';
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 10e9 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

const DEVICE_LABEL: Record<Platform, string> = {
  iphone: 'iPhone', ipad: 'iPad', 'android-phone': 'Android phone', 'android-tablet': 'Android tablet',
  mac: 'Mac', windows: 'Windows PC', chromeos: 'Chromebook', linux: 'Linux', other: 'computer',
};

/** What the server shows for this browser, e.g. "Chrome on Windows PC" or "Safari on iPhone". */
export function describeDevice(ua: string, touchPoints = 0): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome|CriOS|Chromium/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${DEVICE_LABEL[detectPlatform(ua, touchPoints)]}`;
}
