using System.Diagnostics;
using ReelForge.Core;
using ReelForge.Services;
using Xunit;

namespace ReelForge.Tests;

/// <summary>
/// Runs real ffmpeg conversions with the exact arguments ReelForge generates. Skipped automatically
/// when no ffmpeg is on PATH (set REELFORGE_FFMPEG to point at jellyfin-ffmpeg on Windows).
/// </summary>
public sealed class IntegrationTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "reelforge-it-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly string? _ffmpeg = Find("REELFORGE_FFMPEG", "ffmpeg");
    private readonly string? _ffprobe = Find("REELFORGE_FFPROBE", "ffprobe");

    public IntegrationTests() => Directory.CreateDirectory(_dir);

    public void Dispose() => Directory.Delete(_dir, true);

    [Fact]
    public async Task Converts_mp4_with_two_audio_tracks_and_mov_text_subs_to_smaller_verified_mkv()
    {
        if (_ffmpeg is null || _ffprobe is null)
        {
            return;
        }

        // A deliberately bloated H.264 source: 1080p at ~25 Mbps, two audio tracks, one MP4 text subtitle.
        string srt = Path.Combine(_dir, "s.srt");
        await File.WriteAllTextAsync(srt, "1\n00:00:01,000 --> 00:00:04,000\nHello\n\n2\n00:00:05,000 --> 00:00:08,000\nWorld\n");
        string src = Path.Combine(_dir, "Test Movie (2024).mp4");
        await Run(_ffmpeg,
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=24:duration=12",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
            "-f", "lavfi", "-i", "sine=frequency=880:duration=12",
            "-i", srt,
            "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s",
            "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "25M", "-maxrate", "25M", "-bufsize", "50M",
            "-c:a", "aac", "-b:a", "192k", "-c:s", "mov_text", src);

        var file = Make.Movie(src, videoMbps: 25, duration: TimeSpan.FromSeconds(12)) with
        {
            Container = "mp4",
            SizeBytes = new FileInfo(src).Length,
            VideoStreamIndex = 0,
            AudioTracks = [new AudioTrack("aac", 1, 192_000, "eng"), new AudioTrack("aac", 1, 192_000, "eng")],
            SubtitleTracks = [new SubtitleTrack("mov_text", "eng", false)],
        };

        string tmp = Path.Combine(_dir, "Test Movie (2024).reelforge-tmp");
        var settings = new ConversionSettings { Preset = QualityPreset.MaxSavings };
        var args = FfmpegArgs.Build(file, settings, new EncoderChoice("libx265", false), SpaceSaverEstimator.TargetBitrate(file, settings), tmp);
        var (code, _, err) = await Run(_ffmpeg, args.ToArray());
        Assert.True(code == 0, err);

        var (_, json, _) = await Run(_ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", tmp);
        Assert.Null(ConversionQueue.CheckProbe(file, json));

        var (_, codecs, _) = await Run(_ffprobe, "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", tmp);
        Assert.Equal(["hevc", "aac", "aac", "subrip"], codecs.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));

        long before = new FileInfo(src).Length, after = new FileInfo(tmp).Length;
        Assert.True(after < before / 2, $"expected at least 50% smaller: {before} -> {after}");
    }

    [Fact]
    public async Task Gpu_encoder_that_is_compiled_in_but_unusable_fails_the_live_test()
    {
        if (_ffmpeg is null)
        {
            return;
        }

        var (_, list, _) = await Run(_ffmpeg, "-hide_banner", "-encoders");
        if (!list.Contains("hevc_nvenc", StringComparison.Ordinal) || HasNvidiaGpu())
        {
            return; // only meaningful on a box where NVENC is built in but no NVIDIA GPU exists
        }

        var (code, _, _) = await Run(_ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
            "testsrc2=size=1280x720:rate=24:duration=0.5", "-pix_fmt", "yuv420p", "-c:v", "hevc_nvenc", "-f", "null", "-");
        Assert.NotEqual(0, code);
    }

    private static bool HasNvidiaGpu() => File.Exists("/dev/nvidia0") || File.Exists(@"C:\Windows\System32\nvcuda.dll");

    private static string? Find(string env, string exe)
    {
        string? fromEnv = Environment.GetEnvironmentVariable(env);
        if (!string.IsNullOrEmpty(fromEnv) && File.Exists(fromEnv))
        {
            return fromEnv;
        }

        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator))
        {
            foreach (var name in new[] { exe, exe + ".exe" })
            {
                string p = Path.Combine(dir, name);
                if (File.Exists(p))
                {
                    return p;
                }
            }
        }

        return null;
    }

    private static async Task<(int Code, string Out, string Err)> Run(string exe, params string[] args)
    {
        var psi = new ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args)
        {
            psi.ArgumentList.Add(a);
        }

        using var p = Process.Start(psi)!;
        var o = p.StandardOutput.ReadToEndAsync();
        var e = p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        return (p.ExitCode, await o, await e);
    }
}
