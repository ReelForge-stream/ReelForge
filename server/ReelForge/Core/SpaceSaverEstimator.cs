namespace ReelForge.Core;

public enum TargetCodec
{
    Hevc,
    Av1
}

public enum QualityPreset
{
    /// <summary>Smallest files; fine for TV shows and casual viewing.</summary>
    MaxSavings,

    /// <summary>Visually transparent for most content at typical viewing distance.</summary>
    Balanced,

    /// <summary>Keeps more grain and detail; smaller savings.</summary>
    HighQuality
}

public sealed record ConversionSettings
{
    public TargetCodec Codec { get; init; } = TargetCodec.Hevc;

    public QualityPreset Preset { get; init; } = QualityPreset.Balanced;

    /// <summary>Gets a value indicating whether HDR10/HLG sources may be converted (10-bit, colour tags preserved).</summary>
    public bool IncludeHdr { get; init; }

    /// <summary>Gets the minimum saving, as a fraction of the original size, worth converting for.</summary>
    public double MinSavingsFraction { get; init; } = 0.15;

    /// <summary>Gets the minimum absolute saving worth converting for.</summary>
    public long MinSavingsBytes { get; init; } = 150L * 1024 * 1024;
}

public sealed record SpaceSaverEstimate
{
    public required MediaFile File { get; init; }

    public required bool IsCandidate { get; init; }

    /// <summary>Gets why a file was skipped, or a short note for candidates.</summary>
    public required string Reason { get; init; }

    public long EstimatedSizeBytes { get; init; }

    public long SavingsBytes => IsCandidate ? Math.Max(0, File.SizeBytes - EstimatedSizeBytes) : 0;

    public double SavingsFraction => File.SizeBytes > 0 ? (double)SavingsBytes / File.SizeBytes : 0;

    /// <summary>Gets the video bitrate (bits/s) the encoder is capped to.</summary>
    public long TargetVideoBitrate { get; init; }
}

/// <summary>
/// Predicts how much space re-encoding each file would free, and filters out files where
/// conversion would risk quality or data (Dolby Vision, disc images) or isn't worth it.
/// Estimates assume the encoder lands 25% above its average target (busy, grainy footage
/// runs toward the bitrate cap), so most real results come in at or below the estimate.
/// </summary>
public static class SpaceSaverEstimator
{
    public static SpaceSaverEstimate Estimate(MediaFile f, ConversionSettings s)
    {
        SpaceSaverEstimate Skip(string reason) => new() { File = f, IsCandidate = false, Reason = reason };

        if (!f.IsPlainFile)
        {
            return Skip("Disc image or multi-part file");
        }

        if (f.SizeBytes <= 0 || f.DurationTicks <= 0)
        {
            return Skip("Size or length unknown — rescan the library");
        }

        if (f.Duration < TimeSpan.FromMinutes(3))
        {
            return Skip("Too short to bother");
        }

        if (string.IsNullOrEmpty(f.VideoCodec) || f.Width <= 0)
        {
            return Skip("No readable video stream");
        }

        if (f.Range == DynamicRange.DolbyVision)
        {
            return Skip("Dolby Vision — converting would strip the DV layer");
        }

        if (f.Range == DynamicRange.Hdr10Plus)
        {
            return Skip("HDR10+ — dynamic metadata can't be carried over");
        }

        bool hdr = f.Range is DynamicRange.Hdr10 or DynamicRange.Hlg;
        if (hdr && !s.IncludeHdr)
        {
            return Skip("HDR — turn on \"Include HDR\" to convert");
        }

        string src = f.VideoCodec.ToLowerInvariant();
        long currentVideo = f.EffectiveVideoBitrate;
        if (currentVideo <= 0)
        {
            return Skip("Bitrate unknown — rescan the library");
        }

        long target = TargetBitrate(f, s);
        bool sameFamily = (s.Codec == TargetCodec.Hevc && src is "hevc" or "h265")
                          || (s.Codec == TargetCodec.Av1 && src == "av1");
        if (s.Codec == TargetCodec.Hevc && src == "av1")
        {
            return Skip("Already AV1 (more efficient than HEVC)");
        }

        if (sameFamily && currentVideo <= target * 1.3)
        {
            return Skip("Already efficiently encoded");
        }

        double ratio = SizeRatio(src, s.Codec);
        long newVideo = Math.Min((long)(target * 1.25), (long)(currentVideo * ratio));
        long audio = EstimateAudioBitrate(f);
        double seconds = f.Duration.TotalSeconds;
        long estimated = (long)((newVideo + audio) * seconds / 8 * 1.01);

        long savings = f.SizeBytes - estimated;
        if (savings < s.MinSavingsBytes || savings < f.SizeBytes * s.MinSavingsFraction)
        {
            return new SpaceSaverEstimate
            {
                File = f,
                IsCandidate = false,
                Reason = "Saving would be too small",
                EstimatedSizeBytes = estimated,
                TargetVideoBitrate = target,
            };
        }

        string note = hdr ? "HDR kept (10-bit)" : f.IsInterlaced ? "Will be deinterlaced" : $"{QualityScorer.Describe(f)} → {(s.Codec == TargetCodec.Av1 ? "AV1" : "HEVC")}";
        return new SpaceSaverEstimate
        {
            File = f,
            IsCandidate = true,
            Reason = note,
            EstimatedSizeBytes = estimated,
            TargetVideoBitrate = target,
        };
    }

    /// <summary>Encoder bitrate ceiling for the file's resolution, frame rate, range and preset.</summary>
    public static long TargetBitrate(MediaFile f, ConversionSettings s)
    {
        int tier = QualityScorer.ResolutionTier(f.Width, f.Height);
        double mbps = tier switch
        {
            2160 => 14,
            1080 => 4.5,
            720 => 2.2,
            480 => 1.1,
            _ => 0.7,
        };

        if (f.Range is DynamicRange.Hdr10 or DynamicRange.Hlg)
        {
            mbps *= 1.15;
        }

        if (f.FrameRate > 31)
        {
            mbps *= 1.35;
        }

        mbps *= s.Preset switch
        {
            QualityPreset.MaxSavings => 0.7,
            QualityPreset.HighQuality => 1.4,
            _ => 1.0,
        };

        if (s.Codec == TargetCodec.Av1)
        {
            mbps *= 0.8;
        }

        return (long)(mbps * 1_000_000);
    }

    /// <summary>Typical output/input size ratio when re-encoding from one codec to another at similar quality.</summary>
    internal static double SizeRatio(string sourceCodec, TargetCodec target)
    {
        double toHevc = sourceCodec switch
        {
            "h264" or "avc" => 0.6,
            "mpeg2video" or "mpeg2" => 0.35,
            "mpeg4" or "msmpeg4v3" or "xvid" or "divx" => 0.55,
            "vc1" or "wmv3" => 0.5,
            "vp9" => 0.95,
            "hevc" or "h265" => 0.9,
            "av1" => 1.2,
            _ => 0.7,
        };

        return target == TargetCodec.Av1 ? toHevc * 0.8 : toHevc;
    }

    internal static long EstimateAudioBitrate(MediaFile f)
    {
        long known = f.AudioTracks.Sum(a => a.Bitrate);
        if (f.AudioTracks.All(a => a.Bitrate > 0))
        {
            return known;
        }

        if (f.TotalBitrate > 0 && f.VideoBitrate > 0 && f.TotalBitrate > f.VideoBitrate)
        {
            return f.TotalBitrate - f.VideoBitrate;
        }

        return f.AudioTracks.Sum(a => a.Bitrate > 0 ? a.Bitrate : a.Codec.ToLowerInvariant() switch
        {
            "truehd" or "mlp" => 3_500_000,
            "dts" when a.IsLossless => 3_000_000,
            "dts" => 1_509_000,
            "flac" or "alac" => 1_500_000,
            var c when c.StartsWith("pcm", StringComparison.Ordinal) => 2_304_000,
            "eac3" => 768_000,
            "ac3" => 640_000,
            "opus" => 160_000,
            _ => 192_000,
        });
    }
}
