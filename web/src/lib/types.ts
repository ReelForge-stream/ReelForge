// Shapes returned by the Jellyfin API (only the fields ReelForge uses) and the Media Manager API.

export interface UserData {
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  Played?: boolean;
  UnplayedItemCount?: number;
  IsFavorite?: boolean;
}

export interface MediaStream {
  Index: number;
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage' | 'Data';
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  IsExternal?: boolean;
  DeliveryMethod?: string;
  DeliveryUrl?: string;
  Height?: number;
  Width?: number;
  BitRate?: number;
  Channels?: number;
  ChannelLayout?: string;
  Title?: string;
  IsForced?: boolean;
  IsTextSubtitleStream?: boolean;
  RealFrameRate?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  Profile?: string;
}

export interface MediaSource {
  Id: string;
  Name?: string;
  Path?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  TranscodingUrl?: string;
  MediaStreams?: MediaStream[];
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
}

export interface Item {
  ProviderIds?: Record<string, string>;
  OriginalTitle?: string;
  LockedFields?: string[];
  SortName?: string;
  ForcedSortName?: string;
  Id: string;
  Name: string;
  Type: string;
  CollectionType?: string;
  ProductionYear?: number;
  Overview?: string;
  OfficialRating?: string;
  CommunityRating?: number;
  RunTimeTicks?: number;
  Genres?: string[];
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ChildCount?: number;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  SeriesPrimaryImageTag?: string;
  UserData?: UserData;
  MediaSources?: MediaSource[];
  MediaStreams?: MediaStream[];
  People?: { Name: string; Role?: string; Type: string }[];
  Studios?: { Name: string }[];
  DateCreated?: string;
  PremiereDate?: string;
  Taglines?: string[];
  ParentLogoItemId?: string;
  ParentLogoImageTag?: string;
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  /** Demo mode only: a colour seed for generated artwork. */
  _hue?: number;
}

export interface User {
  Id: string;
  Name: string;
  Policy?: { IsAdministrator?: boolean; EnableContentDownloading?: boolean };
  HasPassword?: boolean;
  PrimaryImageTag?: string;
}

export interface Session {
  server: string;
  token: string;
  user: User;
}

// ---- Media Manager ----

export interface Library {
  Id: string;
  Name: string;
  CollectionType?: string;
  Locations: string[];
}

export interface EncoderReport {
  GpuName?: string;
  DriverVersion?: string;
  Working: string[];
  HevcNvenc10Bit: boolean;
  Summary: string;
}

export interface Overview {
  Libraries: Library[];
  Encoder: EncoderReport;
  Jellyfin: { HardwareAcceleration: string; EnableHardwareEncoding: boolean; AllowHevcEncoding: boolean };
  Queue: { Paused: boolean; Waiting?: string | null; Queued: number; Running: number; SavedBytes: number };
  Holding: { Count: number; Bytes: number; Days: number };
}

export interface DupFile {
  ItemId: string;
  MediaSourceId: string;
  Title: string;
  Path: string;
  FileName: string;
  SizeBytes: number;
  Summary: string;
  Score: number;
  Keep: boolean;
  Edition?: string | null;
}

export interface DupGroup {
  Key: string;
  Kind: 'Movie' | 'Episode';
  Title: string;
  LooksLikeEditions: boolean;
  ReclaimableBytes: number;
  Files: DupFile[];
}

export interface Estimate {
  ItemId: string;
  MediaSourceId: string;
  Title: string;
  Kind: 'Movie' | 'Episode';
  Path: string;
  Summary: string;
  SizeBytes: number;
  EstimatedBytes: number;
  SavingsBytes: number;
  SavingsFraction: number;
  Note: string;
}

export interface SpaceSaverResult {
  Candidates: Estimate[];
  TotalSavingsBytes: number;
  TotalCandidateBytes: number;
  FilesScanned: number;
  SkippedByReason: Record<string, number>;
  Encoder: EncoderReport;
}

export type JobStatus = 'Queued' | 'Running' | 'Verifying' | 'Done' | 'Failed' | 'Cancelled';

export interface Job {
  Id: string;
  ItemId: string;
  MediaSourceId: string;
  Title: string;
  Path: string;
  OriginalBytes: number;
  EstimatedBytes: number;
  ResultBytes?: number | null;
  Status: JobStatus;
  Progress: number;
  Speed: number;
  EtaSeconds?: number | null;
  Encoder?: string | null;
  Message?: string | null;
  FinishedUtc?: string | null;
  AgentName?: string | null;
}

export interface HeldFile {
  Id: string;
  Title: string;
  OriginalPath: string;
  HeldPath: string;
  SizeBytes: number;
  Reason: string;
  HeldAtUtc: string;
}

export type TargetCodec = 'Hevc' | 'Av1';
export type QualityPreset = 'MaxSavings' | 'Balanced' | 'HighQuality';

export interface Settings {
  TargetCodec: TargetCodec;
  Preset: QualityPreset;
  IncludeHdr: boolean;
  HoldingDays: number;
  PauseWhileStreaming: boolean;
  WindowStartHour: number;
  WindowEndHour: number;
  MaxConcurrentJobs: number;
}

// ---------- server administration ----------

export interface UserPolicy {
  IsAdministrator: boolean;
  IsHidden: boolean;
  IsDisabled: boolean;
  EnableRemoteAccess: boolean;
  EnableAllFolders: boolean;
  EnabledFolders: string[];
  EnableContentDeletion: boolean;
  EnableContentDownloading: boolean;
  EnableVideoPlaybackTranscoding: boolean;
  RemoteClientBitrateLimit: number;
  MaxParentalRating?: number | null;
  MaxParentalSubRating?: number | null;
  BlockUnratedItems?: string[];
  [k: string]: unknown;
}

export interface AdminUser {
  Id: string;
  Name: string;
  HasPassword: boolean;
  PrimaryImageTag?: string;
  LastActivityDate?: string;
  LastLoginDate?: string;
  Policy: UserPolicy;
  Configuration?: Record<string, unknown>;
}

export interface VirtualFolder {
  Name: string;
  ItemId: string;
  CollectionType?: string;
  Locations: string[];
  RefreshStatus?: string;
  RefreshProgress?: number;
  LibraryOptions?: Record<string, unknown>;
}

export interface ScheduledTask {
  Id: string;
  Key: string;
  Name: string;
  Description?: string;
  Category: string;
  State: 'Idle' | 'Running' | 'Cancelling';
  CurrentProgressPercentage?: number;
  IsHidden?: boolean;
  LastExecutionResult?: { StartTimeUtc: string; EndTimeUtc: string; Status: string; ErrorMessage?: string };
}

export interface ActiveSession {
  Id: string;
  UserName?: string;
  UserId?: string;
  Client: string;
  DeviceName: string;
  DeviceId?: string;
  RemoteEndPoint?: string;
  LastActivityDate?: string;
  NowPlayingItem?: Item;
  PlayState?: { PositionTicks?: number; IsPaused?: boolean; PlayMethod?: string };
  TranscodingInfo?: TranscodingInfo;
}

export interface TranscodingInfo {
  VideoCodec?: string;
  AudioCodec?: string;
  Container?: string;
  IsVideoDirect?: boolean;
  IsAudioDirect?: boolean;
  Bitrate?: number;
  Framerate?: number;
  Width?: number;
  Height?: number;
  AudioChannels?: number;
  HardwareAccelerationType?: string;
  CompletionPercentage?: number;
  TranscodeReasons?: string[];
}

export interface ActivityEntry {
  Id: number;
  Name: string;
  ShortOverview?: string;
  Overview?: string;
  Type: string;
  Date: string;
  Severity: string;
}

export interface SystemInfo {
  ServerName: string;
  Version: string;
  LocalAddress?: string;
  HasPendingRestart?: boolean;
  CanSelfRestart?: boolean;
  OperatingSystemDisplayName?: string;
}

// ---------- Downloads ----------

export interface DownloadOption {
  Id: string;
  Label: string;
  MaxWidth: number;
  VideoBitrate: number;
  EstimatedBytes: number;
}

export interface DownloadOptions {
  ItemId: string;
  MediaSourceId: string;
  Title: string;
  FileName: string;
  SizeBytes: number;
  DurationSeconds: number;
  Container: string;
  VideoCodec: string;
  VideoProfile?: string;
  BitDepth: number;
  Width: number;
  Height: number;
  Range: string;
  AudioCodecs: string[];
  AudioTracks: { Index: number; Label: string; Codec: string; Channels: number }[];
  TextSubtitles: number;
  PictureSubtitles: number;
  Options: DownloadOption[];
  UsesGpu: boolean;
}

export interface DownloadJob {
  Id: string;
  ItemId: string;
  Title: string;
  Label: string;
  FileName: string;
  State: 'Waiting' | 'Converting' | 'Ready' | 'Failed';
  Progress: number;
  EtaSeconds?: number;
  EstimatedBytes: number;
  SizeBytes: number;
  Error?: string;
  CreatedUtc: string;
  ExpiresUtc: string;
}

// ---------- Watch history (administrators) ----------

export interface WatchRecord {
  UserId: string;
  UserName: string;
  ItemId: string;
  Title: string;
  ItemType: string;
  SeriesId?: string;
  DeviceName: string;
  Client: string;
  RemoteAddress?: string;
  PlayMethod?: string;
  ConvertedHeight?: number;
  StartedUtc: string;
  EndedUtc?: string;
  WatchedSeconds?: number;
  PositionTicks?: number;
  RunTimeTicks?: number;
  Finished?: boolean;
}

export interface WatchHistoryResult {
  Records: WatchRecord[];
  TrackingSince?: string;
  Users: { Id: string; Name: string }[];
}

export interface SavingsResult {
  TotalSavedBytes: number;
  Conversions: number;
  OriginalBytes: number;
  NewBytes: number;
  Since?: string;
  StillHeldBytes: number;
  Rows: { FinishedUtc: string; ItemId: string; Title: string; Path: string; OriginalBytes: number; NewBytes: number; Encoder?: string; SavedBytes: number; RunningTotalBytes: number }[];
}

export interface AgentInfo {
  Id: string;
  Name: string;
  Enabled: boolean;
  AllowCpu: boolean;
  Online: boolean;
  LastSeenUtc: string;
  PairedUtc: string;
  Version?: string;
  Os?: string;
  Address?: string;
  Gpus: string[];
  Encoders: string[];
  TenBitHevc: string[];
  FilesConverted: number;
  BytesSaved: number;
  LastError?: string;
  Job?: { Id: string; Title: string; Progress: number; Speed: number; EtaSeconds?: number; Encoder?: string; Status: string } | null;
}

export interface AgentsResult {
  PairingKey: string;
  ServerVersion: string;
  ConvertOnServer: boolean;
  Agents: AgentInfo[];
}
