using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using ReelForge.Core;
using ReelForge.Services;

namespace ReelForge.Agent;

/// <summary>
/// Checks in with the server every few seconds. When it's handed a file: reads it straight from the
/// server, converts it on this PC's graphics card into a local work folder, sends the result back,
/// and the server checks it and swaps it in. Only outbound connections; nothing listens on this PC.
/// </summary>
public sealed class Worker : BackgroundService
{
    private readonly AgentConfig _config;
    private readonly AgentOptions _options;
    private readonly ILogger<Worker> _logger;
    private readonly HttpClient _http;
    private Capabilities _caps = new(new(), new(), new());
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, Running> _running = new();
    private string? _updateTriedFor;

    private sealed class Running
    {
        public required AgentWork Work { get; init; }

        public required CancellationTokenSource Cancel { get; init; }

        public double Progress { get; set; }

        public double? Speed { get; set; }

        public string Phase { get; set; } = "converting";
    }

    public Worker(AgentConfig config, AgentOptions options, ILogger<Worker> logger)
    {
        _config = config;
        _options = options;
        _logger = logger;
        _http = new HttpClient { BaseAddress = new Uri(config.Server.TrimEnd('/') + "/"), Timeout = Timeout.InfiniteTimeSpan };
        _http.DefaultRequestHeaders.Add(AgentProtocol.AuthHeader, config.Credential);
    }

    public static string Version => typeof(Worker).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";

    private static string WorkDir => Path.Combine(AgentConfig.DataDir, "work");

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        _logger.LogInformation("ReelForge Agent {Version} on {Name}, server {Server}", Version, _config.Name, _config.Server);
        ClearWorkDir();
        _caps = await Probe.RunAsync(_options.Ffmpeg, _options.AllowCpu, stop);
        _logger.LogInformation("Graphics: {Gpus}. Working encoders: {Encoders} (10-bit HEVC: {TenBit})",
            _caps.Gpus.Count > 0 ? string.Join(", ", _caps.Gpus) : "none found", string.Join(", ", _caps.Encoders), string.Join(", ", _caps.TenBitHevc));
        if (_caps.Encoders.Count == 0)
        {
            _logger.LogWarning("No graphics card encoder works on this PC (needs NVIDIA NVENC or AMD AMF and up-to-date drivers). The agent will stay idle.");
        }

        var lastProbe = DateTime.UtcNow;
        while (!stop.IsCancellationRequested)
        {
            int wait = 10;
            try
            {
                // Drivers get updated, cards get swapped: re-test now and then while idle.
                if (_running.IsEmpty && DateTime.UtcNow - lastProbe > TimeSpan.FromHours(6))
                {
                    _caps = await Probe.RunAsync(_options.Ffmpeg, _options.AllowCpu, stop);
                    lastProbe = DateTime.UtcNow;
                }

                var jobs = _running.Values.Select(r => new AgentJobStatus(r.Work.JobId, r.Progress, r.Speed, r.Phase)).ToList();
                var req = new AgentPollRequest(Version, _caps.Gpus, _caps.Encoders, _caps.TenBitHevc, jobs);
                using var resp = await _http.PostAsJsonAsync("ReelForge/AgentApi/Poll", req, stop);
                if (resp.StatusCode == HttpStatusCode.Unauthorized)
                {
                    _logger.LogError("The server no longer knows this agent (removed from Media Manager?). Run the install script again to pair it.");
                    wait = 60;
                }
                else
                {
                    resp.EnsureSuccessStatusCode();
                    var r = (await resp.Content.ReadFromJsonAsync<AgentPollResponse>(stop))!;
                    wait = r.PollSeconds;
                    foreach (var id in r.Stop)
                    {
                        if (_running.TryGetValue(id, out var run))
                        {
                            _logger.LogInformation("Stopping {Title}: cancelled on the server", run.Work.Title);
                            run.Cancel.Cancel();
                        }
                    }

                    foreach (var job in r.Start.Where(j => !_running.ContainsKey(j.JobId)))
                    {
                        Start(job, stop);
                        wait = 1;
                    }

                    if (_running.IsEmpty && r.Start.Count == 0)
                    {
                        await MaybeUpdateAsync(r.ServerVersion, stop);
                    }
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Can't reach the server ({Message}); trying again shortly", ex.Message);
                wait = 15;
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(wait), stop);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        foreach (var r in _running.Values)
        {
            r.Cancel.Cancel();
        }
    }

    private void Start(AgentWork work, CancellationToken stop)
    {
        var run = new Running { Work = work, Cancel = CancellationTokenSource.CreateLinkedTokenSource(stop) };
        _running[work.JobId] = run;
        _ = Task.Run(async () =>
        {
            string output = Path.Combine(WorkDir, $"{work.JobId}.mkv");
            try
            {
                await ConvertAsync(run, output);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("{Title}: stopped", work.Title);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("{Title} failed: {Message}", work.Title, ex.Message);
                try
                {
                    using var _ = await _http.PostAsJsonAsync($"ReelForge/AgentApi/Jobs/{work.JobId}/Failed", new AgentFailRequest(ex.Message), CancellationToken.None);
                }
                catch (Exception)
                {
                    // The server takes it back on its own if it doesn't hear from us.
                }
            }
            finally
            {
                TryDelete(output);
                _running.TryRemove(work.JobId, out _);
                run.Cancel.Dispose();
            }
        });
    }

    private async Task ConvertAsync(Running run, string output)
    {
        var w = run.Work;
        Directory.CreateDirectory(WorkDir);
        long free = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(WorkDir))!).AvailableFreeSpace;
        long reserved = _running.Values.Where(r => r != run).Sum(r => r.Work.EstimatedBytes);
        if (free < (w.EstimatedBytes + reserved) * 1.3 + (1L << 30))
        {
            throw new IOException($"Not enough free space on this PC ({free / 1e9:F1} GB free)");
        }

        string source = $"{_config.Server.TrimEnd('/')}/ReelForge/AgentApi/Jobs/{w.JobId}/Source?token={w.SourceToken}";
        var args = w.Args.Select(a => a == AgentProtocol.Input ? source : a == AgentProtocol.Output ? output : a).ToList();
        _logger.LogInformation("Converting {Title} with {Encoder}", w.Title, w.Encoder);
        var sw = Stopwatch.StartNew();
        await FfmpegRunner.RunAsync(_options.Ffmpeg, args, w.DurationTicks, (p, s) =>
        {
            run.Progress = p;
            if (s is { } speed)
            {
                run.Speed = speed;
            }
        }, run.Cancel.Token);

        run.Phase = "uploading";
        long size = new FileInfo(output).Length;
        _logger.LogInformation("{Title}: converted in {Minutes:F1} min ({MB} MB); sending it back", w.Title, sw.Elapsed.TotalMinutes, size / 1_000_000);
        await using var fs = new FileStream(output, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20, useAsync: true);
        using var content = new StreamContent(fs, 1 << 20);
        content.Headers.ContentLength = size;
        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
        using var resp = await _http.PutAsync($"ReelForge/AgentApi/Jobs/{w.JobId}/Result", content, run.Cancel.Token);
        if (!resp.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"The server didn't take the result ({(int)resp.StatusCode}): {await resp.Content.ReadAsStringAsync()}");
        }

        _logger.LogInformation("{Title}: done", w.Title);
    }

    /// <summary>
    /// Keeps the agent on the same version as the server: downloads that release's agent and swaps it in
    /// (Windows service only; tried once per version).
    /// </summary>
    private async Task MaybeUpdateAsync(string serverVersion, CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows() || !Microsoft.Extensions.Hosting.WindowsServices.WindowsServiceHelpers.IsWindowsService() || _updateTriedFor == serverVersion)
        {
            return;
        }

        if (!System.Version.TryParse(serverVersion, out var sv) || !System.Version.TryParse(Version, out var mine) || sv <= mine || (sv.Major == 0 && sv.Minor <= 1))
        {
            return; // same or older, or a development build with no release to download
        }

        _updateTriedFor = serverVersion;
        string exe = Environment.ProcessPath!;
        string next = Path.Combine(Path.GetDirectoryName(exe)!, "ReelForge.Agent.new.exe");
        string url = $"https://github.com/ReelForge-stream/ReelForge/releases/download/v{serverVersion}/ReelForge-Agent.exe";
        _logger.LogInformation("Server is on {Server}, this agent on {Mine}: updating", serverVersion, Version);
        try
        {
            using var dl = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            await using (var src = await dl.GetStreamAsync(url, ct))
            await using (var dst = File.Create(next))
            {
                await src.CopyToAsync(dst, ct);
            }

            // A small detached script stops the service, swaps the exe and starts it again.
            string script = $"Start-Sleep 2; Stop-Service ReelForgeAgent -Force; Start-Sleep 2; Move-Item -Force '{next}' '{exe}'; Start-Service ReelForgeAgent";
            Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -WindowStyle Hidden -Command \"{script}\"") { UseShellExecute = false, CreateNoWindow = true });
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Couldn't update the agent ({Message}); run the install script again to update it", ex.Message);
            TryDelete(next);
        }
    }

    private static void ClearWorkDir()
    {
        try
        {
            if (Directory.Exists(WorkDir))
            {
                foreach (var f in Directory.EnumerateFiles(WorkDir))
                {
                    TryDelete(f);
                }
            }
        }
        catch (Exception)
        {
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (Exception)
        {
        }
    }
}

public sealed record AgentOptions(string Ffmpeg, bool AllowCpu);
