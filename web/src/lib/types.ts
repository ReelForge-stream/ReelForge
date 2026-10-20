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
  People?: { Name: string; Role?: string; Type: string }[];
  /** Demo mode only: a colour seed for generated artwork. */
  _hue?: number;
}

export interface User {
  Id: string;
  Name: string;
  Policy?: { IsAdministrator?: boolean };
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
