// Demo mode (?demo): an invented library so the UI can be explored without a server.
// All titles are made up; artwork is generated from colour seeds.
import type { DupGroup, Estimate, HeldFile, Item, Job, Session, Settings, SpaceSaverResult } from './types';

const T = 10_000_000; // ticks per second

const movies: Item[] = [
  ['The Lantern Keeper', 2023, 'Drama', 128, 'A lighthouse keeper on a shrinking island records the last summer before the sea takes the cottage.', 22],
  ['Northbound Freight', 2019, 'Thriller', 112, 'Two rival truckers haul a sealed container across a blizzard-bound pass.', 205],
  ['Paper Moons', 2021, 'Comedy', 97, 'A failing magician and his teenage niece take over a children’s party circuit.', 48],
  ['Signal Hill', 2024, 'Sci-Fi', 141, 'A radio astronomer hears her own voice in a transmission from 1962.', 262],
  ['Copperline', 2018, 'Western', 119, 'A mine closes and the town decides who it belongs to.', 30],
  ['Saltwater Kings', 2022, 'Adventure', 133, 'Three brothers race to salvage a wreck before the treasure hunters arrive.', 190],
  ['Last Train to Ridley', 2020, 'Mystery', 104, 'Every passenger on the overnight train is lying about the same afternoon.', 340],
  ['Hollow Orchard', 2017, 'Horror', 99, 'An apple farm that has not had a harvest in forty years suddenly bears fruit.', 95],
  ['The Quiet Mile', 2025, 'Drama', 126, 'A retired runner coaches the town’s worst cross-country team.', 160],
  ['Glasshouse', 2016, 'Thriller', 110, 'An architect suspects the house she designed is watching her family.', 230],
  ['Marigold Avenue', 2023, 'Family', 92, 'A street full of neighbours plans one impossible surprise.', 38],
  ['Deep Field', 2021, 'Sci-Fi', 137, 'A survey crew finds a perfectly flat plain on a planet with no wind.', 280],
].map(([name, year, genre, min, overview, hue], i) => ({
  Id: `m${i}`,
  Name: name as string,
  Type: 'Movie',
  ProductionYear: year as number,
  Genres: [...new Set([genre as string, ['Drama', 'Thriller', 'Comedy', 'Adventure'][i % 4]])],
  RunTimeTicks: (min as number) * 60 * T,
  Overview: overview as string,
  OfficialRating: ['PG-13', 'R', 'PG', 'PG-13'][i % 4],
  CommunityRating: 6.4 + ((i * 7) % 25) / 10,
  _hue: hue as number,
  DateCreated: new Date(Date.now() - (i < 3 ? i + 1 : 30 + i) * 86400000).toISOString(),
  Taglines: i === 3 ? ['Some messages take sixty years to arrive.'] : undefined,
  Studios: [{ Name: ['Northlight Pictures', 'Harrow & Vale', 'Tidewater Films'][i % 3] }],
  UserData: { PlayedPercentage: i === 3 ? 42 : i === 6 ? 71 : undefined, PlaybackPositionTicks: i === 3 ? 59 * 60 * T : i === 6 ? 73 * 60 * T : 0, Played: i === 1 },
}));

const shows: Item[] = [
  ['Harbour Lights', 2022, 'Drama', 3, 'Life, loss and lobster season in a Nova Scotia fishing town.', 200],
  ['Stacks', 2024, 'Comedy', 2, 'The night shift at a 24-hour public library.', 55],
  ['Undertow', 2020, 'Crime', 4, 'A coastal detective reopens the case that ended her father’s career.', 220],
].map(([name, year, genre, seasons, overview, hue], i) => ({
  Id: `s${i}`,
  Name: name as string,
  Type: 'Series',
  ProductionYear: year as number,
  Genres: [genre as string],
  ChildCount: seasons as number,
  Overview: overview as string,
  _hue: hue as number,
  DateCreated: new Date(Date.now() - (i === 1 ? 2 : 40) * 86400000).toISOString(),
  OfficialRating: ['TV-14', 'TV-PG', 'TV-MA'][i],
  CommunityRating: 7.6 + i / 5,
  Studios: [{ Name: ['Harbourside TV', 'Night Owl', 'Grey Coast'][i] }],
  UserData: { UnplayedItemCount: 6 + i * 4 },
}));

const views: Item[] = [
  { Id: 'lib-movies', Name: 'Movies', Type: 'CollectionFolder', CollectionType: 'movies', _hue: 30 },
  { Id: 'lib-shows', Name: 'TV Shows', Type: 'CollectionFolder', CollectionType: 'tvshows', _hue: 200 },
];

function episodes(seriesId: string, seasonNo: number): Item[] {
  const s = shows.find((x) => x.Id === seriesId)!;
  const titles = ['Pilot', 'Low Tide', 'The Ledger', 'Fog Bell', 'Open Water', 'Inventory', 'Night Ferry', 'Spring Thaw'];
  return titles.map((t, i) => ({
    Id: `${seriesId}-${seasonNo}-${i + 1}`,
    Name: seasonNo === 1 && i === 0 ? 'Pilot' : t,
    Type: 'Episode',
    SeriesId: seriesId,
    SeasonId: `${seriesId}-season-${seasonNo}`,
    SeriesName: s.Name,
    ParentIndexNumber: seasonNo,
    IndexNumber: i + 1,
    RunTimeTicks: (44 + (i % 3) * 4) * 60 * T,
    Overview: 'An unexpected visitor arrives with news that changes the season’s plans.',
    _hue: (s._hue ?? 0) + i * 6,
    UserData: { Played: seasonNo === 1 && i < 3, PlayedPercentage: seasonNo === 1 && i === 3 ? 35 : undefined },
  }));
}

const GB = 1e9;

let dupGroups: DupGroup[] = [
  {
    Key: 'movie:tmdb:1', Kind: 'Movie', Title: 'Signal Hill (2024)', LooksLikeEditions: false, ReclaimableBytes: 14.2 * GB,
    Files: [
      { ItemId: 'm3', MediaSourceId: 'a1', Title: 'Signal Hill (2024)', Path: 'D:\\Movies\\Signal Hill (2024)\\Signal Hill (2024) - 2160p.mkv', FileName: 'Signal Hill (2024) - 2160p.mkv', SizeBytes: 31.6 * GB, Summary: '4K · HEVC 10-bit · HDR10 · 7.1', Score: 515, Keep: true },
      { ItemId: 'm3b', MediaSourceId: 'a2', Title: 'Signal Hill (2024)', Path: 'E:\\Downloads\\Signal.Hill.2024.1080p.BluRay.x264.mkv', FileName: 'Signal.Hill.2024.1080p.BluRay.x264.mkv', SizeBytes: 14.2 * GB, Summary: '1080p · H.264 · 5.1', Score: 371, Keep: false },
    ],
  },
  {
    Key: 'movie:tmdb:2', Kind: 'Movie', Title: 'Copperline (2018)', LooksLikeEditions: false, ReclaimableBytes: 6.3 * GB,
    Files: [
      { ItemId: 'm4', MediaSourceId: 'b1', Title: 'Copperline (2018)', Path: 'D:\\Movies\\Copperline (2018)\\Copperline (2018).mkv', FileName: 'Copperline (2018).mkv', SizeBytes: 9.8 * GB, Summary: '1080p · HEVC · 5.1', Score: 362, Keep: true },
      { ItemId: 'm4b', MediaSourceId: 'b2', Title: 'Copperline (2018)', Path: 'D:\\Movies\\Copperline (2018)\\Copperline (2018) - 720p.mp4', FileName: 'Copperline (2018) - 720p.mp4', SizeBytes: 4.1 * GB, Summary: '720p · H.264 · Stereo', Score: 241, Keep: false },
      { ItemId: 'm4c', MediaSourceId: 'b3', Title: 'Copperline (2018)', Path: 'F:\\Old Drive\\copperline.avi', FileName: 'copperline.avi', SizeBytes: 2.2 * GB, Summary: '480p · MPEG-4 · Stereo', Score: 121, Keep: false },
    ],
  },
  {
    Key: 'ep:tvdb:3:s1:e4', Kind: 'Episode', Title: 'Undertow S01E04 · Fog Bell', LooksLikeEditions: false, ReclaimableBytes: 1.9 * GB,
    Files: [
      { ItemId: 'e1', MediaSourceId: 'c1', Title: 'Undertow S01E04 · Fog Bell', Path: 'T:\\TV\\Undertow\\Season 01\\Undertow - S01E04.mkv', FileName: 'Undertow - S01E04.mkv', SizeBytes: 2.4 * GB, Summary: '1080p · HEVC · 5.1', Score: 350, Keep: true },
      { ItemId: 'e2', MediaSourceId: 'c2', Title: 'Undertow S01E04 · Fog Bell', Path: 'T:\\TV\\Undertow (2020)\\S1\\undertow.s01e04.720p.web.mkv', FileName: 'undertow.s01e04.720p.web.mkv', SizeBytes: 1.9 * GB, Summary: '720p · H.264 · Stereo', Score: 240, Keep: false },
    ],
  },
  {
    Key: 'movie:tmdb:4', Kind: 'Movie', Title: 'Glasshouse (2016)', LooksLikeEditions: true, ReclaimableBytes: 0,
    Files: [
      { ItemId: 'm9', MediaSourceId: 'd1', Title: 'Glasshouse (2016)', Path: 'D:\\Movies\\Glasshouse (2016)\\Glasshouse (2016) - Director’s Cut.mkv', FileName: 'Glasshouse (2016) - Director’s Cut.mkv', SizeBytes: 11.1 * GB, Summary: '1080p · H.264 · 5.1', Score: 355, Keep: true, Edition: 'Director’s Cut' },
      { ItemId: 'm9b', MediaSourceId: 'd2', Title: 'Glasshouse (2016)', Path: 'D:\\Movies\\Glasshouse (2016)\\Glasshouse (2016).mkv', FileName: 'Glasshouse (2016).mkv', SizeBytes: 9.4 * GB, Summary: '1080p · H.264 · 5.1', Score: 352, Keep: true, Edition: null },
    ],
  },
];

const space: SpaceSaverResult = {
  FilesScanned: 1284,
  Candidates: movies.slice(0, 9).map((m, i): Estimate => {
    const size = (6 + ((i * 37) % 19)) * GB;
    const est = size * (0.34 + (i % 4) * 0.06);
    return {
      ItemId: m.Id, MediaSourceId: `src-${m.Id}`, Title: `${m.Name} (${m.ProductionYear})`, Kind: 'Movie' as const,
      Path: `D:\\Movies\\${m.Name} (${m.ProductionYear})\\${m.Name} (${m.ProductionYear}).mkv`,
      Summary: i % 3 === 0 ? '1080p · H.264 · 7.1' : i % 3 === 1 ? '1080p · VC1 · 5.1' : '720p · H.264 · 5.1',
      SizeBytes: size, EstimatedBytes: est, SavingsBytes: size - est, SavingsFraction: 1 - est / size,
      Note: i % 3 === 1 ? '1080p · VC1 · 5.1 → HEVC' : '1080p · H.264 · 7.1 → HEVC',
    };
  }).concat(shows.flatMap((s) => [1, 2, 3].map((e): Estimate => ({
    ItemId: `${s.Id}-1-${e}`, MediaSourceId: `src-${s.Id}-${e}`, Title: `${s.Name} S01E0${e}`, Kind: 'Episode' as const,
    Path: `T:\\TV\\${s.Name}\\Season 01\\${s.Name} - S01E0${e}.mkv`, Summary: '1080p · H.264 · 5.1',
    SizeBytes: 3.1 * GB, EstimatedBytes: 1.3 * GB, SavingsBytes: 1.8 * GB, SavingsFraction: 0.58, Note: '1080p · H.264 · 5.1 → HEVC',
  })))).sort((a, b) => b.SavingsBytes - a.SavingsBytes),
  TotalSavingsBytes: 0,
  TotalCandidateBytes: 0,
  SkippedByReason: {
    'Already efficiently encoded': 612,
    'Saving would be too small': 301,
    'HDR — turn on "Include HDR" to convert': 38,
    'Dolby Vision — converting would strip the DV layer': 11,
    'Too short to bother': 47,
  },
  Encoder: { GpuName: 'Quadro P4000', DriverVersion: '581.42', Working: ['hevc_nvenc', 'libx265', 'libsvtav1'], HevcNvenc10Bit: true, Summary: 'GPU conversion ready on Quadro P4000 (HEVC)' },
};
space.TotalSavingsBytes = space.Candidates.reduce((a, c) => a + c.SavingsBytes, 0);
space.TotalCandidateBytes = space.Candidates.reduce((a, c) => a + c.SizeBytes, 0);

let jobs: Job[] = [
  { Id: 'j1', ItemId: 'm1', MediaSourceId: 'x', Title: 'Northbound Freight (2019)', Path: '', OriginalBytes: 12.4 * GB, EstimatedBytes: 4.9 * GB, Status: 'Running', Progress: 0.38, Speed: 7.4, EtaSeconds: 690, Encoder: 'hevc_nvenc' },
  { Id: 'j2', ItemId: 'm2', MediaSourceId: 'y', Title: 'Paper Moons (2021)', Path: '', OriginalBytes: 8.2 * GB, EstimatedBytes: 3.1 * GB, Status: 'Queued', Progress: 0, Speed: 0 },
  { Id: 'j3', ItemId: 'm5', MediaSourceId: 'z', Title: 'Saltwater Kings (2022)', Path: '', OriginalBytes: 14.9 * GB, EstimatedBytes: 5.6 * GB, ResultBytes: 5.2 * GB, Status: 'Done', Progress: 1, Speed: 0, Encoder: 'hevc_nvenc', Message: 'Saved 9.70 GB', FinishedUtc: new Date(Date.now() - 3.6e6).toISOString() },
  { Id: 'j4', ItemId: 'm7', MediaSourceId: 'w', Title: 'Hollow Orchard (2017)', Path: '', OriginalBytes: 7.7 * GB, EstimatedBytes: 3.0 * GB, Status: 'Failed', Progress: 0, Speed: 0, Message: 'Verification failed: 1 audio tracks, expected 2', FinishedUtc: new Date(Date.now() - 7.2e6).toISOString() },
];

let held: HeldFile[] = [
  { Id: 'h1', Title: 'Saltwater Kings (2022)', OriginalPath: 'D:\\Movies\\Saltwater Kings (2022)\\Saltwater Kings (2022).mp4', HeldPath: 'D:\\.reelforge-holding\\…', SizeBytes: 14.9 * GB, Reason: 'Replaced by converted copy', HeldAtUtc: new Date(Date.now() - 3.6e6).toISOString() },
  { Id: 'h2', Title: 'Marigold Avenue (2023)', OriginalPath: 'E:\\Downloads\\Marigold.Avenue.2023.720p.mkv', HeldPath: 'E:\\.reelforge-holding\\…', SizeBytes: 3.2 * GB, Reason: 'Duplicate', HeldAtUtc: new Date(Date.now() - 4 * 864e5).toISOString() },
];

let settings: Settings = {
  TargetCodec: 'Hevc', Preset: 'Balanced', IncludeHdr: false, HoldingDays: 14, PauseWhileStreaming: true,
  WindowStartHour: 23, WindowEndHour: 7, MaxConcurrentJobs: 1,
};

let paused = false;
let gpuStreaming = false;

// Make the running job move so the queue page feels alive.
setInterval(() => {
  const r = jobs.find((j) => j.Status === 'Running');
  if (!r || paused) return;
  r.Progress = Math.min(0.999, r.Progress + 0.004);
  r.EtaSeconds = Math.round((1 - r.Progress) * 1100);
}, 1000);

const session: Session = { server: '', token: 'demo', user: { Id: 'demo', Name: 'Cade', Policy: { IsAdministrator: true } } };

const favorites = new Set<string>(['m3', 's0']);
const played = new Set<string>(['m1']);
const people = [
  { Name: 'Ana Ferreira', Type: 'Director' },
  { Name: 'Tom Okafor', Role: 'Lead', Type: 'Actor' },
  { Name: 'Ruth Lindqvist', Role: 'Mara', Type: 'Actor' },
  { Name: 'Dev Raman', Role: 'Eli', Type: 'Actor' },
  { Name: 'Hollis Grant', Role: 'The Captain', Type: 'Actor' },
  { Name: 'June Park', Type: 'Writer' },
];
const profiles = [
  { Id: 'demo', Name: 'Cade', HasPassword: false },
  { Id: 'u2', Name: 'Jess', HasPassword: false },
  { Id: 'u3', Name: 'Kids', HasPassword: false },
  { Id: 'u4', Name: 'Guest', HasPassword: true },
];
function withUser(i: Item): Item {
  return { ...i, UserData: { ...i.UserData, IsFavorite: favorites.has(i.Id), Played: played.has(i.Id) || !!i.UserData?.Played } };
}

function demoArt(i: number, wide: boolean, type: string) {
  const h = (i * 47 + 20) % 360;
  const [w, ht] = type === 'Logo' ? [800, 310] : wide ? [1920, 1080] : [1000, 1500];
  const svg = type === 'Logo'
    ? `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 310'><text x='400' y='190' font-size='110' font-family='sans-serif' font-weight='800' text-anchor='middle' fill='hsl(${h} 80% 65%)'>TITLE</text></svg>`
    : `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${ht}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h} 60% 45%)'/><stop offset='1' stop-color='hsl(${(h + 40) % 360} 50% 15%)'/></linearGradient></defs><rect width='100%' height='100%' fill='url(%23g)'/></svg>`;
  const url = `data:image/svg+xml;utf8,${svg.replace(/#/g, '%23')}`;
  return { ProviderName: 'TheMovieDb', Url: url, ThumbnailUrl: url, Width: w, Height: ht, Language: i % 3 ? 'en' : undefined, CommunityRating: 7.8 - i * 0.3, VoteCount: 40 - i, Type: type };
}

function demoSource(id: string) {
  const sub = (Index: number, Language: string, Codec: string, extra: object = {}) => ({
    Index, Type: 'Subtitle', Language, Codec, IsTextSubtitleStream: Codec !== 'PGSSUB',
    DeliveryMethod: Codec === 'PGSSUB' ? 'Encode' : 'External', DeliveryUrl: Codec === 'PGSSUB' ? undefined : `/Videos/${id}/demo/Subtitles/${Index}/0/Stream.vtt`, ...extra,
  });
  return {
    Id: 'demo', Container: 'mkv', Size: 18.4e9, Bitrate: 34_000_000, SupportsDirectPlay: true, DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1,
    MediaStreams: [
      { Index: 0, Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160, BitRate: 31_000_000, RealFrameRate: 23.976, VideoRangeType: 'HDR10' },
      { Index: 1, Type: 'Audio', Codec: 'eac3', Language: 'eng', ChannelLayout: '5.1', Channels: 6, IsDefault: true },
      { Index: 2, Type: 'Audio', Codec: 'aac', Language: 'eng', ChannelLayout: 'stereo', Channels: 2, Title: 'Commentary' },
      { Index: 3, Type: 'Audio', Codec: 'ac3', Language: 'spa', ChannelLayout: '5.1', Channels: 6 },
      sub(4, 'eng', 'subrip'),
      sub(5, 'eng', 'subrip', { Title: 'SDH' }),
      sub(6, 'eng', 'subrip', { IsForced: true }),
      sub(7, 'spa', 'PGSSUB'),
    ],
  };
}

const basePolicy = {
  IsAdministrator: false, IsHidden: false, IsDisabled: false, EnableRemoteAccess: true, EnableAllFolders: true, EnabledFolders: [] as string[],
  EnableContentDeletion: false, EnableContentDownloading: true, EnableVideoPlaybackTranscoding: true, RemoteClientBitrateLimit: 0, BlockUnratedItems: [] as string[],
  MaxParentalRating: null as number | null,
};
let users = [
  { Id: 'demo', Name: 'Cade', HasPassword: true, LastActivityDate: new Date(Date.now() - 3600e3).toISOString(), Policy: { ...basePolicy, IsAdministrator: true, EnableContentDeletion: true } },
  { Id: 'u2', Name: 'Jess', HasPassword: true, LastActivityDate: new Date(Date.now() - 86400e3).toISOString(), Policy: { ...basePolicy } },
  { Id: 'u3', Name: 'Kids', HasPassword: false, LastActivityDate: new Date(Date.now() - 3 * 86400e3).toISOString(), Policy: { ...basePolicy, EnableRemoteAccess: false, MaxParentalRating: 10 as number | null, EnableAllFolders: false, EnabledFolders: ['lib-movies'] } },
  { Id: 'u4', Name: 'Guest', HasPassword: true, Policy: { ...basePolicy, IsHidden: true, EnableRemoteAccess: false } },
];
let serverConfig: Record<string, unknown> = { ServerName: 'ReelForge', PreferredMetadataLanguage: 'en', MetadataCountryCode: 'US', RemoteClientBitrateLimit: 20_000_000 };
let encoding: Record<string, unknown> = {
  HardwareAccelerationType: 'nvenc', EnableHardwareEncoding: true, HardwareDecodingCodecs: ['h264', 'hevc', 'vc1', 'mpeg2video', 'vp9'], EnableDecodingColorDepth10Hevc: true,
  EnableDecodingColorDepth10Vp9: true, AllowHevcEncoding: true, AllowAv1Encoding: false, EnableTonemapping: true, EnableThrottling: true, EnableSegmentDeletion: true, EncoderPreset: 'auto',
};
let network: Record<string, unknown> = {
  EnableRemoteAccess: true, InternalHttpPort: 8096, PublicHttpPort: 8096, LocalNetworkSubnets: ['10.0.0.0/24', '100.64.0.0/10'], KnownProxies: [], AutoDiscovery: true, BaseUrl: '',
};
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const tasks = [
  ['RefreshLibrary', 'Scan Media Library', 'Library', 5], ['DownloadSubtitles', 'Download missing subtitles', 'Library', 20], ['RefreshChapterImages', 'Extract Chapter Images', 'Library', 26],
  ['PluginUpdates', 'Update Plugins', 'Application', 9], ['DeleteTranscodeFiles', 'Clean Transcode Directory', 'Maintenance', 2], ['OptimizeDatabaseTask', 'Optimize database', 'Maintenance', 30],
].map(([Key, Name, Category, h], i) => ({ Id: `t${i}`, Key, Name, Category, State: 'Idle', LastExecutionResult: { StartTimeUtc: ago(h as number), EndTimeUtc: ago(h as number), Status: 'Completed' } }));
const activity = [
  ['Jess is playing Harbour Lights S01E04 on Living Room TV', 'Living Room TV', 0.2, 'Information'],
  ['Cade successfully authenticated', 'IP address: 10.0.0.23', 1, 'Information'],
  ['Kids is online from iPad', 'IP address: 10.0.0.41', 3, 'Information'],
  ['ReelForge 0.3.0 was installed', 'Restart the server to finish', 9, 'Information'],
  ['Failed sign-in for “guest”', 'IP address: 100.71.4.9', 30, 'Warning'],
].map(([Name, ShortOverview, h, Severity], i) => ({ Id: i, Name, ShortOverview, Type: 'x', Date: ago(h as number), Severity }));
function demoSessions() {
  return [
    {
      Id: 'sess1', UserName: 'Jess', Client: 'Android TV', DeviceName: 'Living Room TV', RemoteEndPoint: '10.0.0.37', NowPlayingItem: episodes('s0', 1)[3],
      PlayState: { PositionTicks: 21 * 60 * T, IsPaused: false, PlayMethod: 'Transcode' },
      TranscodingInfo: { VideoCodec: 'hevc', AudioCodec: 'aac', Height: 1080, Width: 1920, Bitrate: 8_200_000, HardwareAccelerationType: 'nvenc', TranscodeReasons: ['AudioCodecNotSupported'] },
    },
    { Id: 'sess2', UserName: 'Cade', Client: 'ReelForge', DeviceName: 'Browser', RemoteEndPoint: '10.0.0.23', NowPlayingItem: movies[3], PlayState: { PositionTicks: 59 * 60 * T, IsPaused: true, PlayMethod: 'DirectPlay' } },
    { Id: 'sess3', UserName: 'Kids', Client: 'ReelForge', DeviceName: 'iPad' },
  ];
}

type DemoScan = { id: string; kind: string; key: string; started: number; cancelled: boolean; cancelledAt?: number };
const demoScans = new Map<string, DemoScan>();
const demoScansById = new Map<string, DemoScan>();
function scanStatus(sc: DemoScan, withResult = false) {
  const steps = sc.kind === 'duplicates' ? ['Listing your library', 'Reading files', 'Comparing titles'] : ['Listing your library', 'Reading files', 'Estimating savings', 'Checking the graphics card'];
  const t = (Date.now() - sc.started) / 1000;
  const total = 2847;
  if (sc.cancelled) return { Id: sc.id, Kind: sc.kind, State: 'Cancelled', Phase: 'Reading files', Done: 0, Total: 0, StartedUtc: new Date(sc.started).toISOString(), FinishedUtc: new Date().toISOString() };
  let phase = steps[0], done = 0, tot = 0;
  if (t > 0.8 && t <= 5) { phase = 'Reading files'; tot = total; done = Math.min(total, Math.round(((t - 0.8) / 4.2) * total)); }
  if (t > 5) { phase = steps[2]; tot = sc.kind === 'duplicates' ? 0 : total; done = Math.min(total, Math.round(((t - 5) / 1.2) * total)); }
  if (sc.kind !== 'duplicates' && t > 6.2) { phase = steps[3]; tot = 0; }
  const finished = t > 6.6;
  return {
    Id: sc.id, Kind: sc.kind, State: finished ? 'Done' : 'Running', Phase: phase, Done: done, Total: tot, StartedUtc: new Date(sc.started).toISOString(),
    FinishedUtc: finished ? new Date(sc.started + 6600).toISOString() : null,
    Result: finished && withResult ? (sc.kind === 'duplicates' ? dupGroups : space) : null,
  };
}

async function handle(method: string, path: string, body: unknown): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 120));
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs);
  const all = [...movies, ...shows];

  // first-run setup (demo: add &setup to the URL)
  if (p === '/System/Info/Public') return { ServerName: 'ReelForge', Version: '12.2.0', StartupWizardCompleted: true };
  if (p === '/Startup/Configuration' && method === 'GET') return { ServerName: '', UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' };
  if (p === '/Startup/User' && method === 'GET') return { Name: 'root' };
  if (p.startsWith('/Startup/')) return undefined;
  if (p === '/Environment/Drives') return [{ Name: 'C:\\', Path: 'C:\\', Type: 'Directory' }, { Name: 'D:\\', Path: 'D:\\', Type: 'Directory' }];
  if (p === '/Environment/DirectoryContents') return ['Movies', 'TV', 'Videos', 'Music'].map((n) => ({ Name: n, Path: `${q.get('path')}${n}`, Type: 'Directory' }));
  if (p === '/Environment/ParentPath') return null;
  if (p === '/Environment/ValidatePath') return undefined;
  if ((p === '/Library/VirtualFolders' && method !== 'GET') || p === '/Library/Refresh') return undefined;
  if (p === '/ReelForge/Network/Locations') return { Shares: [], Mapped: [{ Letter: 'Z:', Path: '\\\\10.0.0.201\\plexdata', Reachable: false }] };
  if (p === '/ReelForge/Network/Connect') return { Path: '\\\\10.0.0.201\\plexdata' };
  if (p === '/ReelForge/Network/Shares') return { Shares: ['backups', 'photos', 'plexdata'] };
  if (p === '/Persons') {
    const t = (q.get('searchTerm') ?? '').toLowerCase();
    return { Items: people.filter((x) => x.Name.toLowerCase().includes(t)).map((x, i) => ({ Id: `p${i}`, Name: x.Name, Type: 'Person' })) };
  }
  if (p === '/Users/Public') return profiles;
  if (p === '/UserViews') return { Items: views };
  if (p === '/Genres') {
    const pool = q.get('parentId') === 'lib-shows' ? shows : q.get('parentId') === 'lib-movies' ? movies : all;
    return { Items: [...new Set(pool.flatMap((x) => x.Genres ?? []))].sort().map((g) => ({ Id: `g-${g}`, Name: g })) };
  }
  if (p.startsWith('/UserFavoriteItems/')) {
    const id = p.split('/')[2];
    if (method === 'DELETE') favorites.delete(id);
    else favorites.add(id);
    return {};
  }
  if (p.startsWith('/UserPlayedItems/')) {
    const id = p.split('/')[2];
    if (method === 'DELETE') played.delete(id);
    else played.add(id);
    return {};
  }
  if (p.startsWith('/Items/') && p.endsWith('/Similar')) {
    const id = p.split('/')[2];
    const me = all.find((x) => x.Id === id);
    return { Items: all.filter((x) => x.Id !== id && x.Type === (me?.Type ?? 'Movie')).concat(me?.Type === 'Series' ? movies.slice(0, 6) : []).slice(0, 12).map(withUser) };
  }
  if (p === '/UserItems/Resume') return { Items: movies.filter((m) => (m.UserData?.PlayedPercentage ?? 0) > 0) };
  if (p === '/Shows/NextUp') return { Items: shows.map((s) => episodes(s.Id, 1)[3]) };
  if (p === '/Items/Latest') return q.get('parentId') === 'lib-shows' ? shows : movies.slice().reverse();
  if (p === '/Items') {
    const types = q.get('includeItemTypes');
    let list = q.get('parentId') === 'lib-shows' || types === 'Series' ? shows : movies;
    const term = q.get('searchTerm')?.toLowerCase();
    if (term) list = all.filter((x) => x.Name.toLowerCase().includes(term));
    if (types?.includes('Movie') && types.includes('Series') && !q.get('parentId')) list = all;
    if (q.get('genres')) list = list.filter((x) => x.Genres?.includes(q.get('genres')!));
    if (q.get('filters') === 'IsFavorite') list = all.filter((x) => favorites.has(x.Id));
    if (q.get('personIds')) list = movies.slice(0, 5);
    if (q.get('sortBy') === 'CommunityRating,SortName') list = list.slice().sort((a, b) => (b.CommunityRating ?? 0) - (a.CommunityRating ?? 0));
    if (q.get('sortBy') === 'SortName') list = list.slice().sort((a, b) => a.Name.localeCompare(b.Name));
    if (q.get('sortBy') === 'DateCreated,SortName') list = list.slice().reverse();
    if (q.get('sortBy') === 'ProductionYear,SortName') list = list.slice().sort((a, b) => (b.ProductionYear ?? 0) - (a.ProductionYear ?? 0));
    const from = Number(q.get('startIndex') ?? 0);
    const lim = Number(q.get('limit') ?? list.length);
    return { Items: list.slice(from, from + lim).map(withUser), TotalRecordCount: list.length };
  }
  if (p.startsWith('/Shows/') && p.endsWith('/Seasons')) {
    const id = p.split('/')[2];
    const s = shows.find((x) => x.Id === id)!;
    return { Items: Array.from({ length: s.ChildCount ?? 1 }, (_, i) => ({ Id: `${id}-season-${i + 1}`, Name: `Season ${i + 1}`, Type: 'Season', IndexNumber: i + 1, SeriesId: id, _hue: s._hue })) };
  }
  if (p.startsWith('/Shows/') && p.endsWith('/Episodes')) {
    const id = p.split('/')[2];
    return { Items: episodes(id, Number(q.get('seasonId')?.split('-').pop() ?? 1)).map(withUser) };
  }
  // Edit info / fix match
  if (p.startsWith('/Items/RemoteSearch/Apply/')) {
    const it = all.find((x) => x.Id === p.split('/')[4]);
    if (it) Object.assign(it, { Name: (body as { Name: string }).Name, ProductionYear: (body as { ProductionYear?: number }).ProductionYear });
    return undefined;
  }
  if (p.startsWith('/Items/RemoteSearch/')) {
    const n = ((body as { SearchInfo: { Name: string } }).SearchInfo.Name || 'Title').trim();
    return [0, 1, 2, 3].map((i) => ({
      Name: i === 0 ? n : i === 1 ? `${n}: Director’s Cut` : i === 2 ? `The ${n}` : `${n} II`,
      ProductionYear: [2016, 2016, 1998, 2021][i], SearchProviderName: 'TheMovieDb',
      ProviderIds: { Tmdb: String(1000 + i * 37), ...(i < 2 ? { Imdb: `tt0${4410000 + i}` } : {}) },
      Overview: ['An architect suspects the house she designed is watching her family.', 'The extended cut with twelve minutes of new footage.', 'A different film entirely, made decades earlier.', 'The sequel nobody asked for.'][i],
    }));
  }
  if (p.startsWith('/Items/') && method === 'POST' && p.split('/').length === 3) {
    const it = all.find((x) => x.Id === p.split('/')[2]);
    if (it) Object.assign(it, { Name: (body as Item).Name, Overview: (body as Item).Overview, ProductionYear: (body as Item).ProductionYear ?? undefined, LockedFields: (body as Item).LockedFields });
    return undefined;
  }
  // Artwork editor
  if (p.startsWith('/Items/') && p.endsWith('/Images') && method === 'GET') return [{ ImageType: 'Primary', ImageTag: 'x', Width: 1000, Height: 1500 }];
  if (p.startsWith('/Items/') && p.endsWith('/RemoteImages')) {
    const type = q.get('type') ?? 'Thumb';
    const wide = type !== 'Primary';
    return { Images: Array.from({ length: type === 'Logo' ? 4 : 9 }, (_, i) => demoArt(i, wide, type)), TotalRecordCount: 9, Providers: ['TheMovieDb'] };
  }
  if (p.includes('/RemoteImages/Download') || p.includes('/Images/') || p.endsWith('/Refresh')) return undefined;
  if (p.startsWith('/Items/') && p.endsWith('/PlaybackInfo')) return { MediaSources: [demoSource(p.split('/')[2])], PlaySessionId: 'demo' };
  if (p.startsWith('/Items/')) {
    const id = p.split('/')[2];
    const found = all.find((x) => x.Id === id);
    if (found) return { ...withUser(found), ProviderIds: { Tmdb: '1000', Imdb: 'tt04410000' }, People: people, MediaStreams: [{ Type: 'Video', Height: found.Id === 'm3' ? 2160 : 1080 }] };
    const [sid, sn, en] = id.split('-');
    return withUser(episodes(sid, Number(sn))[Number(en) - 1]);
  }
  // Server settings
  if (p === '/Sessions' && method === 'GET') return q.has('deviceId') ? [] : demoSessions();
  if (p.startsWith('/Sessions')) return undefined;
  if (p === '/System/Info') return { ServerName: 'MEDIA-PC', Version: '12.2.0', LocalAddress: 'http://10.0.0.50:8096', HasPendingRestart: false, CanSelfRestart: true };
  if (p === '/System/Configuration') { if (method === 'POST') serverConfig = body as Record<string, unknown>; return serverConfig; }
  if (p === '/System/Configuration/encoding') { if (method === 'POST') encoding = body as Record<string, unknown>; return encoding; }
  if (p === '/System/Configuration/network') { if (method === 'POST') network = body as Record<string, unknown>; return network; }
  if (p === '/System/Restart') return undefined;
  if (p === '/Localization/Countries') return [['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['AU', 'Australia']].map(([c, n]) => ({ Name: c, DisplayName: n, TwoLetterISORegionName: c }));
  if (p === '/Localization/Cultures') return [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']].map(([c, n]) => ({ DisplayName: n, TwoLetterISOLanguageName: c }));
  if (p === '/Localization/ParentalRatings') return [['G', 0], ['TV-Y', 0], ['TV-G', 0], ['TV-Y7', 7], ['PG', 10], ['TV-PG', 10], ['PG-13', 13], ['TV-14', 14], ['R', 17], ['TV-MA', 17], ['NC-17', 18]].map(([n, v]) => ({ Name: n, Value: v, RatingScore: { score: v } }));
  if (p === '/Plugins') return [{ Name: 'ReelForge', Version: '0.3.0.0', Id: 'rf', Status: 'Active' }];
  if (p === '/Library/VirtualFolders') return [
    { Name: 'Movies', ItemId: 'lib-movies', CollectionType: 'movies', Locations: ['\\\\10.0.0.201\\plexdata\\Movies', '\\\\10.0.0.201\\plexdata\\Movies 4K'] },
    { Name: 'TV Shows', ItemId: 'lib-shows', CollectionType: 'tvshows', Locations: ['\\\\10.0.0.201\\plexdata\\TV'] },
  ];
  if (p === '/Users' && method === 'GET') return users;
  if (p === '/Users/New') { const u = { Id: `u${users.length + 1}`, Name: (body as { Name: string }).Name, HasPassword: !!(body as { Password: string }).Password, Policy: { ...users[1].Policy, IsAdministrator: false } }; users.push(u); return u; }
  if (p.startsWith('/Users/') && p.endsWith('/Policy')) { const u = users.find((x) => x.Id === p.split('/')[2]); if (u) u.Policy = body as typeof u.Policy; return undefined; }
  if (p.startsWith('/Users/') && method === 'DELETE') { users = users.filter((x) => x.Id !== p.split('/')[2]); return undefined; }
  if (p.startsWith('/Users/')) return undefined;
  if (p.startsWith('/UserImage')) return undefined;
  if (p === '/ScheduledTasks') return tasks;
  if (p.startsWith('/ScheduledTasks/Running/')) return undefined;
  if (p === '/System/ActivityLog/Entries') return { Items: activity };
  if (p.startsWith('/Videos/ActiveEncodings')) return undefined;

  // Media Manager
  if (p === '/ReelForge/Overview')
    return {
      Libraries: [{ Id: 'lib-movies', Name: 'Movies', CollectionType: 'movies', Locations: ['D:\\Movies'] }, { Id: 'lib-shows', Name: 'TV Shows', CollectionType: 'tvshows', Locations: ['T:\\TV'] }],
      Encoder: space.Encoder,
      Jellyfin: { HardwareAcceleration: gpuStreaming ? 'nvenc' : 'none', EnableHardwareEncoding: gpuStreaming, AllowHevcEncoding: gpuStreaming },
      Queue: { Paused: paused, Waiting: paused ? 'Paused' : null, Queued: jobs.filter((j) => j.Status === 'Queued').length, Running: jobs.filter((j) => j.Status === 'Running').length, SavedBytes: 9.7 * GB },
      Holding: { Count: held.length, Bytes: held.reduce((a, h) => a + h.SizeBytes, 0), Days: settings.HoldingDays },
    };
  // Background scans: pretend each takes ~6 s, moving through the same steps as the server.
  if (p === '/ReelForge/Scans' && method === 'POST') {
    const kind = q.get('kind') ?? 'duplicates';
    const key = `${kind}|${q.get('mediaKind') ?? ''}`;
    const prev = demoScans.get(key);
    if (prev && q.get('fresh') !== 'true') return scanStatus(prev);
    const scan = { id: `scan-${Date.now()}`, kind, key, started: Date.now(), cancelled: false };
    demoScans.set(key, scan);
    demoScansById.set(scan.id, scan);
    return scanStatus(scan);
  }
  if (p.startsWith('/ReelForge/Scans/') && p.endsWith('/Cancel')) {
    const sc = demoScansById.get(p.split('/')[3]);
    if (sc) sc.cancelled = true;
    return undefined;
  }
  if (p.startsWith('/ReelForge/Scans/')) {
    const sc = demoScansById.get(p.split('/')[3]);
    return sc ? scanStatus(sc, true) : undefined;
  }
  if (p === '/ReelForge/Duplicates') return dupGroups;
  if (p === '/ReelForge/Duplicates/Remove') {
    const ids = new Set((body as { Files: { MediaSourceId: string }[] }).Files.map((f) => f.MediaSourceId));
    for (const g of dupGroups) {
      for (const f of g.Files.filter((x) => ids.has(x.MediaSourceId))) {
        held.unshift({ Id: f.MediaSourceId, Title: f.Title, OriginalPath: f.Path, HeldPath: '', SizeBytes: f.SizeBytes, Reason: 'Duplicate', HeldAtUtc: new Date().toISOString() });
      }
      g.Files = g.Files.filter((x) => !ids.has(x.MediaSourceId));
    }
    dupGroups = dupGroups.filter((g) => g.Files.length > 1);
    return { Removed: ids.size, Errors: [], HoldingDays: settings.HoldingDays };
  }
  if (p === '/ReelForge/SpaceSaver') {
    const kind = q.get('kind');
    if (!kind) return space;
    const c = space.Candidates.filter((x) => x.Kind === kind);
    return { ...space, Candidates: c, TotalSavingsBytes: c.reduce((a, x) => a + x.SavingsBytes, 0), TotalCandidateBytes: c.reduce((a, x) => a + x.SizeBytes, 0) };
  }
  if (p === '/ReelForge/SpaceSaver/Queue') {
    const files = (body as { Files: { MediaSourceId: string }[] }).Files;
    const added = files.map((f, i) => {
      const c = space.Candidates.find((x) => x.MediaSourceId === f.MediaSourceId)!;
      return { Id: `n${Date.now()}${i}`, ItemId: c.ItemId, MediaSourceId: c.MediaSourceId, Title: c.Title, Path: c.Path, OriginalBytes: c.SizeBytes, EstimatedBytes: c.EstimatedBytes, Status: 'Queued' as const, Progress: 0, Speed: 0 };
    });
    jobs = jobs.concat(added);
    return added;
  }
  if (p === '/ReelForge/Jobs') return { Paused: paused, Waiting: paused ? 'Paused' : null, Jobs: jobs };
  if (p === '/ReelForge/Jobs/Pause') { paused = q.get('paused') === 'true'; return undefined; }
  if (p === '/ReelForge/Jobs/ClearFinished') { jobs = jobs.filter((j) => !['Done', 'Failed', 'Cancelled'].includes(j.Status)); return {}; }
  if (p.startsWith('/ReelForge/Jobs/') && p.endsWith('/Cancel')) {
    const j = jobs.find((x) => x.Id === p.split('/')[3]);
    if (j) { j.Status = 'Cancelled'; j.Message = 'Cancelled'; }
    return undefined;
  }
  if (p === '/ReelForge/Savings') {
    const rows = [
      { FinishedUtc: new Date(Date.now() - 3.6e6).toISOString(), ItemId: 'm5', Title: 'Saltwater Kings (2022)', Path: 'D:\\Movies\\Saltwater Kings (2022).mkv', OriginalBytes: 14.9 * GB, NewBytes: 5.2 * GB, Encoder: 'hevc_nvenc', SavedBytes: 9.7 * GB, RunningTotalBytes: 31.4 * GB },
      { FinishedUtc: new Date(Date.now() - 86.4e6).toISOString(), ItemId: 'm2', Title: 'Northbound Freight (2019)', Path: 'D:\\Movies\\Northbound Freight (2019).mkv', OriginalBytes: 22.1 * GB, NewBytes: 7.6 * GB, Encoder: 'hevc_nvenc', SavedBytes: 14.5 * GB, RunningTotalBytes: 21.7 * GB },
      { FinishedUtc: new Date(Date.now() - 3 * 86.4e6).toISOString(), ItemId: 'm9', Title: 'Glasshouse (2016)', Path: 'D:\\Movies\\Glasshouse (2016).mkv', OriginalBytes: 11.0 * GB, NewBytes: 3.8 * GB, Encoder: 'hevc_nvenc', SavedBytes: 7.2 * GB, RunningTotalBytes: 7.2 * GB },
    ];
    return { TotalSavedBytes: 31.4 * GB, Conversions: 3, OriginalBytes: 48 * GB, NewBytes: 16.6 * GB, Since: rows[2].FinishedUtc, StillHeldBytes: 9.7 * GB, Rows: rows };
  }
  if (p === '/ReelForge/Agents' && method === 'GET') {
    return {
      PairingKey: 'K7PD-2WQX-HN4M', ServerVersion: '0.9.0', ConvertOnServer: true,
      Agents: [
        { Id: 'a1', Name: 'GAMING-PC', Enabled: true, AllowCpu: false, MaxJobs: 2, Online: true, LastSeenUtc: new Date().toISOString(), PairedUtc: new Date(Date.now() - 864e5).toISOString(), Version: '0.9.0', Os: 'Windows 11', Address: '192.168.1.42', Gpus: ['NVIDIA GeForce RTX 3080'], Encoders: ['hevc_nvenc', 'av1_nvenc'], TenBitHevc: ['hevc_nvenc'], FilesConverted: 37, BytesSaved: 412 * GB, Jobs: [{ Id: 'j9', Title: 'Signal Hill (2024)', Progress: 0.42, Speed: 6.3, Encoder: 'hevc_nvenc', Status: 'Running', Phase: 'converting' }, { Id: 'j10', Title: 'Deep Field (2021)', Progress: 0.36, Speed: 0, Encoder: 'hevc_nvenc', Status: 'Running', Phase: 'uploading', BytesPerSecond: 94e6, EtaSeconds: 40 }] },
        { Id: 'a2', Name: 'OFFICE-PC', Enabled: true, AllowCpu: false, MaxJobs: 1, Online: false, LastSeenUtc: new Date(Date.now() - 7.2e6).toISOString(), PairedUtc: new Date(Date.now() - 864e5).toISOString(), Version: '0.9.0', Os: 'Windows 10', Address: '192.168.1.57', Gpus: ['AMD Radeon RX 6700 XT'], Encoders: ['hevc_amf'], TenBitHevc: ['hevc_amf'], FilesConverted: 9, BytesSaved: 88 * GB, Jobs: [] },
      ],
    };
  }
  if (p.startsWith('/ReelForge/Agents')) return undefined;
  if (p === '/ReelForge/Ratings/Settings') return method === 'GET' ? { HasKey: true, KeyHint: '••••a1b2' } : undefined;
  if (p === '/ReelForge/LibraryScan') return method === 'GET' ? { Minutes: 5, Running: false } : undefined;
  if (p === '/ReelForge/Holding') return held;
  if (p === '/ReelForge/Holding/EmptyAll') { const b = held.reduce((a, h) => a + h.SizeBytes, 0); held = []; return { FreedBytes: b }; }
  if (p.startsWith('/ReelForge/Holding/')) { held = held.filter((h) => h.Id !== p.split('/')[3]); return undefined; }
  if (p === '/ReelForge/Settings') { if (method === 'POST') settings = body as Settings; return settings; }
  if (p === '/ReelForge/Gpu/EnableStreamingAcceleration') { gpuStreaming = true; return {}; }
  if (p === '/ReelForge/Gpu/Refresh') return space.Encoder;
  throw new Error(`demo: no handler for ${method} ${path}`);
}

export const demo = { session, handle };
