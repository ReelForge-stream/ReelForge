import type {
  DupGroup, HeldFile, Item, Job, MediaSource, Overview, Session, Settings, SpaceSaverResult, User,
} from './types';
import { demo } from './demo';

const CLIENT = 'ReelForge';
const VERSION = '0.1.0';
const STORE = 'reelforge.session';

export const isDemo = new URLSearchParams(location.search).has('demo') || import.meta.env.VITE_DEMO === '1';

function deviceId(): string {
  try {
    let id = localStorage.getItem('reelforge.device');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('reelforge.device', id);
    }
    return id;
  } catch {
    return 'reelforge-browser';
  }
}

/** The server is whatever served this page, unless a dev server URL is configured. */
export function defaultServer(): string {
  return (import.meta.env.VITE_SERVER as string | undefined) ?? location.origin;
}

function authHeader(token?: string): string {
  const parts = [
    `Client="${CLIENT}"`,
    `Device="${navigator.userAgent.includes('Mobile') ? 'Phone' : 'Browser'}"`,
    `DeviceId="${deviceId()}"`,
    `Version="${VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function loadSession(): Session | null {
  if (isDemo) return new URLSearchParams(location.search).has('profiles') ? null : demo.session;
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: session lasts until reload */
  }
}

/** Profiles shown on "Who's watching?": the server's users that aren't hidden from the sign-in screen. */
export async function publicUsers(server: string): Promise<User[]> {
  if (isDemo) return demo.handle('GET', '/Users/Public', undefined) as Promise<User[]>;
  const res = await fetch(`${server}/Users/Public`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new ApiError(res.status, `${res.status}`);
  return (await res.json()) as User[];
}

export function userImage(server: string, u: User, size: number): string | undefined {
  if (isDemo || !u.PrimaryImageTag) return undefined;
  return `${server}/Users/${u.Id}/Images/Primary?width=${size}&quality=90&tag=${u.PrimaryImageTag}`;
}

export async function login(server: string, username: string, password: string): Promise<Session> {
  if (isDemo) return { ...demo.session, user: { ...demo.session.user, Name: username || demo.session.user.Name } };
  const res = await fetch(`${server}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ Username: username, Pw: password }),
  });
  if (res.status === 401) throw new ApiError(401, 'That username and password didn’t match.');
  if (!res.ok) throw new ApiError(res.status, `The server answered ${res.status}. Check the address and try again.`);
  const data = (await res.json()) as { AccessToken: string; User: User };
  return { server, token: data.AccessToken, user: data.User };
}

export class Api {
  constructor(public session: Session) {}

  get userId() {
    return this.session.user.Id;
  }

  get isAdmin() {
    return !!this.session.user.Policy?.IsAdministrator;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (isDemo) return demo.handle(method, path, body) as Promise<T>;
    const res = await fetch(`${this.session.server}${path}`, {
      method,
      headers: {
        Authorization: authHeader(this.session.token),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        msg = j.error ?? j.title ?? msg;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, msg);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get = <T,>(path: string) => this.req<T>('GET', path);
  post = <T,>(path: string, body?: unknown) => this.req<T>('POST', path, body ?? {});
  del = <T,>(path: string) => this.req<T>('DELETE', path);

  // ---------- Browsing ----------

  private static fields = 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres,OfficialRating,CommunityRating,ChildCount,DateCreated';

  views() {
    return this.get<{ Items: Item[] }>(`/UserViews?userId=${this.userId}`).then((r) => r.Items);
  }

  resume() {
    return this.get<{ Items: Item[] }>(
      `/UserItems/Resume?userId=${this.userId}&limit=12&mediaTypes=Video&fields=${Api.fields}&enableImageTypes=Primary,Backdrop,Thumb`,
    ).then((r) => r.Items);
  }

  nextUp() {
    return this.get<{ Items: Item[] }>(`/Shows/NextUp?userId=${this.userId}&limit=12&fields=${Api.fields}`).then((r) => r.Items);
  }

  latest(parentId: string) {
    return this.get<Item[]>(`/Items/Latest?userId=${this.userId}&parentId=${parentId}&limit=18&fields=${Api.fields}`);
  }

  items(opts: { parentId?: string; types?: string; sortBy?: string; sortOrder?: string; search?: string; start?: number; limit?: number; genre?: string; favorites?: boolean }) {
    const q = new URLSearchParams({
      userId: this.userId,
      recursive: 'true',
      fields: Api.fields,
      sortBy: opts.sortBy ?? 'SortName',
      sortOrder: opts.sortOrder ?? 'Ascending',
      startIndex: String(opts.start ?? 0),
      limit: String(opts.limit ?? 120),
      enableTotalRecordCount: 'true',
    });
    if (opts.parentId) q.set('parentId', opts.parentId);
    if (opts.types) q.set('includeItemTypes', opts.types);
    if (opts.search) q.set('searchTerm', opts.search);
    if (opts.genre) q.set('genres', opts.genre);
    if (opts.favorites) q.set('filters', 'IsFavorite');
    return this.get<{ Items: Item[]; TotalRecordCount: number }>(`/Items?${q}`);
  }

  item(id: string) {
    return this.get<Item>(`/Items/${id}?userId=${this.userId}&fields=${Api.fields},People,MediaSources,MediaStreams,Studios,Taglines`);
  }

  similar(id: string) {
    return this.get<{ Items: Item[] }>(`/Items/${id}/Similar?userId=${this.userId}&limit=12&fields=${Api.fields}`).then((r) => r.Items);
  }

  genres(parentId?: string) {
    const q = new URLSearchParams({ userId: this.userId, sortBy: 'SortName' });
    if (parentId) q.set('parentId', parentId);
    return this.get<{ Items: { Name: string; Id: string }[] }>(`/Genres?${q}`).then((r) => r.Items);
  }

  setFavorite(id: string, fav: boolean) {
    return fav ? this.post(`/UserFavoriteItems/${id}?userId=${this.userId}`) : this.del(`/UserFavoriteItems/${id}?userId=${this.userId}`);
  }

  users() {
    return this.get<User[]>('/Users');
  }

  seasons(seriesId: string) {
    return this.get<{ Items: Item[] }>(`/Shows/${seriesId}/Seasons?userId=${this.userId}`).then((r) => r.Items);
  }

  episodes(seriesId: string, seasonId: string) {
    return this.get<{ Items: Item[] }>(`/Shows/${seriesId}/Episodes?userId=${this.userId}&seasonId=${seasonId}&fields=Overview`).then((r) => r.Items);
  }

  markPlayed(id: string, played: boolean) {
    return played ? this.post(`/UserPlayedItems/${id}?userId=${this.userId}`) : this.del(`/UserPlayedItems/${id}?userId=${this.userId}`);
  }

  image(item: Item, kind: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo', width: number): string | undefined {
    if (isDemo) return undefined;
    const s = this.session.server;
    if (kind === 'Logo') {
      if (item.ImageTags?.Logo) return `${s}/Items/${item.Id}/Images/Logo?maxWidth=${width}&quality=90&tag=${item.ImageTags.Logo}`;
      if (item.ParentLogoItemId && item.ParentLogoImageTag)
        return `${s}/Items/${item.ParentLogoItemId}/Images/Logo?maxWidth=${width}&quality=90&tag=${item.ParentLogoImageTag}`;
      return undefined;
    }
    if (kind === 'Thumb' && !item.ImageTags?.Thumb && item.ParentThumbItemId && item.ParentThumbImageTag && item.Type !== 'Episode')
      return `${s}/Items/${item.ParentThumbItemId}/Images/Thumb?maxWidth=${width}&quality=85&tag=${item.ParentThumbImageTag}`;
    if (kind === 'Backdrop') {
      if (item.BackdropImageTags?.length) return `${s}/Items/${item.Id}/Images/Backdrop/0?maxWidth=${width}&quality=85&tag=${item.BackdropImageTags[0]}`;
      if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length)
        return `${s}/Items/${item.ParentBackdropItemId}/Images/Backdrop/0?maxWidth=${width}&quality=85&tag=${item.ParentBackdropImageTags[0]}`;
      return undefined;
    }
    const tag = item.ImageTags?.[kind];
    if (tag) return `${s}/Items/${item.Id}/Images/${kind}?maxWidth=${width}&quality=90&tag=${tag}`;
    if (kind === 'Primary' && item.SeriesId && item.SeriesPrimaryImageTag)
      return `${s}/Items/${item.SeriesId}/Images/Primary?maxWidth=${width}&quality=90&tag=${item.SeriesPrimaryImageTag}`;
    return undefined;
  }

  // ---------- Playback ----------

  async playbackInfo(itemId: string, mediaSourceId: string | undefined, startTicks: number, audioIndex?: number) {
    return this.post<{ MediaSources: MediaSource[]; PlaySessionId: string }>(`/Items/${itemId}/PlaybackInfo?userId=${this.userId}`, {
      DeviceProfile: browserProfile(),
      MaxStreamingBitrate: maxBitrate(),
      StartTimeTicks: startTicks,
      MediaSourceId: mediaSourceId,
      AudioStreamIndex: audioIndex,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AutoOpenLiveStream: true,
    });
  }

  streamUrl(itemId: string, src: MediaSource, playSessionId: string): { url: string; hls: boolean } {
    if (isDemo) return { url: '', hls: false };
    const s = this.session.server;
    if (src.SupportsDirectPlay || (src.SupportsDirectStream && !src.TranscodingUrl)) {
      const q = new URLSearchParams({ static: 'true', mediaSourceId: src.Id, playSessionId, api_key: this.session.token });
      return { url: `${s}/Videos/${itemId}/stream?${q}`, hls: false };
    }
    return { url: `${s}${src.TranscodingUrl}`, hls: true };
  }

  reportStart(b: PlaybackReport) {
    return this.post('/Sessions/Playing', b).catch(() => undefined);
  }

  reportProgress(b: PlaybackReport) {
    return this.post('/Sessions/Playing/Progress', b).catch(() => undefined);
  }

  reportStop(b: PlaybackReport) {
    return this.post('/Sessions/Playing/Stopped', b).catch(() => undefined);
  }

  subtitleUrl(path: string) {
    return `${this.session.server}${path}${path.includes('?') ? '&' : '?'}api_key=${this.session.token}`;
  }

  // ---------- Media Manager ----------

  mm = {
    overview: () => this.get<Overview>('/ReelForge/Overview'),
    duplicates: (libraryId?: string) => this.get<DupGroup[]>(`/ReelForge/Duplicates${libraryId ? `?libraryId=${libraryId}` : ''}`),
    removeDuplicates: (files: { ItemId: string; MediaSourceId: string }[]) =>
      this.post<{ Removed: number; Errors: string[]; HoldingDays: number }>('/ReelForge/Duplicates/Remove', { Files: files }),
    spaceSaver: (libraryId?: string, kind?: string) => {
      const q = new URLSearchParams();
      if (libraryId) q.set('libraryId', libraryId);
      if (kind) q.set('kind', kind);
      return this.get<SpaceSaverResult>(`/ReelForge/SpaceSaver?${q}`);
    },
    queue: (files: { ItemId: string; MediaSourceId: string }[]) => this.post<Job[]>('/ReelForge/SpaceSaver/Queue', { Files: files }),
    jobs: () => this.get<{ Paused: boolean; Waiting?: string | null; Jobs: Job[] }>('/ReelForge/Jobs'),
    cancelJob: (id: string) => this.post(`/ReelForge/Jobs/${id}/Cancel`),
    clearFinished: () => this.post('/ReelForge/Jobs/ClearFinished'),
    pause: (paused: boolean) => this.post(`/ReelForge/Jobs/Pause?paused=${paused}`),
    holding: () => this.get<HeldFile[]>('/ReelForge/Holding'),
    restore: (id: string) => this.post(`/ReelForge/Holding/${id}/Restore`),
    purge: (id: string) => this.del(`/ReelForge/Holding/${id}`),
    emptyHolding: () => this.post<{ FreedBytes: number }>('/ReelForge/Holding/EmptyAll'),
    settings: () => this.get<Settings>('/ReelForge/Settings'),
    saveSettings: (s: Settings) => this.post<Settings>('/ReelForge/Settings', s),
    enableStreamingGpu: () => this.post('/ReelForge/Gpu/EnableStreamingAcceleration'),
    refreshGpu: () => this.post('/ReelForge/Gpu/Refresh'),
  };
}

export interface PlaybackReport {
  ItemId: string;
  MediaSourceId: string;
  PlaySessionId: string;
  PositionTicks: number;
  IsPaused?: boolean;
  CanSeek?: boolean;
  PlayMethod?: 'DirectPlay' | 'DirectStream' | 'Transcode';
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
}

function maxBitrate(): number {
  // Let the user cap remote streaming in Settings later; default: generous on LAN.
  try {
    const v = Number(localStorage.getItem('reelforge.maxBitrate'));
    if (v > 0) return v;
  } catch {
    /* ignore */
  }
  return 120_000_000;
}

/**
 * Tells the server what this browser can play natively. Anything else is transcoded to HLS —
 * as HEVC when the browser can decode it (half the bandwidth of H.264 for remote viewing),
 * otherwise H.264.
 */
export function browserProfile() {
  const v = document.createElement('video');
  const can = (t: string) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(t);
  const hevc = can('video/mp4; codecs="hvc1.1.6.L120.90"') || v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') !== '';
  const av1 = can('video/mp4; codecs="av01.0.08M.08"');
  const mp4Video = ['h264', ...(hevc ? ['hevc'] : []), ...(av1 ? ['av1'] : [])].join(',');
  return {
    MaxStreamingBitrate: maxBitrate(),
    MaxStaticBitrate: 200_000_000,
    MusicStreamingTranscodingBitrate: 320_000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v', Type: 'Video', VideoCodec: mp4Video, AudioCodec: 'aac,mp3,opus,flac' },
      { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'opus,vorbis' },
      { Container: 'mp3,aac,flac,opus,webm', Type: 'Audio' },
    ],
    TranscodingProfiles: [
      {
        Container: hevc ? 'mp4' : 'ts',
        Type: 'Video',
        VideoCodec: hevc ? 'hevc,h264' : 'h264',
        AudioCodec: 'aac,mp3',
        Context: 'Streaming',
        Protocol: 'hls',
        MaxAudioChannels: '6',
        MinSegments: '1',
        BreakOnNonKeyFrames: true,
      },
      { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Context: 'Streaming', Protocol: 'http' },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'ass', Method: 'Encode' },
      { Format: 'ssa', Method: 'Encode' },
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
    ],
  };
}

// ---------- formatting ----------

export function bytes(n: number, digits = 1): string {
  if (!n) return '0 GB';
  const tb = n / 1e12;
  if (tb >= 1) return `${tb.toFixed(digits)} TB`;
  const gb = n / 1e9;
  if (gb >= 1) return `${gb.toFixed(digits)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

export function runtime(ticks?: number): string {
  if (!ticks) return '';
  const min = Math.round(ticks / 600_000_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function duration(sec?: number | null): string {
  if (sec == null) return '';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
