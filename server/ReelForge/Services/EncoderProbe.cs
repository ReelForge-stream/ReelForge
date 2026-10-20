using System.Diagnostics;
using ReelForge.Core;
using MediaBrowser.Controller.MediaEncoding;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

public sealed record EncoderReport
{
    public string? GpuName { get; init; }

    public string? DriverVersion { get; init; }

    /// <summary>Gets encoders that passed a real test encode on this machine (not just "compiled in").</summary>
    public IReadOnlyCollection<string> Working { get; init; } = Array.Empty<string>();

    public bool HevcNvenc10Bit { get; init; }

    public string Summary { get; init; } = string.Empty;
}

/// <summary>
/// Finds out what this machine can really encode with. ffmpeg being *built* with NVENC says nothing
/// about the installed card (a Fermi-era Quadro has no NVENC at all; Pascal has HEVC but not AV1;
/// only Ada/Blackwell have AV1), so each encoder gets a half-second live test.
/// </summary>
public sealed class EncoderProbe
{
    private readonly IMediaEncoder _mediaEncoder;
    private readonly ILogger<EncoderProbe> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private EncoderReport? _cached;

    public EncoderProbe(IMediaEncoder mediaEncoder, ILogger<EncoderProbe> logger)
    {
        _mediaEncoder = mediaEncoder;
        _logger = logger;
    }

    public string FfmpegPath => _mediaEncoder.EncoderPath;

    public string FfprobePath => _mediaEncoder.ProbePath;

    public async Task<EncoderReport> GetAsync(bool refresh = false, CancellationToken ct = default)
    {
        if (_cached is not null && !refresh)
        {
            return _cached;
        }

        await _lock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (_cached is not null && !refresh)
            {
                return _cached;
            }

            var (gpu, driver) = await QueryNvidiaSmiAsync(ct).ConfigureAwait(false);
            var working = new HashSet<string>(StringComparer.Ordinal);
            foreach (var enc in new[] { "hevc_nvenc", "av1_nvenc", "libx265", "libsvtav1" })
            {
                if (await TestEncodeAsync(enc, "yuv420p", ct).ConfigureAwait(false))
                {
                    working.Add(enc);
                }
            }

            bool hevc10 = working.Contains("hevc_nvenc") && await TestEncodeAsync("hevc_nvenc", "p010le", ct).ConfigureAwait(false);

            string summary = working.Contains("hevc_nvenc")
                ? $"GPU conversion ready on {gpu ?? "NVIDIA GPU"}" + (working.Contains("av1_nvenc") ? " (HEVC + AV1)" : " (HEVC)")
                : gpu is not null
                    ? $"{gpu} found but it can't encode HEVC (needs a Pascal or newer card). Using the CPU instead — much slower."
                    : "No NVIDIA encoder found. Conversions will use the CPU — much slower.";

            _cached = new EncoderReport
            {
                GpuName = gpu,
                DriverVersion = driver,
                Working = working,
                HevcNvenc10Bit = hevc10,
                Summary = summary,
            };
            _logger.LogInformation("ReelForge encoders: {Summary} [{List}]", summary, string.Join(", ", working));
            return _cached;
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task<bool> TestEncodeAsync(string encoder, string pixFmt, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(FfmpegPath))
        {
            return false;
        }

        var psi = new ProcessStartInfo(FfmpegPath)
        {
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var arg in new[]
                 {
                     "-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
                     "testsrc2=size=1280x720:rate=24:duration=0.5", "-pix_fmt", pixFmt, "-c:v", encoder, "-f", "null", "-",
                 })
        {
            psi.ArgumentList.Add(arg);
        }

        try
        {
            using var p = Process.Start(psi);
            if (p is null)
            {
                return false;
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            _ = p.StandardOutput.ReadToEndAsync(timeout.Token);
            string err = await p.StandardError.ReadToEndAsync(timeout.Token).ConfigureAwait(false);
            await p.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            if (p.ExitCode != 0)
            {
                _logger.LogDebug("ReelForge: {Encoder}/{Fmt} test failed: {Err}", encoder, pixFmt, err.Trim());
            }

            return p.ExitCode == 0;
        }
        catch (Exception ex) when (ex is OperationCanceledException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return false;
        }
    }

    private static async Task<(string? Gpu, string? Driver)> QueryNvidiaSmiAsync(CancellationToken ct)
    {
        try
        {
            var psi = new ProcessStartInfo("nvidia-smi")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("--query-gpu=name,driver_version");
            psi.ArgumentList.Add("--format=csv,noheader");
            using var p = Process.Start(psi);
            if (p is null)
            {
                return (null, null);
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            string line = (await p.StandardOutput.ReadToEndAsync(timeout.Token).ConfigureAwait(false)).Split('\n')[0].Trim();
            await p.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            var parts = line.Split(',', StringSplitOptions.TrimEntries);
            return parts.Length >= 2 && p.ExitCode == 0 ? (parts[0], parts[1]) : (null, null);
        }
        catch (Exception)
        {
            return (null, null);
        }
    }

    /// <summary>Picks the encoder for one file, dropping to CPU for 10-bit sources if the card can't do 10-bit HEVC.</summary>
    public static EncoderChoice? ChooseFor(MediaFile f, ConversionSettings s, EncoderReport report)
    {
        var working = new HashSet<string>(report.Working, StringComparer.Ordinal);
        bool tenBit = f.BitDepth >= 10 || f.Range is DynamicRange.Hdr10 or DynamicRange.Hlg;
        if (tenBit && s.Codec == TargetCodec.Hevc && !report.HevcNvenc10Bit)
        {
            working.Remove("hevc_nvenc");
        }

        return FfmpegArgs.Choose(s.Codec, working);
    }
}
