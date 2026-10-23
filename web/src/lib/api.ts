import type {
  ActiveSession, ActivityEntry, AdminUser, DupGroup, HeldFile, Item, Job, MediaSource, Overview, ScheduledTask, Session, Settings,
  SpaceSaverResult, SystemInfo, User, UserPolicy, VirtualFolder, DownloadJob, DownloadOptions, WatchHistoryResult, SavingsResult, AgentsResult,
} from './types';
import { demo } from './demo';
import { describeDevice } from './device';

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

export { deviceId };

/** The server is whatever served this page, unless a dev server URL is configured. */
export function defaultServer(): string {
  return (import.meta.env.VITE_SERVER as string | undefined) ?? location.origin;
}

function authHeader(token?: string): string {
  const parts = [
    `Client="${CLIENT}"`,
    `Device="${describeDevice(navigator.userAgent, navigator.maxTouchPoints)}"`,
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

  items(opts: { parentId?: string; types?: string; sortBy?: string; sortOrder?: string; search?: string; start?: number; limit?: number; genre?: string; favorites?: boolean; withImage?: string; count?: boolean }) {
    const q = new URLSearchParams({
      userId: this.userId,
      recursive: 'true',
      fields: Api.fields,
      sortBy: opts.sortBy ?? 'SortName',
      sortOrder: opts.sortOrder ?? 'Ascending',
      startIndex: String(opts.start ?? 0),
      limit: String(opts.limit ?? 120),
      // Counting the whole library is slow on big ones; only paging lists need it.
      enableTotalRecordCount: opts.count === false ? 'false' : 'true',
    });
    if (opts.parentId) q.set('parentId', opts.parentId);
    if (opts.types) q.set('includeItemTypes', opts.types);
    if (opts.search) q.set('searchTerm', opts.search);
    if (opts.genre) q.set('genres', opts.genre);
    if (opts.favorites) q.set('filters', 'IsFavorite');
    if (opts.withImage) q.set('imageTypes', opts.withImage);
    return this.get<{ Items: Item[]; TotalRecordCount: number }>(`/Items?${q}`);
  }

  /** Every movie and show in one light list, for instant typo-tolerant search as you type. */
  titleIndex() {
    const q = new URLSearchParams({
      userId: this.userId,
      recursive: 'true',
      includeItemTypes: 'Movie,Series',
      fields: 'SortName,OriginalTitle,ProductionYear,CommunityRating,DateCreated',
      enableImageTypes: 'Primary,Thumb,Backdrop',
      imageTypeLimit: '1',
      sortBy: 'SortName',
      limit: '50000',
    });
    return this.get<{ Items: Item[] }>(`/Items?${q}`).then((r) => r.Items);
  }

  /** Just the sort names of a library view, in order: enough to build the A–Z bar. */
  sortIndex(o: { parentId: string; types: string; genre?: string }) {
    const q = new URLSearchParams({
      userId: this.userId,
      parentId: o.parentId,
      recursive: 'true',
      includeItemTypes: o.types,
      sortBy: 'SortName',
      sortOrder: 'Ascending',
      fields: 'SortName',
      enableImages: 'false',
      enableUserData: 'false',
      limit: '50000',
    });
    if (o.genre) q.set('genres', o.genre);
    return this.get<{ Items: { Id: string; Name: string; SortName?: string }[] }>(`/Items?${q}`).then((r) => r.Items);
  }

  people(search: string, limit = 4) {
    return this.get<{ Items: Item[] }>(`/Persons?userId=${this.userId}&searchTerm=${encodeURIComponent(search)}&limit=${limit}&enableImageTypes=Primary`).then((r) => r.Items);
  }

  byPerson(personId: string) {
    return this.get<{ Items: Item[] }>(
      `/Items?userId=${this.userId}&recursive=true&personIds=${personId}&includeItemTypes=Movie,Series&sortBy=ProductionYear,SortName&sortOrder=Descending&fields=${Api.fields}&limit=200`,
    ).then((r) => r.Items);
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

  /** Every episode of a show in order (to carry on into the next season). */
  allEpisodes(seriesId: string) {
    return this.get<{ Items: Item[] }>(`/Shows/${seriesId}/Episodes?userId=${this.userId}&fields=Overview`).then((r) => r.Items);
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

  /**
   * Asks the server how to play an item. Choosing a non-default audio track, a subtitle that has to be
   * drawn into the picture, or a lower quality turns off direct play so the server builds a stream to match.
   */
  async playbackInfo(
    itemId: string,
    o: { mediaSourceId?: string; startTicks?: number; audioIndex?: number; subtitleIndex?: number; maxBitrate?: number; forceStream?: boolean } = {},
  ) {
    const bitrate = o.maxBitrate ?? maxBitrate();
    const q = new URLSearchParams({ userId: this.userId });
    if (o.mediaSourceId) q.set('mediaSourceId', o.mediaSourceId);
    if (o.audioIndex != null) q.set('audioStreamIndex', String(o.audioIndex));
    if (o.subtitleIndex != null) q.set('subtitleStreamIndex', String(o.subtitleIndex));
    return this.post<{ MediaSources: MediaSource[]; PlaySessionId: string }>(`/Items/${itemId}/PlaybackInfo?${q}`, {
      DeviceProfile: browserProfile(bitrate),
      MaxStreamingBitrate: bitrate,
      StartTimeTicks: o.startTicks ?? 0,
      MediaSourceId: o.mediaSourceId,
      AudioStreamIndex: o.audioIndex,
      SubtitleStreamIndex: o.subtitleIndex ?? -1,
      EnableDirectPlay: !o.forceStream,
      EnableDirectStream: !o.forceStream,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: true,
    });
  }

  /** This browser's own session on the server (what is actually being sent: codec, size, GPU or CPU). */
  mySession() {
    return this.get<ActiveSession[]>(`/Sessions?deviceId=${encodeURIComponent(deviceId())}`).then((r) => r[0]);
  }

  stopEncoding(playSessionId: string) {
    return this.del(`/Videos/ActiveEncodings?deviceId=${encodeURIComponent(deviceId())}&playSessionId=${playSessionId}`).catch(() => undefined);
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

  // ---------- Artwork and metadata (administrators) ----------

  art = {
    current: (id: string) => this.get<{ ImageType: string; ImageIndex?: number; ImageTag: string; Width?: number; Height?: number }[]>(`/Items/${id}/Images`),
    remote: (id: string, type: ImageKind, allLanguages: boolean) =>
      this.get<{ Images: RemoteImage[]; TotalRecordCount: number; Providers: string[] }>(
        `/Items/${id}/RemoteImages?type=${type}&includeAllLanguages=${allLanguages}&limit=120`,
      ),
    useRemote: (id: string, type: ImageKind, url: string) =>
      this.post(`/Items/${id}/RemoteImages/Download?type=${type}&imageUrl=${encodeURIComponent(url)}`),
    upload: async (id: string, type: ImageKind, file: File) => {
      if (isDemo) return;
      const b64 = await new Promise<string>((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1] ?? '');
        r.onerror = () => bad(r.error);
        r.readAsDataURL(file);
      });
      const res = await fetch(`${this.session.server}/Items/${id}/Images/${type}`, {
        method: 'POST',
        headers: { Authorization: authHeader(this.session.token), 'Content-Type': file.type || 'image/jpeg' },
        body: b64,
      });
      if (!res.ok) throw new ApiError(res.status, `The server answered ${res.status}.`);
    },
    remove: (id: string, type: ImageKind, index = 0) => this.del(`/Items/${id}/Images/${type}/${index}`),
    /** Re-read the title's info and artwork from the internet. */
    refresh: (id: string, replaceImages: boolean) =>
      this.post(
        `/Items/${id}/Refresh?recursive=true&metadataRefreshMode=FullRefresh&imageRefreshMode=FullRefresh&replaceAllMetadata=false&replaceAllImages=${replaceImages}`,
      ),
  };

  // ---------- Title info and matching (administrators) ----------

  meta = {
    /** Change a title's details. The server replaces the whole record, so start from the full copy. */
    update: async (id: string, patch: Record<string, unknown>, lock: string[]) => {
      const full = await this.get<Record<string, unknown>>(`/Items/${id}?userId=${this.userId}`);
      const locked = new Set([...((full.LockedFields as string[] | undefined) ?? []), ...lock]);
      return this.post(`/Items/${id}`, { ...full, ...patch, LockedFields: [...locked] });
    },
    unlock: async (id: string, fields: string[]) => {
      const full = await this.get<Record<string, unknown>>(`/Items/${id}?userId=${this.userId}`);
      const locked = ((full.LockedFields as string[] | undefined) ?? []).filter((f) => !fields.includes(f));
      return this.post(`/Items/${id}`, { ...full, LockedFields: locked });
    },
    /** Look a title up in the online databases (TheMovieDb, OMDb, ...). */
    search: (type: 'Movie' | 'Series', itemId: string, q: { name: string; year?: number; providerIds?: Record<string, string> }) =>
      this.post<MatchResult[]>(`/Items/RemoteSearch/${type}`, {
        ItemId: itemId,
        SearchInfo: { Name: q.name, Year: q.year, ProviderIds: q.providerIds ?? {} },
      }),
    /** Re-match a title to a search result; info and artwork are re-downloaded. */
    apply: (itemId: string, result: MatchResult, replaceImages: boolean) =>
      this.post(`/Items/RemoteSearch/Apply/${itemId}?replaceAllImages=${replaceImages}`, result),
  };

  /** Image URL for a specific image type and tag (used by the artwork editor). */
  imageUrl(id: string, type: ImageKind, tag: string, width: number, index = 0): string | undefined {
    if (isDemo) return undefined;
    return `${this.session.server}/Items/${id}/Images/${type}${type === 'Backdrop' ? `/${index}` : ''}?maxWidth=${width}&quality=90&tag=${tag}`;
  }

  // ---------- Downloads ----------

  downloads = {
    options: (itemId: string, mediaSourceId?: string) =>
      this.get<DownloadOptions>(`/ReelForge/DownloadJobs/Options/${itemId}${mediaSourceId ? `?mediaSourceId=${mediaSourceId}` : ''}`),
    start: (ItemId: string, MediaSourceId: string, Option: string, AudioIndex: number) =>
      this.post<DownloadJob>('/ReelForge/DownloadJobs', { ItemId, MediaSourceId, Option, AudioIndex }),
    list: () => this.get<DownloadJob[]>('/ReelForge/DownloadJobs'),
    remove: (id: string) => this.del(`/ReelForge/DownloadJobs/${id}`),
    /** Plain links (the browser downloads them itself, so the token rides in the address). */
    fileUrl: (id: string) => `${this.session.server}/ReelForge/DownloadJobs/${id}/File?ApiKey=${this.session.token}`,
    originalUrl: (itemId: string) => `${this.session.server}/Items/${itemId}/Download?ApiKey=${this.session.token}`,
  };

  // ---------- Server settings (administrators) ----------

  admin = {
    info: () => this.get<SystemInfo>('/System/Info'),
    config: () => this.get<Record<string, unknown>>('/System/Configuration'),
    saveConfig: (c: Record<string, unknown>) => this.post('/System/Configuration', c),
    namedConfig: (key: 'encoding' | 'network') => this.get<Record<string, unknown>>(`/System/Configuration/${key}`),
    saveNamedConfig: (key: 'encoding' | 'network', c: Record<string, unknown>) => this.post(`/System/Configuration/${key}`, c),
    restart: () => this.post('/System/Restart'),
    countries: () => this.get<{ Name: string; DisplayName: string; TwoLetterISORegionName: string }[]>('/Localization/Countries'),
    cultures: () => this.get<{ DisplayName: string; TwoLetterISOLanguageName: string }[]>('/Localization/Cultures'),
    ratings: () => this.get<{ Name: string; Value?: number; RatingScore?: { score: number; subScore?: number } }[]>('/Localization/ParentalRatings'),
    plugins: () => this.get<{ Name: string; Version: string; Id: string; Status: string }[]>('/Plugins'),

    libraries: () => this.get<VirtualFolder[]>('/Library/VirtualFolders'),
    addLibrary: (name: string, collectionType: string, paths: string[]) =>
      this.post(`/Library/VirtualFolders?name=${encodeURIComponent(name)}&collectionType=${collectionType}&refreshLibrary=true`, {
        LibraryOptions: { PathInfos: paths.map((Path) => ({ Path })), EnableRealtimeMonitor: true, EnablePhotos: true, SaveLocalMetadata: false },
      }),
    renameLibrary: (name: string, newName: string) =>
      this.post(`/Library/VirtualFolders/Name?name=${encodeURIComponent(name)}&newName=${encodeURIComponent(newName)}&refreshLibrary=false`),
    removeLibrary: (name: string) => this.del(`/Library/VirtualFolders?name=${encodeURIComponent(name)}&refreshLibrary=false`),
    addFolder: (name: string, path: string) =>
      this.post('/Library/VirtualFolders/Paths?refreshLibrary=true', { Name: name, PathInfo: { Path: path } }),
    removeFolder: (name: string, path: string) =>
      this.del(`/Library/VirtualFolders/Paths?name=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}&refreshLibrary=true`),
    scanAll: () => this.post('/Library/Refresh'),
    refreshLibrary: (itemId: string) =>
      this.post(`/Items/${itemId}/Refresh?recursive=true&metadataRefreshMode=Default&imageRefreshMode=Default&replaceAllMetadata=false&replaceAllImages=false`),

    users: () => this.get<AdminUser[]>('/Users'),
    newUser: (Name: string, Password: string) => this.post<AdminUser>('/Users/New', { Name, Password }),
    renameUser: (u: AdminUser, Name: string) => this.post(`/Users/${u.Id}`, { ...u, Name }),
    setPassword: (id: string, NewPw: string) =>
      this.post(`/Users/${id}/Password`, NewPw ? { NewPw, ResetPassword: false } : { ResetPassword: true }),
    setPolicy: (id: string, p: UserPolicy) => this.post(`/Users/${id}/Policy`, p),
    deleteUser: (id: string) => this.del(`/Users/${id}`),
    setUserImage: async (id: string, file: File) => {
      if (isDemo) return;
      const b64 = await new Promise<string>((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1] ?? '');
        r.onerror = () => bad(r.error);
        r.readAsDataURL(file);
      });
      const res = await fetch(`${this.session.server}/UserImage?userId=${id}`, {
        method: 'POST',
        headers: { Authorization: authHeader(this.session.token), 'Content-Type': file.type || 'image/jpeg' },
        body: b64,
      });
      if (!res.ok) throw new ApiError(res.status, `The server answered ${res.status}.`);
    },
    removeUserImage: (id: string) => this.del(`/UserImage?userId=${id}`),

    sessions: () => this.get<ActiveSession[]>('/Sessions?activeWithinSeconds=960'),
    stopSession: (id: string) => this.post(`/Sessions/${id}/Playing/Stop`),
    message: (id: string, text: string) => this.post(`/Sessions/${id}/Message`, { Header: 'Message from the server', Text: text, TimeoutMs: 8000 }),
    activity: (limit = 40) => this.get<{ Items: ActivityEntry[] }>(`/System/ActivityLog/Entries?limit=${limit}`).then((r) => r.Items),
    history: (days: number, userId?: string) =>
      this.get<WatchHistoryResult>(`/ReelForge/Activity/History?days=${days}${userId ? `&userId=${userId}` : ''}`),
    tasks: () => this.get<ScheduledTask[]>('/ScheduledTasks?isHidden=false'),
    runTask: (id: string) => this.post(`/ScheduledTasks/Running/${id}`),
    stopTask: (id: string) => this.del(`/ScheduledTasks/Running/${id}`),
  };

  // ---------- Media Manager ----------

  mm = {
    overview: () => this.get<Overview>('/ReelForge/Overview'),
    savings: () => this.get<SavingsResult>('/ReelForge/Savings'),
    agents: () => this.get<AgentsResult>('/ReelForge/Agents'),
    updateAgent: (id: string, change: { Enabled?: boolean; AllowCpu?: boolean; Name?: string }) => this.post(`/ReelForge/Agents/${id}`, change),
    removeAgent: (id: string) => this.del(`/ReelForge/Agents/${id}`),
    newAgentKey: () => this.post<{ PairingKey: string }>('/ReelForge/Agents/NewKey'),
    convertOnServer: (on: boolean) => this.post(`/ReelForge/Agents/ConvertOnServer?on=${on}`),
    libraryScan: () => this.get<{ Minutes: number; Running: boolean; LastEndUtc?: string }>('/ReelForge/LibraryScan'),
    setLibraryScan: (Minutes: number) => this.post('/ReelForge/LibraryScan', { Minutes }),
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
    startScan: <T,>(kind: 'duplicates' | 'spacesaver', o: { mediaKind?: string; fresh?: boolean } = {}) => {
      const q = new URLSearchParams({ kind, fresh: String(!!o.fresh) });
      if (o.mediaKind) q.set('mediaKind', o.mediaKind);
      return this.post<ScanStatus<T>>(`/ReelForge/Scans?${q}`);
    },
    scan: <T,>(id: string) => this.get<ScanStatus<T>>(`/ReelForge/Scans/${id}`),
    cancelScan: (id: string) => this.post(`/ReelForge/Scans/${id}/Cancel`),
    settings: () => this.get<Settings>('/ReelForge/Settings'),
    saveSettings: (s: Settings) => this.post<Settings>('/ReelForge/Settings', s),
    enableStreamingGpu: () => this.post('/ReelForge/Gpu/EnableStreamingAcceleration'),
    refreshGpu: () => this.post('/ReelForge/Gpu/Refresh'),
  };
}

export interface MatchResult {
  Name: string;
  ProductionYear?: number;
  PremiereDate?: string;
  ImageUrl?: string;
  SearchProviderName?: string;
  Overview?: string;
  ProviderIds?: Record<string, string>;
  [k: string]: unknown;
}

export interface ScanStatus<T> {
  Id: string;
  Kind: string;
  State: 'Running' | 'Done' | 'Failed' | 'Cancelled';
  Phase: string;
  Done: number;
  Total: number;
  StartedUtc: string;
  FinishedUtc?: string | null;
  Error?: string | null;
  Result?: T | null;
}

export type ImageKind = 'Primary' | 'Thumb' | 'Backdrop' | 'Logo';

export interface RemoteImage {
  ProviderName: string;
  Url: string;
  ThumbnailUrl?: string;
  Width?: number;
  Height?: number;
  Language?: string;
  CommunityRating?: number;
  VoteCount?: number;
  Type: string;
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

/** The quality picked in the player (remembered per browser). */
export function maxBitrate(): number {
  // Default: generous, so files play untouched on the home network.
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
export function browserProfile(bitrate = maxBitrate()) {
  const v = document.createElement('video');
  const can = (t: string) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(t);
  const hevc = can('video/mp4; codecs="hvc1.1.6.L120.90"') || v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') !== '';
  const av1 = can('video/mp4; codecs="av01.0.08M.08"');
  const mp4Video = ['h264', ...(hevc ? ['hevc'] : []), ...(av1 ? ['av1'] : [])].join(',');
  // Chrome and Edge on computers open MKV files directly, so most of a typical library plays untouched.
  const ua = navigator.userAgent;
  const mkv = /Chrome\/|Edg\//.test(ua) && !/Mobile|Android|OPR\//.test(ua);
  return {
    MaxStreamingBitrate: bitrate,
    MaxStaticBitrate: Math.max(bitrate, 1_000_000),
    MusicStreamingTranscodingBitrate: 320_000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v', Type: 'Video', VideoCodec: mp4Video, AudioCodec: 'aac,mp3,opus,flac' },
      { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'opus,vorbis' },
      ...(mkv ? [{ Container: 'mkv', Type: 'Video', VideoCodec: `${mp4Video},vp8,vp9`, AudioCodec: 'aac,mp3,opus,flac,vorbis' }] : []),
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
    // Text subtitles are always delivered as WebVTT (the format browsers draw natively); picture-based
    // subtitles (Blu-ray PGS, DVD) are drawn into the video by the server.
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
      { Format: 'dvbsub', Method: 'Encode' },
      { Format: 'xsub', Method: 'Encode' },
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
