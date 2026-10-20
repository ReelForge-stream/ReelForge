namespace ReelForge.Core;

/// <summary>Kind of library entry a file belongs to.</summary>
public enum MediaKind
{
    Movie,
    Episode
}

/// <summary>Dynamic range of the primary video stream.</summary>
public enum DynamicRange
{
    Sdr,
    Hdr10,
    Hlg,
    Hdr10Plus,
    DolbyVision
}

/// <summary>
/// One physical media file on disk, flattened out of the Jellyfin library into the facts
/// the Media Manager needs. Pure data: no Jellyfin types, so the logic around it is testable.
/// </summary>
public sealed record MediaFile
{
    /// <summary>Gets the Jellyfin item id of the title (movie or episode) this file belongs to.</summary>
    public required Guid ItemId { get; init; }

    /// <summary>Gets the Jellyfin media source id ("version") for this exact file.</summary>
    public required string MediaSourceId { get; init; }

    public required MediaKind Kind { get; init; }

    /// <summary>Gets the display title, e.g. "Inception (2010)" or "Severance S02E03".</summary>
    public required string Title { get; init; }

    /// <summary>Gets the Jellyfin id of the series (episodes only).</summary>
    public Guid? SeriesId { get; init; }

    public string? SeriesName { get; init; }

    public int? SeasonNumber { get; init; }

    public int? EpisodeNumber { get; init; }

    public int? EpisodeNumberEnd { get; init; }

    public int? Year { get; init; }

    /// <summary>Gets provider ids such as Tmdb, Imdb, Tvdb for the title (for episodes: the series).</summary>
    public IReadOnlyDictionary<string, string> ProviderIds { get; init; } = new Dictionary<string, string>();

    public required string Path { get; init; }

    public long SizeBytes { get; init; }

    public string Container { get; init; } = string.Empty;

    public long DurationTicks { get; init; }

    public string VideoCodec { get; init; } = string.Empty;

    /// <summary>Gets the absolute stream index of the main video stream (not cover art), or -1 if unknown.</summary>
    public int VideoStreamIndex { get; init; } = -1;

    public string? VideoProfile { get; init; }

    public int Width { get; init; }

    public int Height { get; init; }

    public int BitDepth { get; init; } = 8;

    public double FrameRate { get; init; }

    public bool IsInterlaced { get; init; }

    public DynamicRange Range { get; init; } = DynamicRange.Sdr;

    public string? ColorPrimaries { get; init; }

    public string? ColorTransfer { get; init; }

    public string? ColorSpace { get; init; }

    /// <summary>Gets the video stream bitrate in bits/s, or 0 when unknown.</summary>
    public long VideoBitrate { get; init; }

    /// <summary>Gets the overall bitrate in bits/s, or 0 when unknown.</summary>
    public long TotalBitrate { get; init; }

    public IReadOnlyList<AudioTrack> AudioTracks { get; init; } = Array.Empty<AudioTrack>();

    public IReadOnlyList<SubtitleTrack> SubtitleTracks { get; init; } = Array.Empty<SubtitleTrack>();

    /// <summary>Gets a value indicating whether this is a plain video file (not an ISO, DVD/BD folder or stacked part).</summary>
    public bool IsPlainFile { get; init; } = true;

    public TimeSpan Duration => TimeSpan.FromTicks(DurationTicks);

    public string FileName => System.IO.Path.GetFileName(Path);

    /// <summary>
    /// Gets the best-known video bitrate. Falls back to total minus audio, then to size/duration.
    /// </summary>
    public long EffectiveVideoBitrate
    {
        get
        {
            if (VideoBitrate > 0)
            {
                return VideoBitrate;
            }

            long audio = AudioTracks.Sum(a => a.Bitrate);
            if (TotalBitrate > 0)
            {
                return Math.Max(0, TotalBitrate - audio);
            }

            if (SizeBytes > 0 && DurationTicks > 0)
            {
                return Math.Max(0, (long)(SizeBytes * 8 / Duration.TotalSeconds) - audio);
            }

            return 0;
        }
    }
}

public sealed record AudioTrack(string Codec, int Channels, long Bitrate, string? Language, string? Profile = null)
{
    private static readonly string[] LosslessCodecs = ["truehd", "flac", "pcm_s16le", "pcm_s24le", "alac", "mlp"];

    public bool IsLossless =>
        LosslessCodecs.Contains(Codec, StringComparer.OrdinalIgnoreCase)
        || (Codec.Equals("dts", StringComparison.OrdinalIgnoreCase)
            && (Profile?.Contains("MA", StringComparison.OrdinalIgnoreCase) ?? false));
}

public sealed record SubtitleTrack(string Codec, string? Language, bool IsForced, bool IsExternal = false);
