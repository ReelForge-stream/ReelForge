using System.Globalization;

namespace ReelForge.Core;

/// <summary>One "download at this size" choice offered to the viewer.</summary>
public sealed record DownloadOption(string Id, string Label, int MaxWidth, long VideoBitrate, long EstimatedBytes);

/// <summary>
/// Turns one library file into a download that plays almost anywhere: MP4 with H.264 video
/// (8-bit, HDR tone-mapped to normal colour), stereo AAC audio and text subtitles. Pure logic, so it's testable.
/// </summary>
public static class DownloadPlan
{
    public const long AudioBitrate = 192_000;

    // Width caps rather than heights, so wide films (1920x800) still count as 1080p.
    private static readonly (string Id, string Label, int Width, int Height, long Bitrate)[] Rungs =
    [
        ("1080p", "1080p", 1920, 1080, 6_000_000),
        ("720p", "720p", 1280, 720, 3_000_000),
        ("480p", "480p", 854, 480, 1_200_000),
    ];

    /// <summary>Sizes this file can be converted to, largest first, each with an estimated file size.</summary>
    public static IReadOnlyList<DownloadOption> Options(MediaFile f)
    {
        int srcW = f.Width > 0 ? f.Width : 1920;
        int srcH = f.Height > 0 ? f.Height : 1080;
        long cap = BitrateCap(f);
        var list = new List<DownloadOption>();
        foreach (var r in Rungs)
        {
            // Offer a rung when the source is at least about that big (a 1916x1036 rip still counts as 1080p).
            if (srcW < r.Width * 0.9 && srcH < r.Height * 0.9)
            {
                continue;
            }

            long rate = cap > 0 ? Math.Min(r.Bitrate, Math.Max(cap, 600_000)) : r.Bitrate;
            list.Add(new DownloadOption(r.Id, r.Label, r.Width, rate, Estimate(f, rate)));
        }

        if (list.Count == 0)
        {
            // Smaller than 480p (old TV, DVD rips): just one choice, at the original size.
            long rate = cap > 0 ? Math.Min(1_200_000, Math.Max(cap, 600_000)) : 1_200_000;
            list.Add(new DownloadOption("sd", $"{srcH}p", srcW, rate, Estimate(f, rate)));
        }

        return list;
    }

    /// <summary>Converting can't add quality the source doesn't have, so don't spend more bits than it did.</summary>
    private static long BitrateCap(MediaFile f)
    {
        long src = f.EffectiveVideoBitrate;
        if (src <= 0)
        {
            return 0;
        }

        // H.264 needs more bits than the newer codecs for the same picture.
        double factor = f.VideoCodec.ToLowerInvariant() switch
        {
            "hevc" or "h265" or "vp9" => 1.5,
            "av1" => 1.8,
            _ => 1.0,
        };
        return (long)(src * factor);
    }

    public static long Estimate(MediaFile f, long videoBitrate)
    {
        double seconds = f.Duration.TotalSeconds;
        if (seconds <= 0)
        {
            return 0;
        }

        // ~2% for the MP4 container and subtitle tracks.
        return (long)((videoBitrate + AudioBitrate) * seconds / 8 * 1.02);
    }

    /// <summary>ffmpeg arguments for the conversion. <paramref name="audioIndex"/> is the position among audio tracks (0 = first).</summary>
    public static IReadOnlyList<string> Build(MediaFile f, DownloadOption o, int audioIndex, string videoEncoder, bool cudaDecode, bool canToneMap, string outputPath)
    {
        var a = new List<string> { "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1" };
        string container = f.Container.ToLowerInvariant();
        if (container is "avi" or "mpegts" or "ts" or "vob" or "mpeg" or "m2ts")
        {
            a.AddRange(["-fflags", "+genpts"]);
        }

        if (cudaDecode)
        {
            a.AddRange(["-hwaccel", "cuda"]); // frames come back to system memory for the filters below
        }

        a.AddRange(["-probesize", "100M", "-analyzeduration", "100M", "-i", f.Path]);

        // External text subtitles (.srt next to the film) come in as extra inputs.
        var externalSubs = f.SubtitleTracks.Where(t => t.IsExternal && t.IsText && !string.IsNullOrEmpty(t.ExternalPath) && File.Exists(t.ExternalPath)).ToList();
        foreach (var t in externalSubs)
        {
            a.AddRange(["-i", t.ExternalPath!]);
        }

        a.AddRange(["-map", f.VideoStreamIndex >= 0 ? $"0:{f.VideoStreamIndex}" : "0:v:0"]);
        if (f.AudioTracks.Count > 0)
        {
            a.AddRange(["-map", $"0:a:{Math.Clamp(audioIndex, 0, f.AudioTracks.Count - 1)}"]);
        }

        // Internal subtitles: their position among the file's own subtitle tracks (externals are listed after them).
        var internalSubs = f.SubtitleTracks.Where(t => !t.IsExternal).ToList();
        var mappedSubs = new List<SubtitleTrack>();
        for (int i = 0; i < internalSubs.Count; i++)
        {
            if (internalSubs[i].IsText)
            {
                a.AddRange(["-map", $"0:s:{i}"]);
                mappedSubs.Add(internalSubs[i]);
            }
        }

        for (int i = 0; i < externalSubs.Count; i++)
        {
            a.AddRange(["-map", $"{i + 1}:0"]);
            mappedSubs.Add(externalSubs[i]);
        }

        a.AddRange(["-map_metadata", "-1", "-map_chapters", "0", "-metadata", $"title={f.Title}"]);

        // Picture: deinterlace, shrink if bigger than the chosen size, HDR → normal colour, 8-bit.
        var filters = new List<string>();
        if (f.IsInterlaced)
        {
            filters.Add("bwdif=mode=send_frame:deint=interlaced");
        }

        if (f.Width > o.MaxWidth)
        {
            filters.Add($"scale=w={o.MaxWidth}:h=-2");
        }

        bool hdr = f.Range != DynamicRange.Sdr;
        if (hdr && canToneMap)
        {
            filters.Add("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv");
        }

        filters.Add("format=yuv420p");
        a.AddRange(["-vf", string.Join(',', filters)]);

        string rate = Kbps(o.VideoBitrate);
        string max = Kbps(o.VideoBitrate * 3 / 2);
        string buf = Kbps(o.VideoBitrate * 2);
        if (videoEncoder == "h264_nvenc")
        {
            a.AddRange(["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-b:v", rate, "-maxrate", max, "-bufsize", buf, "-spatial-aq", "1", "-profile:v", "high"]);
        }
        else
        {
            a.AddRange(["-c:v", "libx264", "-preset", "veryfast", "-b:v", rate, "-maxrate", max, "-bufsize", buf, "-profile:v", "high"]);
        }

        if (hdr || f.ColorPrimaries is not null)
        {
            a.AddRange(["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]);
        }

        a.AddRange(["-c:a", "aac", "-ac", "2", "-b:a", Kbps(AudioBitrate)]);
        if (f.AudioTracks.Count > 0 && f.AudioTracks[Math.Clamp(audioIndex, 0, f.AudioTracks.Count - 1)].Language is { Length: > 0 } lang)
        {
            a.AddRange(["-metadata:s:a:0", $"language={lang}"]);
        }
        if (mappedSubs.Count > 0)
        {
            a.AddRange(["-c:s", "mov_text"]);
            for (int i = 0; i < mappedSubs.Count; i++)
            {
                if (!string.IsNullOrEmpty(mappedSubs[i].Language))
                {
                    a.AddRange([$"-metadata:s:s:{i}", $"language={mappedSubs[i].Language}"]);
                }
            }
        }

        a.AddRange(["-movflags", "+faststart", "-max_muxing_queue_size", "9999", "-f", "mp4", outputPath]);
        return a;
    }

    /// <summary>A safe file name such as "Inception (2010) - 720p.mp4".</summary>
    public static string FileName(string title, string label)
    {
        var bad = Path.GetInvalidFileNameChars().Concat(['<', '>', ':', '"', '/', '\\', '|', '?', '*']).ToHashSet();
        string clean = new string(title.Replace(" · ", " - ", StringComparison.Ordinal).Select(c => bad.Contains(c) || char.IsControl(c) ? ' ' : c).ToArray());
        clean = string.Join(' ', clean.Split(' ', StringSplitOptions.RemoveEmptyEntries)).Trim(' ', '.');
        if (clean.Length > 120)
        {
            clean = clean[..120].Trim();
        }

        return string.Create(CultureInfo.InvariantCulture, $"{(clean.Length > 0 ? clean : "Video")} - {label}.mp4");
    }

    private static string Kbps(long bps) => (bps / 1000).ToString(CultureInfo.InvariantCulture) + "k";
}
