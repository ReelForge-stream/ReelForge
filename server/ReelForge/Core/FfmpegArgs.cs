using System.Globalization;

namespace ReelForge.Core;

/// <summary>Which encoder the machine can actually run, decided by a live test encode at startup.</summary>
public sealed record EncoderChoice(string VideoEncoder, bool UseCudaDecode)
{
    public bool IsNvenc => VideoEncoder.EndsWith("_nvenc", StringComparison.Ordinal);
}

/// <summary>
/// Builds the ffmpeg argument list for one conversion. Video is re-encoded; every audio track,
/// internal subtitle, chapter, attachment (fonts) and title tag is carried over untouched.
/// Output is always Matroska so any subtitle/audio format survives.
/// </summary>
public static class FfmpegArgs
{
    private static readonly string[] StaleStatTags =
    [
        "BPS", "BPS-eng", "NUMBER_OF_BYTES", "NUMBER_OF_BYTES-eng", "NUMBER_OF_FRAMES", "NUMBER_OF_FRAMES-eng",
        "DURATION-eng", "_STATISTICS_TAGS", "_STATISTICS_TAGS-eng", "_STATISTICS_WRITING_APP",
        "_STATISTICS_WRITING_APP-eng", "_STATISTICS_WRITING_DATE_UTC", "_STATISTICS_WRITING_DATE_UTC-eng",
    ];

    public static IReadOnlyList<string> Build(MediaFile f, ConversionSettings s, EncoderChoice enc, long targetVideoBitrate, string outputPath)
    {
        var a = new List<string> { "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1" };

        string container = f.Container.ToLowerInvariant();
        if (container is "avi" or "mpegts" or "ts" or "vob" or "mpeg" or "m2ts")
        {
            a.AddRange(["-fflags", "+genpts"]);
        }

        if (enc.UseCudaDecode)
        {
            // Decode on the GPU, hand frames back to system memory so CPU filters (deinterlace) still work.
            // If the GPU can't decode this codec ffmpeg silently falls back to software decoding.
            a.AddRange(["-hwaccel", "cuda"]);
        }

        a.AddRange(["-probesize", "100M", "-analyzeduration", "100M", "-i", f.Path]);

        a.AddRange(["-map", f.VideoStreamIndex >= 0 ? $"0:{f.VideoStreamIndex}" : "0:v:0"]);
        a.AddRange(["-map", "0:a?", "-map", "0:s?"]);
        if (container is "mkv" or "matroska" or "webm")
        {
            a.AddRange(["-map", "0:t?"]); // embedded fonts for styled subtitles
        }

        a.AddRange(["-map_metadata", "0", "-map_chapters", "0"]);

        // Video
        bool tenBit = f.BitDepth >= 10 || f.Range is DynamicRange.Hdr10 or DynamicRange.Hlg;
        if (f.IsInterlaced)
        {
            a.AddRange(["-vf", "bwdif=mode=send_frame:deint=interlaced"]);
        }

        a.AddRange(VideoEncoderArgs(enc.VideoEncoder, s, tenBit, targetVideoBitrate));

        if (f.Range is DynamicRange.Hdr10 or DynamicRange.Hlg)
        {
            a.AddRange(["-color_primaries", f.ColorPrimaries ?? "bt2020"]);
            a.AddRange(["-color_trc", f.ColorTransfer ?? (f.Range == DynamicRange.Hlg ? "arib-std-b67" : "smpte2084")]);
            a.AddRange(["-colorspace", f.ColorSpace ?? "bt2020nc"]);
        }

        // Audio + subtitles: untouched. MP4 text subs (mov_text) can't live in Matroska, so they become SRT.
        a.AddRange(["-c:a", "copy", "-c:s", "copy", "-c:t", "copy"]);
        var internalSubs = f.SubtitleTracks.Where(t => !t.IsExternal).ToList();
        for (int i = 0; i < internalSubs.Count; i++)
        {
            if (internalSubs[i].Codec.Equals("mov_text", StringComparison.OrdinalIgnoreCase))
            {
                a.AddRange([$"-c:s:{i}", "srt"]);
            }
        }

        // The source's mkvmerge statistics tags would describe the OLD bitrate; drop them.
        foreach (string tag in StaleStatTags)
        {
            a.AddRange(["-metadata:s:v:0", $"{tag}="]);
        }

        a.AddRange(["-max_muxing_queue_size", "9999", "-f", "matroska", outputPath]);
        return a;
    }

    internal static IEnumerable<string> VideoEncoderArgs(string encoder, ConversionSettings s, bool tenBit, long target)
    {
        string maxrate = Kbps(target * 3 / 2);
        string bufsize = Kbps(target * 3);
        switch (encoder)
        {
            case "hevc_nvenc":
                return
                [
                    "-c:v", "hevc_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "vbr",
                    "-cq", Cq(s, 24, 27, 21), "-b:v", "0", "-maxrate", maxrate, "-bufsize", bufsize,
                    "-spatial-aq", "1", "-aq-strength", "8", "-rc-lookahead", "32",
                    "-profile:v", tenBit ? "main10" : "main", "-pix_fmt", tenBit ? "p010le" : "yuv420p",
                ];
            case "av1_nvenc":
                return
                [
                    "-c:v", "av1_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "vbr",
                    "-cq", Cq(s, 32, 36, 28), "-b:v", "0", "-maxrate", maxrate, "-bufsize", bufsize,
                    "-spatial-aq", "1", "-rc-lookahead", "32",
                    "-pix_fmt", tenBit ? "p010le" : "yuv420p",
                ];
            case "hevc_amf":
                // AMD Radeon (VCN). Peak-constrained VBR at the estimated bitrate; AMF has no CQ mode as good as NVENC's.
                return
                [
                    "-c:v", "hevc_amf", "-usage", "transcoding", "-quality", "quality", "-rc", "vbr_peak",
                    "-b:v", Kbps(target), "-maxrate", maxrate, "-bufsize", bufsize, "-vbaq", "true",
                    "-profile:v", tenBit ? "main10" : "main", "-pix_fmt", tenBit ? "p010le" : "yuv420p",
                ];
            case "av1_amf":
                return
                [
                    "-c:v", "av1_amf", "-usage", "transcoding", "-quality", "quality", "-rc", "vbr_peak",
                    "-b:v", Kbps(target), "-maxrate", maxrate, "-bufsize", bufsize,
                    "-pix_fmt", tenBit ? "p010le" : "yuv420p",
                ];
            case "libsvtav1":
                return
                [
                    "-c:v", "libsvtav1", "-preset", "6", "-crf", Cq(s, 30, 34, 26),
                    "-svtav1-params", $"tune=0:mbr={target * 3 / 2000}",
                    "-pix_fmt", "yuv420p10le",
                ];
            default: // libx265 — CPU fallback when no usable NVIDIA encoder is present
                return
                [
                    "-c:v", "libx265", "-preset", "medium", "-crf", Cq(s, 22, 25, 19),
                    "-x265-params", $"vbv-maxrate={target * 3 / 2000}:vbv-bufsize={target * 3 / 1000}:log-level=error",
                    "-pix_fmt", tenBit ? "yuv420p10le" : "yuv420p",
                ];
        }
    }

    private static string Cq(ConversionSettings s, int balanced, int max, int hq) =>
        (s.Preset switch { QualityPreset.MaxSavings => max, QualityPreset.HighQuality => hq, _ => balanced })
        .ToString(CultureInfo.InvariantCulture);

    private static string Kbps(long bps) => (bps / 1000).ToString(CultureInfo.InvariantCulture) + "k";

    /// <summary>Picks the encoder for the requested codec from what the machine passed a live test for.</summary>
    public static EncoderChoice? Choose(TargetCodec codec, ISet<string> workingEncoders, bool allowCpu = true)
    {
        // Graphics card first (NVIDIA, then AMD), the processor only as a last resort.
        string[] order = codec == TargetCodec.Av1
            ? ["av1_nvenc", "av1_amf", "libsvtav1"]
            : ["hevc_nvenc", "hevc_amf", "libx265"];
        foreach (var enc in order)
        {
            bool cpu = enc.StartsWith("lib", StringComparison.Ordinal);
            if (workingEncoders.Contains(enc) && (allowCpu || !cpu))
            {
                // NVIDIA decodes on the card too; AMD and the processor decode in software.
                return new EncoderChoice(enc, enc.EndsWith("_nvenc", StringComparison.Ordinal));
            }
        }

        return null;
    }
}
