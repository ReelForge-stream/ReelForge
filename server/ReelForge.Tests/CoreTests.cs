using ReelForge.Core;
using ReelForge.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ReelForge.Tests;

internal static class Make
{
    private static readonly TimeSpan TwoHours = TimeSpan.FromHours(2);

    public static MediaFile Movie(
        string path,
        string codec = "h264",
        int width = 1920,
        int height = 1080,
        double videoMbps = 10,
        long? size = null,
        string? tmdb = "27205",
        string title = "Inception",
        int year = 2010,
        DynamicRange range = DynamicRange.Sdr,
        int bitDepth = 8,
        TimeSpan? duration = null,
        int channels = 6)
    {
        var d = duration ?? TwoHours;
        long vbr = (long)(videoMbps * 1_000_000);
        long audio = 640_000;
        return new MediaFile
        {
            ItemId = Guid.NewGuid(),
            MediaSourceId = Guid.NewGuid().ToString("N"),
            Kind = MediaKind.Movie,
            Title = $"{title} ({year})",
            Year = year,
            ProviderIds = tmdb is null ? new Dictionary<string, string>() : new Dictionary<string, string> { ["Tmdb"] = tmdb },
            Path = path,
            Container = Path.GetExtension(path).TrimStart('.'),
            SizeBytes = size ?? (long)((vbr + audio) * d.TotalSeconds / 8),
            DurationTicks = d.Ticks,
            VideoCodec = codec,
            VideoStreamIndex = 0,
            Width = width,
            Height = height,
            BitDepth = bitDepth,
            FrameRate = 23.976,
            Range = range,
            VideoBitrate = vbr,
            TotalBitrate = vbr + audio,
            AudioTracks = [new AudioTrack("ac3", channels, audio, "eng")],
            SubtitleTracks = [new SubtitleTrack("subrip", "eng", false)],
        };
    }

    public static MediaFile Episode(string path, int season, int episode, int? end = null, string tvdb = "371980", string codec = "h264")
    {
        var m = Movie(path, codec: codec, tmdb: null, duration: TimeSpan.FromMinutes(50));
        return m with
        {
            Kind = MediaKind.Episode,
            Title = $"Severance S{season:00}E{episode:00}",
            SeriesName = "Severance",
            SeriesId = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            SeasonNumber = season,
            EpisodeNumber = episode,
            EpisodeNumberEnd = end,
            ProviderIds = new Dictionary<string, string> { ["Tvdb"] = tvdb },
        };
    }
}

public class DuplicateFinderTests
{
    [Fact]
    public void Keeps_higher_quality_copy_and_reports_reclaimable_space()
    {
        var best = Make.Movie(@"D:\Movies\Inception (2010)\Inception (2010) - 1080p.mkv", codec: "hevc", videoMbps: 8);
        var worse = Make.Movie(@"E:\Old\Inception.2010.720p.mp4", width: 1280, height: 720, videoMbps: 4);

        var groups = DuplicateFinder.Find([worse, best]);

        var g = Assert.Single(groups);
        Assert.Equal(best.Path, g.Files[0].File.Path);
        Assert.True(g.Files[0].RecommendedKeep);
        Assert.False(g.Files[1].RecommendedKeep);
        Assert.Equal(worse.SizeBytes, g.ReclaimableBytes);
    }

    [Fact]
    public void Same_file_reported_twice_is_not_a_duplicate()
    {
        var a = Make.Movie(@"D:\Movies\Inception.mkv");
        var sameFileOtherSlashes = a with { MediaSourceId = "other", Path = "D:/Movies/Inception.mkv" };
        Assert.Empty(DuplicateFinder.Find([a, sameFileOtherSlashes]));
    }

    [Fact]
    public void Different_editions_are_flagged_and_nothing_is_preselected()
    {
        var theatrical = Make.Movie(@"D:\Movies\Blade Runner (1982)\Blade Runner (1982).mkv", tmdb: "78", title: "Blade Runner", year: 1982);
        var finalCut = Make.Movie(@"D:\Movies\Blade Runner (1982)\Blade Runner (1982) - Final Cut.mkv", tmdb: "78", title: "Blade Runner", year: 1982);

        var g = Assert.Single(DuplicateFinder.Find([theatrical, finalCut]));

        Assert.True(g.LooksLikeEditions);
        Assert.All(g.Files, f => Assert.True(f.RecommendedKeep));
        Assert.Contains(g.Files, f => f.Edition == "Final Cut");
    }

    [Theory]
    [InlineData("Avatar (2009) - 3D.mkv", "3D")]
    [InlineData("Avatar.2009.Half-SBS.mkv", "3D")]
    [InlineData("Movie (2001) {edition-Extended Edition}.mkv", "Extended")]
    [InlineData("Aliens.1986.Directors.Cut.1080p.mkv", "Director's Cut")]
    [InlineData("Inception (2010) - 1080p.mkv", null)]
    [InlineData("Soundtrack.of.Uncutable.Moments.mkv", null)]
    public void Detects_editions(string fileName, string? expected)
    {
        Assert.Equal(expected, DuplicateFinder.DetectEdition(fileName));
    }

    [Fact]
    public void Episodes_match_on_series_season_and_episode()
    {
        var e1a = Make.Episode(@"T:\TV\Severance\Season 01\Severance - S01E01.mkv", 1, 1);
        var e1b = Make.Episode(@"T:\TV\Severance (2022)\S01\severance.s01e01.720p.mp4", 1, 1);
        var e2 = Make.Episode(@"T:\TV\Severance\Season 01\Severance - S01E02.mkv", 1, 2);
        var e1to2 = Make.Episode(@"T:\TV\Severance\Season 01\Severance - S01E01-E02.mkv", 1, 1, end: 2);
        var otherShow = Make.Episode(@"T:\TV\Other\S01E01.mkv", 1, 1, tvdb: "999");

        var g = Assert.Single(DuplicateFinder.Find([e1a, e1b, e2, e1to2, otherShow]));
        Assert.Equal(2, g.Files.Count);
        Assert.Equal(MediaKind.Episode, g.Kind);
    }

    [Fact]
    public void Same_show_in_two_folders_matches_without_metadata_ids()
    {
        // Jellyfin creates a separate series item per folder, so SeriesId differs.
        var a = Make.Episode(@"T:\TV\Show Test (2020)\Season 01\Show Test - S01E01.mkv", 1, 1) with { ProviderIds = new Dictionary<string, string>(), SeriesId = Guid.NewGuid() };
        var b = Make.Episode(@"U:\TV2\Show Test (2020)\Season 1\show.test.s01e01.480p.mkv", 1, 1) with { ProviderIds = new Dictionary<string, string>(), SeriesId = Guid.NewGuid() };
        var other = Make.Episode(@"T:\TV\Other Show\S01E01.mkv", 1, 1) with { ProviderIds = new Dictionary<string, string>(), SeriesName = "Other Show", SeriesId = Guid.NewGuid() };
        var g = Assert.Single(DuplicateFinder.Find([a, b, other]));
        Assert.Equal(2, g.Files.Count);
    }

    [Fact]
    public void Movies_without_ids_fall_back_to_title_and_year()
    {
        var a = Make.Movie(@"D:\The Matrix (1999).mkv", tmdb: null, title: "The Matrix", year: 1999);
        var b = Make.Movie(@"E:\Matrix 1999.avi", tmdb: null, title: "Matrix", year: 1999, codec: "mpeg4");
        var remake = Make.Movie(@"E:\Matrix (2031).mkv", tmdb: null, title: "Matrix", year: 2031);

        var g = Assert.Single(DuplicateFinder.Find([a, b, remake]));
        Assert.Equal(2, g.Files.Count);
    }
}

public class QualityScorerTests
{
    [Fact]
    public void Higher_resolution_wins()
    {
        Assert.True(QualityScorer.Score(Make.Movie("a.mkv", width: 3840, height: 2160, videoMbps: 20))
                    > QualityScorer.Score(Make.Movie("b.mkv", videoMbps: 30)));
    }

    [Fact]
    public void Scope_1080p_counts_as_1080p()
    {
        Assert.Equal(1080, QualityScorer.ResolutionTier(1920, 800));
        Assert.Equal(2160, QualityScorer.ResolutionTier(3840, 1600));
    }

    [Fact]
    public void Same_bitrate_HEVC_beats_H264()
    {
        Assert.True(QualityScorer.Score(Make.Movie("a.mkv", codec: "hevc", videoMbps: 6))
                    > QualityScorer.Score(Make.Movie("b.mkv", codec: "h264", videoMbps: 6)));
    }

    [Fact]
    public void Equal_quality_keeps_the_smaller_file()
    {
        var big = Make.Movie(@"D:\a.mkv", size: 9_000_000_000);
        var small = Make.Movie(@"D:\b.mkv", size: 8_000_000_000);
        var g = Assert.Single(DuplicateFinder.Find([big, small]));
        Assert.Equal(small.Path, g.Files[0].File.Path);
    }

    [Fact]
    public void Describe_is_human_readable()
    {
        Assert.Equal("4K · HEVC 10-bit · HDR10 · 5.1",
            QualityScorer.Describe(Make.Movie("a.mkv", codec: "hevc", width: 3840, height: 2160, bitDepth: 10, range: DynamicRange.Hdr10)));
    }
}

public class SpaceSaverTests
{
    private static readonly ConversionSettings Balanced = new();

    [Fact]
    public void Big_H264_1080p_is_a_candidate_with_roughly_half_the_size()
    {
        var f = Make.Movie(@"D:\m.mkv", videoMbps: 12);
        var e = SpaceSaverEstimator.Estimate(f, Balanced);

        Assert.True(e.IsCandidate, e.Reason);
        Assert.InRange(e.SavingsFraction, 0.45, 0.65);
        Assert.Equal(4_500_000, e.TargetVideoBitrate);
    }

    [Fact]
    public void Dolby_Vision_is_never_converted()
    {
        var f = Make.Movie(@"D:\dv.mkv", codec: "hevc", width: 3840, height: 2160, videoMbps: 60, range: DynamicRange.DolbyVision, bitDepth: 10);
        var e = SpaceSaverEstimator.Estimate(f, Balanced with { IncludeHdr = true });
        Assert.False(e.IsCandidate);
        Assert.Contains("Dolby Vision", e.Reason);
    }

    [Fact]
    public void HDR_needs_opt_in()
    {
        var f = Make.Movie(@"D:\hdr.mkv", codec: "hevc", width: 3840, height: 2160, videoMbps: 50, range: DynamicRange.Hdr10, bitDepth: 10);
        Assert.False(SpaceSaverEstimator.Estimate(f, Balanced).IsCandidate);
        Assert.True(SpaceSaverEstimator.Estimate(f, Balanced with { IncludeHdr = true }).IsCandidate);
    }

    [Fact]
    public void Already_lean_HEVC_is_left_alone()
    {
        var f = Make.Movie(@"D:\lean.mkv", codec: "hevc", videoMbps: 4);
        var e = SpaceSaverEstimator.Estimate(f, Balanced);
        Assert.False(e.IsCandidate);
        Assert.Equal("Already efficiently encoded", e.Reason);
    }

    [Fact]
    public void Small_savings_are_not_worth_it()
    {
        var f = Make.Movie(@"D:\short.mkv", videoMbps: 2, duration: TimeSpan.FromMinutes(22), width: 1280, height: 720);
        Assert.False(SpaceSaverEstimator.Estimate(f, Balanced).IsCandidate);
    }

    [Fact]
    public void Disc_images_are_skipped()
    {
        var f = Make.Movie(@"D:\disc.iso", codec: "mpeg2video", videoMbps: 30) with { IsPlainFile = false };
        Assert.False(SpaceSaverEstimator.Estimate(f, Balanced).IsCandidate);
    }

    [Fact]
    public void Presets_scale_the_target()
    {
        var f = Make.Movie(@"D:\m.mkv");
        long max = SpaceSaverEstimator.TargetBitrate(f, Balanced with { Preset = QualityPreset.MaxSavings });
        long bal = SpaceSaverEstimator.TargetBitrate(f, Balanced);
        long hq = SpaceSaverEstimator.TargetBitrate(f, Balanced with { Preset = QualityPreset.HighQuality });
        Assert.True(max < bal && bal < hq);
    }
}

public class FfmpegArgsTests
{
    private static string Joined(IReadOnlyList<string> a) => string.Join(' ', a);

    [Fact]
    public void Nvenc_command_copies_audio_and_subs_and_writes_matroska()
    {
        var f = Make.Movie(@"D:\m.mp4") with
        {
            VideoStreamIndex = 2,
            SubtitleTracks = [new SubtitleTrack("subrip", "eng", false), new SubtitleTrack("mov_text", "spa", false), new SubtitleTrack("subrip", "fre", false, IsExternal: true)],
        };
        var args = FfmpegArgs.Build(f, new ConversionSettings(), new EncoderChoice("hevc_nvenc", true), 4_500_000, @"D:\m.reelforge-tmp");
        string s = Joined(args);

        Assert.Contains("-hwaccel cuda", s);
        Assert.Contains("-map 0:2", s);
        Assert.Contains("-c:v hevc_nvenc", s);
        Assert.Contains("-profile:v main -pix_fmt yuv420p", s);
        Assert.Contains("-maxrate 6750k", s);
        Assert.Contains("-c:a copy", s);
        Assert.Contains("-c:s:1 srt", s); // mov_text can't go into MKV
        Assert.DoesNotContain("-c:s:2", s); // external subtitle stays a separate file
        Assert.DoesNotContain("0:t?", s); // MP4 has no attachments
        Assert.Equal(@"D:\m.reelforge-tmp", args[^1]);
        Assert.Equal("matroska", args[^2]);
        Assert.True(args.ToList().IndexOf("-hwaccel") < args.ToList().IndexOf("-i"));
    }

    [Fact]
    public void Hdr_keeps_10bit_and_colour_tags()
    {
        var f = Make.Movie(@"D:\hdr.mkv", codec: "hevc", width: 3840, height: 2160, bitDepth: 10, range: DynamicRange.Hdr10) with
        {
            ColorPrimaries = "bt2020",
            ColorTransfer = "smpte2084",
            ColorSpace = "bt2020nc",
        };
        string s = Joined(FfmpegArgs.Build(f, new ConversionSettings { IncludeHdr = true }, new EncoderChoice("hevc_nvenc", true), 16_000_000, "out"));
        Assert.Contains("-profile:v main10 -pix_fmt p010le", s);
        Assert.Contains("-color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc", s);
        Assert.Contains("-map 0:t?", s);
    }

    [Fact]
    public void Interlaced_sources_get_deinterlaced()
    {
        var f = Make.Movie(@"D:\dvd.mkv", codec: "mpeg2video", width: 720, height: 480) with { IsInterlaced = true };
        Assert.Contains("bwdif", Joined(FfmpegArgs.Build(f, new ConversionSettings(), new EncoderChoice("libx265", false), 1_100_000, "out")));
    }

    [Fact]
    public void Encoder_choice_follows_what_actually_works()
    {
        var all = new HashSet<string> { "hevc_nvenc", "av1_nvenc", "libx265", "libsvtav1" };
        Assert.Equal("hevc_nvenc", FfmpegArgs.Choose(TargetCodec.Hevc, all)!.VideoEncoder);
        Assert.Equal("av1_nvenc", FfmpegArgs.Choose(TargetCodec.Av1, all)!.VideoEncoder);

        var pascal = new HashSet<string> { "hevc_nvenc", "libx265" };
        Assert.Null(FfmpegArgs.Choose(TargetCodec.Av1, pascal));

        var noGpu = new HashSet<string> { "libx265" };
        var cpu = FfmpegArgs.Choose(TargetCodec.Hevc, noGpu)!;
        Assert.Equal("libx265", cpu.VideoEncoder);
        Assert.False(cpu.UseCudaDecode);
    }

    [Fact]
    public void Ten_bit_source_falls_back_to_cpu_when_card_lacks_10bit_hevc()
    {
        var report = new EncoderReport { Working = ["hevc_nvenc", "libx265"], HevcNvenc10Bit = false };
        var tenBit = Make.Movie("a.mkv", bitDepth: 10);
        var eightBit = Make.Movie("b.mkv");
        Assert.Equal("libx265", EncoderProbe.ChooseFor(tenBit, new ConversionSettings(), report)!.VideoEncoder);
        Assert.Equal("hevc_nvenc", EncoderProbe.ChooseFor(eightBit, new ConversionSettings(), report)!.VideoEncoder);
    }
}

public class QueueHelperTests
{
    [Theory]
    [InlineData("out_time_us=3600000000", 3600000000d, null)]
    [InlineData("out_time_ms=1500000", 1500000d, null)]
    [InlineData("speed=6.25x", null, 6.25)]
    [InlineData("speed=N/A", null, null)]
    [InlineData("progress=continue", null, null)]
    public void Parses_ffmpeg_progress(string line, double? us, double? speed)
    {
        var (u, s) = ConversionQueue.ParseProgressLine(line);
        Assert.Equal(us, u);
        Assert.Equal(speed, s);
    }

    [Fact]
    public void Verification_accepts_faithful_output_and_rejects_truncated()
    {
        var src = Make.Movie("a.mkv") with
        {
            AudioTracks = [new AudioTrack("ac3", 6, 640_000, "eng"), new AudioTrack("aac", 2, 128_000, "eng")],
            SubtitleTracks = [new SubtitleTrack("subrip", "eng", false), new SubtitleTrack("subrip", "spa", false, true)],
        };

        const string Good = """{"streams":[{"codec_type":"video"},{"codec_type":"audio"},{"codec_type":"audio"},{"codec_type":"subtitle"}],"format":{"duration":"7199.2"}}""";
        const string Short = """{"streams":[{"codec_type":"video"},{"codec_type":"audio"},{"codec_type":"audio"},{"codec_type":"subtitle"}],"format":{"duration":"3600.0"}}""";
        const string LostAudio = """{"streams":[{"codec_type":"video"},{"codec_type":"audio"},{"codec_type":"subtitle"}],"format":{"duration":"7200.0"}}""";

        Assert.Null(ConversionQueue.CheckProbe(src, Good));
        Assert.Contains("length", ConversionQueue.CheckProbe(src, Short));
        Assert.Contains("audio", ConversionQueue.CheckProbe(src, LostAudio));
    }
}

public sealed class HoldingAreaTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "reelforge-test-" + Guid.NewGuid().ToString("N")[..8]);

    public HoldingAreaTests() => Directory.CreateDirectory(Path.Combine(_root, "Movies", "Inception (2010)"));

    public void Dispose() => Directory.Delete(_root, true);

    private string Touch(string rel, int bytes = 1024)
    {
        string p = Path.Combine(_root, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllBytes(p, new byte[bytes]);
        return p;
    }

    [Fact]
    public void Remove_then_restore_round_trips_file_and_sidecars()
    {
        string video = Touch(Path.Combine("Movies", "Inception (2010)", "Inception (2010) - 720p.mkv"), 5000);
        string sub = Touch(Path.Combine("Movies", "Inception (2010)", "Inception (2010) - 720p.en.srt"));
        string keeperSub = Touch(Path.Combine("Movies", "Inception (2010)", "Inception (2010).en.srt"));
        Touch(Path.Combine("Movies", "Inception (2010)", "Inception (2010).mkv"));

        var area = new HoldingArea(NullLogger<HoldingArea>.Instance, Path.Combine(_root, "data"));
        var held = area.Remove(video, "Inception (2010)", "Duplicate", 14, includeSidecars: true)!;

        Assert.False(File.Exists(video));
        Assert.False(File.Exists(sub));
        Assert.True(File.Exists(keeperSub)); // belongs to the copy we kept
        Assert.True(File.Exists(held.HeldPath));
        Assert.Contains(".reelforge-holding", held.HeldPath);
        Assert.Equal(5000, held.SizeBytes);
        Assert.Single(area.List());

        area.Restore(held.Id);
        Assert.True(File.Exists(video));
        Assert.True(File.Exists(sub));
        Assert.Empty(area.List());
    }

    [Fact]
    public void Holding_folder_goes_in_the_library_root_containing_the_file()
    {
        string lib = Path.Combine(_root, "Movies");
        string video = Touch(Path.Combine("Movies", "Inception (2010)", "Inception.mkv"));
        string bucket = HoldingArea.HoldingDirectoryFor(video, "abc", [Path.Combine(_root, "TV"), lib]);
        Assert.StartsWith(Path.Combine(lib, ".reelforge-holding"), bucket);
    }

    [Fact]
    public void Shared_basename_sidecars_stay_put()
    {
        string avi = Touch(Path.Combine("Movies", "Inception (2010)", "Inception.avi"));
        Touch(Path.Combine("Movies", "Inception (2010)", "Inception.mkv"));
        Touch(Path.Combine("Movies", "Inception (2010)", "Inception.en.srt"));
        Assert.Empty(HoldingArea.FindExclusiveSidecars(avi));
    }

    [Fact]
    public void Purge_deletes_permanently_and_state_survives_restart()
    {
        string video = Touch(Path.Combine("Movies", "x.mkv"));
        string data = Path.Combine(_root, "data");
        var held = new HoldingArea(NullLogger<HoldingArea>.Instance, data).Remove(video, "x", "Duplicate", 14, false)!;

        var reopened = new HoldingArea(NullLogger<HoldingArea>.Instance, data);
        Assert.Single(reopened.List());
        reopened.Purge(held.Id);
        Assert.False(File.Exists(held.HeldPath));
        Assert.Empty(reopened.List());
    }

    [Fact]
    public void Zero_day_retention_deletes_immediately()
    {
        string video = Touch(Path.Combine("Movies", "y.mkv"));
        var area = new HoldingArea(NullLogger<HoldingArea>.Instance, Path.Combine(_root, "data"));
        Assert.Null(area.Remove(video, "y", "Duplicate", 0, false));
        Assert.False(File.Exists(video));
        Assert.Empty(area.List());
    }
}

public class PackagingTests
{
    [Fact]
    public void Web_ui_is_embedded_in_the_module()
    {
        var names = typeof(ReelForge.Api.WebUiController).Assembly.GetManifestResourceNames()
            .Select(n => n.Replace('\\', '/')).ToList();
        Assert.Contains("ReelForgeWeb/index.html", names);
        Assert.Contains(names, n => n.StartsWith("ReelForgeWeb/assets/", StringComparison.Ordinal) && n.EndsWith(".js", StringComparison.Ordinal));
    }
}

public class FrontDoorTests
{
    [Theory]
    [InlineData("/", true, "/reelforge/")]
    [InlineData("", true, "/reelforge/")]
    [InlineData("/", false, "/reelforge/setup")]
    [InlineData("/web/", false, "/reelforge/setup")]
    [InlineData("/web/index.html", false, "/reelforge/setup")]
    [InlineData("/web/", true, "")]
    [InlineData("/web/index.html", true, "")]
    [InlineData("/reelforge/", false, "")]
    [InlineData("/System/Info/Public", false, "")]
    [InlineData("/Items", true, "")]
    public void Sends_browsers_to_ReelForge(string path, bool setupDone, string expected)
    {
        Assert.Equal(expected, ReelForge.Services.FrontDoor.Redirect(path, setupDone));
    }
}

public class NetworkShareTests
{
    [Theory]
    [InlineData(@"\\10.0.0.201\plexdata\MOVIES", @"\\10.0.0.201\plexdata")]
    [InlineData(@"\\nas\media", @"\\nas\media")]
    [InlineData("//nas/media/TV", @"\\nas\media")]
    [InlineData(@"  \\nas\media\  ", @"\\nas\media")]
    [InlineData(@"\\nas", null)]
    [InlineData(@"Z:\Movies", null)]
    public void Finds_the_share_root(string path, string? expected)
    {
        Assert.Equal(expected, ReelForge.Services.NetworkShares.ShareRoot(path));
    }

    [Theory]
    [InlineData(1326, "username or password")]
    [InlineData(86, "username or password")]
    [InlineData(53, "Can't find that NAS")]
    [InlineData(67, "no share by that name")]
    [InlineData(5, "Access denied")]
    public void Explains_windows_errors_plainly(int code, string expected)
    {
        Assert.Contains(expected, ReelForge.Services.NetworkShares.Explain(code));
    }

    [Fact]
    public void Saved_passwords_round_trip()
    {
        string stored = ReelForge.Services.Secret.Protect("hunter2!");
        Assert.DoesNotContain("hunter2", stored);
        Assert.Equal("hunter2!", ReelForge.Services.Secret.Unprotect(stored));
        Assert.Equal(string.Empty, ReelForge.Services.Secret.Unprotect(string.Empty));
    }
}

public class ScanServiceTests
{
    private static async Task<ScanStatus> WaitDone(ScanService svc, string id)
    {
        for (int i = 0; i < 200; i++)
        {
            var s = svc.Get(id)!;
            if (s.State != ScanState.Running)
            {
                return s;
            }

            await Task.Delay(10);
        }

        throw new TimeoutException();
    }

    [Fact]
    public async Task Reports_progress_then_returns_the_result()
    {
        var svc = new ScanService(NullLogger<ScanService>.Instance);
        var gate = new TaskCompletionSource();
        var st = svc.Start("duplicates", "k1", false, async (p, ct) =>
        {
            p.Begin("Reading files", 4);
            p.Step();
            p.Step();
            await gate.Task;
            p.Step(2);
            return "result";
        });

        await Task.Delay(50);
        var mid = svc.Get(st.Id)!;
        Assert.Equal(ScanState.Running, mid.State);
        Assert.Equal("Reading files", mid.Phase);
        Assert.Equal(2, mid.Done);
        Assert.Equal(4, mid.Total);
        Assert.Null(mid.Result);

        gate.SetResult();
        var done = await WaitDone(svc, st.Id);
        Assert.Equal(ScanState.Done, done.State);
        Assert.Equal("result", done.Result);
        Assert.Equal(4, done.Done);
    }

    [Fact]
    public async Task Reuses_a_recent_result_unless_fresh_and_rejoins_a_running_scan()
    {
        var svc = new ScanService(NullLogger<ScanService>.Instance);
        int runs = 0;
        Task<object> Work(ScanProgress p, CancellationToken ct)
        {
            Interlocked.Increment(ref runs);
            return Task.FromResult<object>(runs);
        }

        var a = svc.Start("spacesaver", "k", false, Work);
        await WaitDone(svc, a.Id);
        var b = svc.Start("spacesaver", "k", false, Work);
        Assert.Equal(a.Id, b.Id);
        Assert.Equal(1, runs);

        var c = svc.Start("spacesaver", "k", true, Work);
        Assert.NotEqual(a.Id, c.Id);
        await WaitDone(svc, c.Id);
        Assert.Equal(2, runs);

        svc.Invalidate("spacesaver");
        var d = svc.Start("spacesaver", "k", false, Work);
        Assert.NotEqual(c.Id, d.Id);
    }

    [Fact]
    public async Task Can_be_cancelled_and_reports_failures()
    {
        var svc = new ScanService(NullLogger<ScanService>.Instance);
        var slow = svc.Start("duplicates", "slow", false, async (p, ct) =>
        {
            await Task.Delay(5000, ct);
            return 1;
        });
        Assert.True(svc.Cancel(slow.Id));
        Assert.Equal(ScanState.Cancelled, (await WaitDone(svc, slow.Id)).State);

        var bad = svc.Start("duplicates", "bad", false, (p, ct) => throw new InvalidOperationException("NAS offline"));
        var s = await WaitDone(svc, bad.Id);
        Assert.Equal(ScanState.Failed, s.State);
        Assert.Equal("NAS offline", s.Error);
    }
}

public class DownloadPlanTests
{
    private static string Joined(IReadOnlyList<string> a) => string.Join(' ', a);

    [Fact]
    public void Offers_only_sizes_the_source_has_largest_first()
    {
        var uhd = Make.Movie("/m/a.mkv", codec: "hevc", width: 3840, height: 2160, videoMbps: 40);
        Assert.Equal(["1080p", "720p", "480p"], DownloadPlan.Options(uhd).Select(o => o.Id));

        var hd = Make.Movie("/m/b.mkv", width: 1280, height: 720, videoMbps: 4);
        Assert.Equal(["720p", "480p"], DownloadPlan.Options(hd).Select(o => o.Id));

        var scope = Make.Movie("/m/c.mkv", width: 1920, height: 800); // wide film still counts as 1080p
        Assert.Equal("1080p", DownloadPlan.Options(scope)[0].Id);

        var dvd = Make.Movie("/m/d.vob", codec: "mpeg2video", width: 720, height: 480, videoMbps: 5);
        Assert.Equal("480p", Assert.Single(DownloadPlan.Options(dvd)).Id);
    }

    [Fact]
    public void Estimates_size_from_bitrate_and_never_exceeds_the_source()
    {
        var film = Make.Movie("/m/a.mkv", width: 1920, height: 1080, videoMbps: 10); // 2 hours
        var o1080 = DownloadPlan.Options(film)[0];
        Assert.Equal(6_000_000, o1080.VideoBitrate);
        double gb = o1080.EstimatedBytes / 1e9;
        Assert.InRange(gb, 5.4, 5.7); // (6 Mbps + 192 kbps) x 7200 s

        var thin = Make.Movie("/m/b.mkv", width: 1920, height: 1080, videoMbps: 2); // already small H.264
        Assert.Equal(2_000_000, DownloadPlan.Options(thin)[0].VideoBitrate);
    }

    [Fact]
    public void Builds_a_universal_mp4_with_chosen_audio_and_text_subtitles()
    {
        var f = Make.Movie("/m/a.mkv", codec: "hevc", width: 3840, height: 2160, range: DynamicRange.Hdr10, bitDepth: 10) with
        {
            AudioTracks = [new AudioTrack("truehd", 8, 4_000_000, "eng"), new AudioTrack("ac3", 6, 640_000, "fra")],
            SubtitleTracks = [new SubtitleTrack("PGS", "eng", false), new SubtitleTrack("subrip", "fra", false), new SubtitleTrack("subrip", "spa", false, true, "/does/not/exist.srt")],
        };
        var o = DownloadPlan.Options(f).First(x => x.Id == "720p");
        string a = Joined(DownloadPlan.Build(f, o, 1, "h264_nvenc", true, true, "/tmp/out.mp4"));

        Assert.Contains("-hwaccel cuda", a);
        Assert.Contains("-map 0:a:1", a);
        Assert.Contains("language=fra", a);
        Assert.Contains("-map 0:s:1", a); // the French SRT; the PGS picture subtitles can't go in an MP4
        Assert.DoesNotContain("-map 0:s:0", a);
        Assert.DoesNotContain("exist.srt", a); // missing external file is skipped, not an ffmpeg error
        Assert.Contains("scale=w=1280:h=-2", a);
        Assert.Contains("tonemap=tonemap=hable", a);
        Assert.Contains("-c:v h264_nvenc", a);
        Assert.Contains("-c:a aac -ac 2", a);
        Assert.Contains("-c:s mov_text", a);
        Assert.EndsWith("-f mp4 /tmp/out.mp4", a);

        string cpu = Joined(DownloadPlan.Build(f, o, 0, "libx264", false, false, "/tmp/out.mp4"));
        Assert.DoesNotContain("cuda", cpu);
        Assert.DoesNotContain("tonemap", cpu);
        Assert.Contains("-c:v libx264", cpu);
    }

    [Fact]
    public void File_names_are_safe()
    {
        Assert.Equal("Severance S02E03 - Who Is Alive - 720p.mp4", DownloadPlan.FileName("Severance S02E03 · Who Is Alive?", "720p").Replace("  ", " "));
        Assert.Equal("AC DC Live - 480p.mp4", DownloadPlan.FileName("AC/DC: Live", "480p"));
    }
}

public class QueueCleanupTests
{
    [Fact]
    public void Finished_failed_and_cancelled_leave_after_45_minutes()
    {
        var now = new DateTime(2026, 10, 21, 12, 0, 0, DateTimeKind.Utc);
        ConversionJob Job(JobStatus s, int minutesAgo) => new() { Status = s, FinishedUtc = now.AddMinutes(-minutesAgo) };

        Assert.True(ConversionQueue.IsExpired(Job(JobStatus.Done, 45), now));
        Assert.True(ConversionQueue.IsExpired(Job(JobStatus.Failed, 60), now));
        Assert.True(ConversionQueue.IsExpired(Job(JobStatus.Cancelled, 46), now));
        Assert.False(ConversionQueue.IsExpired(Job(JobStatus.Done, 44), now));
        Assert.False(ConversionQueue.IsExpired(Job(JobStatus.Running, 600), now)); // still working: never removed
        Assert.False(ConversionQueue.IsExpired(Job(JobStatus.Queued, 600), now));
    }
}

public class SavingsLedgerTests
{
    [Fact]
    public void Keeps_a_running_total_that_survives_a_restart()
    {
        string path = Path.Combine(Path.GetTempPath(), $"rf-saved-{Guid.NewGuid():N}.jsonl");
        try
        {
            var t0 = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
            SavingsEntry E(int day, long before, long after) => new() { FinishedUtc = t0.AddDays(day), ItemId = Guid.NewGuid(), Title = $"Film {day}", Path = $"/m/{day}.mkv", OriginalBytes = before, NewBytes = after };

            var ledger = new SavingsLedger(NullLogger<SavingsLedger>.Instance, path);
            Assert.True(ledger.IsEmpty);
            ledger.Add(E(1, 10_000, 4_000));  // saved 6,000
            ledger.Add(E(3, 5_000, 4_000));   // saved 1,000
            ledger.Add(E(2, 8_000, 5_000));   // saved 3,000 (finished between the other two)

            var again = new SavingsLedger(NullLogger<SavingsLedger>.Instance, path); // after a restart
            var s = again.Summary();
            Assert.Equal(10_000, s.TotalSavedBytes);
            Assert.Equal(3, s.Conversions);
            Assert.Equal(["Film 3", "Film 2", "Film 1"], s.Rows.Select(r => r.Entry.Title)); // newest first
            Assert.Equal([10_000L, 9_000L, 6_000L], s.Rows.Select(r => r.RunningTotalBytes)); // running total in date order
            Assert.Equal(t0.AddDays(1), s.Since);
        }
        finally
        {
            File.Delete(path);
        }
    }
}

public class AgentTests
{
    [Fact]
    public void Pairing_key_and_agent_secret_checks()
    {
        string key = AgentRegistry.NewKey();
        Assert.Matches("^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$", key);
        Assert.True(AgentRegistry.KeyMatches(key, key.ToLowerInvariant().Replace("-", string.Empty, StringComparison.Ordinal))); // typed loosely
        Assert.False(AgentRegistry.KeyMatches(key, "AAAA-BBBB-CCCC"));
        Assert.False(AgentRegistry.KeyMatches(string.Empty, string.Empty));

        string path = Path.Combine(Path.GetTempPath(), $"rf-agents-{Guid.NewGuid():N}.json");
        try
        {
            var reg = new AgentRegistry(NullLogger<AgentRegistry>.Instance, path);
            var (a, secret) = reg.Register("GAMING-PC", "Windows", "0.9.0", "10.0.0.5");
            Assert.Same(a, reg.Authenticate($"{a.Id}.{secret}"));
            Assert.Null(reg.Authenticate($"{a.Id}.wrong"));
            Assert.Null(reg.Authenticate("nonsense"));
            Assert.DoesNotContain(secret, File.ReadAllText(path)); // only the hash is stored

            // Reinstalling on the same PC replaces it (same id, new secret, keeps its totals).
            reg.Update(a.Id, x => x.FilesConverted = 7);
            var (b, secret2) = new AgentRegistry(NullLogger<AgentRegistry>.Instance, path).Register("gaming-pc", "Windows", "0.9.1", "10.0.0.5");
            Assert.Equal(a.Id, b.Id);
            Assert.Equal(7, b.FilesConverted);
            var reloaded = new AgentRegistry(NullLogger<AgentRegistry>.Instance, path);
            Assert.Single(reloaded.List());
            Assert.Null(reloaded.Authenticate($"{a.Id}.{secret}"));
            Assert.NotNull(reloaded.Authenticate($"{b.Id}.{secret2}"));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Agents_get_their_best_graphics_encoder_and_never_the_processor_unless_allowed()
    {
        var sdr = Make.Movie("/m/a.mkv", codec: "h264");
        var hdr10 = Make.Movie("/m/b.mkv", codec: "hevc", range: DynamicRange.Hdr10, bitDepth: 10);
        var hevc = new ConversionSettings();

        Assert.Equal("hevc_nvenc", EncoderProbe.ChooseFor(sdr, hevc, ["hevc_amf", "hevc_nvenc"], [], allowCpu: false)!.VideoEncoder);
        var amd = EncoderProbe.ChooseFor(sdr, hevc, ["hevc_amf"], [], allowCpu: false)!;
        Assert.Equal("hevc_amf", amd.VideoEncoder);
        Assert.False(amd.UseCudaDecode);
        Assert.Null(EncoderProbe.ChooseFor(sdr, hevc, ["libx265"], [], allowCpu: false));
        Assert.Equal("libx265", EncoderProbe.ChooseFor(sdr, hevc, ["libx265"], [], allowCpu: true)!.VideoEncoder);

        // 10-bit HDR only goes to a card that passed the 10-bit test.
        Assert.Null(EncoderProbe.ChooseFor(hdr10, hevc, ["hevc_amf"], [], allowCpu: false));
        Assert.Equal("hevc_amf", EncoderProbe.ChooseFor(hdr10, hevc, ["hevc_amf"], ["hevc_amf"], allowCpu: false)!.VideoEncoder);
        Assert.Equal("av1_amf", EncoderProbe.ChooseFor(sdr, new ConversionSettings { Codec = TargetCodec.Av1 }, ["av1_amf"], [], allowCpu: false)!.VideoEncoder);
    }

    [Fact]
    public void Agent_arguments_read_the_file_over_the_network_and_keep_every_track()
    {
        var f = Make.Movie("/m/a.mkv", codec: "h264") with { Path = AgentProtocol.Input };
        var args = ConversionQueue.ForNetworkInput(FfmpegArgs.Build(f, new ConversionSettings(), new EncoderChoice("hevc_amf", false), 4_000_000, AgentProtocol.Output));
        string a = string.Join(' ', args);
        Assert.Contains("-reconnect 1 -reconnect_on_network_error 1", a);
        Assert.True(a.IndexOf("-reconnect", StringComparison.Ordinal) < a.IndexOf("-i {input}", StringComparison.Ordinal));
        Assert.Contains("-c:v hevc_amf", a);
        Assert.Contains("-rc vbr_peak", a);
        Assert.Contains("-c:a copy", a);
        Assert.DoesNotContain("cuda", a);
        Assert.EndsWith("{output}", a);
    }
}
