namespace ReelForge.Core;

/// <summary>
/// Scores a file's viewing quality so duplicates can be ranked "keep the best, offer to remove the rest".
/// Resolution dominates, then dynamic range, then how much picture data the codec+bitrate carry,
/// then audio and subtitles. File size only breaks ties (smaller wins when quality is equal).
/// </summary>
public static class QualityScorer
{
    /// <summary>
    /// Relative compression efficiency: how much picture one bit buys in each codec, H.264 = 1.
    /// Used so an 8 Mbps HEVC file is not ranked below a 10 Mbps H.264 file.
    /// </summary>
    public static double CodecEfficiency(string codec) => codec.ToLowerInvariant() switch
    {
        "av1" => 2.0,
        "hevc" or "h265" => 1.6,
        "vp9" => 1.5,
        "h264" or "avc" => 1.0,
        "vc1" or "wmv3" => 0.8,
        "mpeg4" or "msmpeg4v3" or "xvid" or "divx" => 0.7,
        "mpeg2video" or "mpeg2" => 0.5,
        _ => 0.8,
    };

    public static int ResolutionTier(int width, int height)
    {
        // Use whichever dimension tells the truth for letterboxed / scope content (e.g. 1920x800 is 1080p).
        if (height >= 1600 || width >= 3200)
        {
            return 2160;
        }

        if (height >= 900 || width >= 1800)
        {
            return 1080;
        }

        if (height >= 600 || width >= 1200)
        {
            return 720;
        }

        if (height >= 400 || width >= 700)
        {
            return 480;
        }

        return height > 0 ? 360 : 0;
    }

    public static double Score(MediaFile f)
    {
        double score = ResolutionTier(f.Width, f.Height) switch
        {
            2160 => 400,
            1080 => 300,
            720 => 200,
            480 => 100,
            360 => 50,
            _ => 0,
        };

        score += f.Range switch
        {
            DynamicRange.DolbyVision => 45,
            DynamicRange.Hdr10Plus => 42,
            DynamicRange.Hdr10 or DynamicRange.Hlg => 40,
            _ => 0,
        };

        // Picture data: efficiency-adjusted bits per pixel per frame, log-scaled so it refines
        // the ranking inside a resolution tier but never jumps a tier.
        long vbr = f.EffectiveVideoBitrate;
        double pixels = Math.Max(1, (double)f.Width * f.Height);
        double fps = f.FrameRate > 1 ? f.FrameRate : 24;
        if (vbr > 0)
        {
            double bpp = vbr * CodecEfficiency(f.VideoCodec) / (pixels * fps);
            score += Math.Clamp(30 + (12 * Math.Log2(bpp / 0.05)), 0, 60);
        }

        if (f.BitDepth >= 10)
        {
            score += 5;
        }

        if (f.IsInterlaced)
        {
            score -= 15;
        }

        int maxChannels = f.AudioTracks.Count == 0 ? 0 : f.AudioTracks.Max(a => a.Channels);
        score += maxChannels >= 8 ? 15 : maxChannels >= 6 ? 10 : maxChannels >= 2 ? 3 : 0;
        if (f.AudioTracks.Any(a => a.IsLossless))
        {
            score += 5;
        }

        score += Math.Min(f.SubtitleTracks.Count, 5);
        score += Math.Min(Math.Max(f.AudioTracks.Count - 1, 0), 3);

        return Math.Round(score, 2);
    }

    /// <summary>Short human summary, e.g. "1080p · HEVC 10-bit · HDR10 · 5.1".</summary>
    public static string Describe(MediaFile f)
    {
        var parts = new List<string>();
        int tier = ResolutionTier(f.Width, f.Height);
        parts.Add(tier == 2160 ? "4K" : tier > 0 ? $"{tier}p" : "Unknown res");
        string codec = f.VideoCodec.ToLowerInvariant() switch
        {
            "hevc" or "h265" => "HEVC",
            "h264" or "avc" => "H.264",
            "av1" => "AV1",
            "mpeg2video" => "MPEG-2",
            "mpeg4" => "MPEG-4",
            "" => "?",
            var c => c.ToUpperInvariant(),
        };
        parts.Add(f.BitDepth >= 10 ? $"{codec} 10-bit" : codec);
        if (f.Range != DynamicRange.Sdr)
        {
            parts.Add(f.Range switch
            {
                DynamicRange.DolbyVision => "Dolby Vision",
                DynamicRange.Hdr10Plus => "HDR10+",
                DynamicRange.Hlg => "HLG",
                _ => "HDR10",
            });
        }

        int ch = f.AudioTracks.Count == 0 ? 0 : f.AudioTracks.Max(a => a.Channels);
        if (ch > 0)
        {
            parts.Add(ch switch { >= 8 => "7.1", >= 6 => "5.1", 2 => "Stereo", 1 => "Mono", _ => $"{ch}ch" });
        }

        return string.Join(" · ", parts);
    }
}
