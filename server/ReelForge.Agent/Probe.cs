using System.Diagnostics;

namespace ReelForge.Agent;

/// <summary>What this PC can do: a real test encode on each encoder, so only working ones are offered.</summary>
public sealed record Capabilities(List<string> Gpus, List<string> Encoders, List<string> TenBitHevc);

public static class Probe
{
    private static readonly string[] GpuEncoders = ["hevc_nvenc", "av1_nvenc", "hevc_amf", "av1_amf"];
    private static readonly string[] CpuEncoders = ["libx265", "libsvtav1"];

    public static async Task<Capabilities> RunAsync(string ffmpeg, bool includeCpu, CancellationToken ct)
    {
        var encoders = new List<string>();
        foreach (var e in includeCpu ? GpuEncoders.Concat(CpuEncoders) : GpuEncoders)
        {
            if (await TestAsync(ffmpeg, e, "yuv420p", ct))
            {
                encoders.Add(e);
            }
        }

        var tenBit = new List<string>();
        foreach (var e in encoders.Where(e => e is "hevc_nvenc" or "hevc_amf"))
        {
            if (await TestAsync(ffmpeg, e, "p010le", ct))
            {
                tenBit.Add(e);
            }
        }

        return new Capabilities(await GpuNamesAsync(ct), encoders, tenBit);
    }

    private static async Task<bool> TestAsync(string ffmpeg, string encoder, string pixFmt, CancellationToken ct)
    {
        var (code, _) = await RunAsync(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=0.5", "-pix_fmt", pixFmt, "-c:v", encoder, "-f", "null", "-"], ct);
        return code == 0;
    }

    private static async Task<List<string>> GpuNamesAsync(CancellationToken ct)
    {
        if (OperatingSystem.IsWindows())
        {
            var (code, output) = await RunAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_VideoController).Name"], ct);
            if (code == 0)
            {
                return output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(n => !n.Contains("Basic Display", StringComparison.OrdinalIgnoreCase) && !n.Contains("Remote", StringComparison.OrdinalIgnoreCase))
                    .Distinct().ToList();
            }
        }
        else
        {
            var (code, output) = await RunAsync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], ct);
            if (code == 0)
            {
                return output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
            }
        }

        return new List<string>();
    }

    internal static async Task<(int Code, string Output)> RunAsync(string exe, string[] args, CancellationToken ct)
    {
        try
        {
            var psi = new ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            foreach (var a in args)
            {
                psi.ArgumentList.Add(a);
            }

            using var p = Process.Start(psi);
            if (p is null)
            {
                return (-1, string.Empty);
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            var err = p.StandardError.ReadToEndAsync(timeout.Token);
            string output = await p.StandardOutput.ReadToEndAsync(timeout.Token);
            await p.WaitForExitAsync(timeout.Token);
            await err;
            return (p.ExitCode, output);
        }
        catch (Exception)
        {
            return (-1, string.Empty);
        }
    }
}
