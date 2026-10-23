using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace ReelForge.Services;

/// <summary>Runs one ffmpeg job at low priority, reporting progress from its -progress output.</summary>
internal static class FfmpegRunner
{
    /// <summary>
    /// Runs ffmpeg to completion. <paramref name="onProgress"/> gets (fraction 0..0.999, speed or null).
    /// Throws when ffmpeg fails (with the last lines of its error output) or when cancelled.
    /// </summary>
    public static async Task RunAsync(string ffmpegPath, IReadOnlyList<string> args, long durationTicks, Action<double, double?> onProgress, CancellationToken ct, TimeSpan? stallTimeout = null)
    {
        var psi = new ProcessStartInfo(ffmpegPath)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in args)
        {
            psi.ArgumentList.Add(a);
        }

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Could not start ffmpeg");
        try
        {
            // Stay out of the way of live streaming transcodes.
            p.PriorityClass = ProcessPriorityClass.BelowNormal;
        }
        catch (Exception)
        {
        }

        void Kill()
        {
            try
            {
                p.Kill(entireProcessTree: true);
            }
            catch (Exception)
            {
            }
        }

        using var reg = ct.Register(Kill);

        // Watchdog: ffmpeg that stops moving forward (stuck input, hung driver) is stopped instead of waiting forever.
        long lastMoveTicks = Environment.TickCount64;
        bool stalled = false;
        using var watchdog = stallTimeout is { } limit
            ? new Timer(_ =>
            {
                if (Environment.TickCount64 - Interlocked.Read(ref lastMoveTicks) > limit.TotalMilliseconds && !p.HasExited)
                {
                    stalled = true;
                    Kill();
                }
            }, null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(15))
            : null;

        var errTail = new StringBuilder();
        var errTask = Task.Run(async () =>
        {
            string? line;
            while ((line = await p.StandardError.ReadLineAsync(CancellationToken.None).ConfigureAwait(false)) is not null)
            {
                lock (errTail)
                {
                    errTail.AppendLine(line);
                    if (errTail.Length > 4000)
                    {
                        errTail.Remove(0, errTail.Length - 4000);
                    }
                }
            }
        }, CancellationToken.None);

        double totalUs = Math.Max(1, durationTicks / 10.0);
        double fraction = 0;
        string? outLine;
        while ((outLine = await p.StandardOutput.ReadLineAsync(CancellationToken.None).ConfigureAwait(false)) is not null)
        {
            var (us, speed) = ParseProgressLine(outLine);
            if (us is { } u)
            {
                double f = Math.Clamp(u / totalUs, 0, 0.999);
                if (f > fraction)
                {
                    Interlocked.Exchange(ref lastMoveTicks, Environment.TickCount64);
                }

                fraction = f;
                onProgress(fraction, null);
            }

            if (speed is { } sp && sp > 0)
            {
                onProgress(fraction, sp);
            }
        }

        await p.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
        await errTask.ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        if (stalled)
        {
            throw new InvalidOperationException($"ffmpeg stopped making progress for {stallTimeout!.Value.TotalMinutes:0} minutes at {fraction:P0} and was stopped");
        }

        if (p.ExitCode != 0)
        {
            string err;
            lock (errTail)
            {
                err = errTail.ToString().Trim();
            }

            throw new InvalidOperationException($"ffmpeg failed ({p.ExitCode}): {LastLines(err, 3)}");
        }
    }

    internal static (double? OutTimeUs, double? Speed) ParseProgressLine(string line)
    {
        int eq = line.IndexOf('=', StringComparison.Ordinal);
        if (eq <= 0)
        {
            return (null, null);
        }

        string key = line[..eq].Trim();
        string val = line[(eq + 1)..].Trim();
        if (key is "out_time_us" or "out_time_ms" && double.TryParse(val, NumberStyles.Float, CultureInfo.InvariantCulture, out var us) && us >= 0)
        {
            return (us, null); // ffmpeg's out_time_ms is (despite the name) microseconds too
        }

        if (key == "speed" && double.TryParse(val.TrimEnd('x', 'X'), NumberStyles.Float, CultureInfo.InvariantCulture, out var sp))
        {
            return (null, sp);
        }

        return (null, null);
    }

    internal static string LastLines(string s, int n) =>
        string.Join(" | ", s.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).TakeLast(n));
}
