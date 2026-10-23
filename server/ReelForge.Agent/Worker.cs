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

        public string Phase { get; set; } = "downloading";

        public long? BytesDone { get; set; }

        public long? BytesTotal { get; set; }

        public double? BytesPerSecond { get; set; }

        public AgentJobStatus Status() => new(Work.JobId, Progress, Speed, Phase, BytesDone, BytesTotal, BytesPerSecond);
    }

    /// <summary>A transfer that moves no bytes for this long is dropped and tried again.</summary>
    internal static TimeSpan TransferStallTimeout { get; set; } = TimeSpan.FromMinutes(2);

    /// <summary>ffmpeg that makes no headway for this long is stopped (stuck driver, unreadable file).</summary>
    internal static TimeSpan FfmpegStallTimeout { get; set; } = TimeSpan.FromMinutes(5);

    private const int TransferAttempts = 4;

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

                var jobs = _running.Values.Select(r => r.Status()).ToList();
                var req = new AgentPollRequest(Version, _caps.Gpus, _caps.Encoders, _caps.TenBitHevc, jobs);
                // The client has no overall timeout (transfers can take hours), so each check-in gets its own.
                using var pollTimeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
                pollTimeout.CancelAfter(TimeSpan.FromSeconds(60));
                using var resp = await _http.PostAsJsonAsync("ReelForge/AgentApi/Poll", req, pollTimeout.Token);
                if (resp.StatusCode == HttpStatusCode.Unauthorized)
                {
                    _logger.LogError("The server no longer knows this agent (removed from Media Manager?). Run the install script again to pair it.");
                    wait = 60;
                }
                else
                {
                    resp.EnsureSuccessStatusCode();
                    var r = (await resp.Content.ReadFromJsonAsync<AgentPollResponse>(pollTimeout.Token))!;
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
            string input = Path.Combine(WorkDir, $"{work.JobId}.source");
            try
            {
                await ConvertAsync(run, input, output);
            }
            catch (OperationCanceledException) when (run.Cancel.IsCancellationRequested)
            {
                _logger.LogInformation("{Title}: stopped", work.Title);
            }
            catch (Exception ex)
            {
                string message = ex is OperationCanceledException
                    ? $"{(run.Phase == "uploading" ? "Sending it back" : run.Phase == "downloading" ? "Copying the original" : "It")} stopped moving ({TransferAttempts} tries)"
                    : ex.Message;
                _logger.LogWarning("{Title} failed while {Phase}: {Message}", work.Title, run.Phase, message);
                try
                {
                    using var _ = await _http.PostAsJsonAsync($"ReelForge/AgentApi/Jobs/{work.JobId}/Failed", new AgentFailRequest(message), CancellationToken.None);
                }
                catch (Exception)
                {
                    // The server takes it back on its own if it doesn't hear from us.
                }
            }
            finally
            {
                TryDelete(output);
                TryDelete(input);
                _running.TryRemove(work.JobId, out _);
                run.Cancel.Dispose();
            }
        });
    }

    private async Task ConvertAsync(Running run, string input, string output)
    {
        var w = run.Work;
        var ct = run.Cancel.Token;
        Directory.CreateDirectory(WorkDir);
        long free = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(WorkDir))!).AvailableFreeSpace;
        long reserved = _running.Values.Where(r => r != run).Sum(r => r.Work.EstimatedBytes + r.Work.SourceBytes);
        long needOutput = (long)((w.EstimatedBytes + reserved) * 1.3) + (1L << 30);
        if (free < needOutput)
        {
            throw new IOException($"Not enough free space on this PC ({free / 1e9:F1} GB free)");
        }

        // Copy the file here first so the conversion runs at the card's speed and a network blip can't hang ffmpeg.
        // Too big for this disk (or an older server that doesn't say the size): read it over the network instead.
        string sourceUrl = $"{_config.Server.TrimEnd('/')}/ReelForge/AgentApi/Jobs/{w.JobId}/Source?token={w.SourceToken}";
        string ffmpegInput = sourceUrl;
        if (w.SourceBytes > 0 && free >= needOutput + w.SourceBytes)
        {
            await DownloadAsync(run, $"ReelForge/AgentApi/Jobs/{w.JobId}/Source?token={w.SourceToken}", input, w.SourceBytes, ct);
            ffmpegInput = input;
        }
        else
        {
            _logger.LogInformation("{Title}: reading it over the network ({Reason})", w.Title, w.SourceBytes > 0 ? "not enough room to copy it here" : "server didn't give the size");
        }

        run.Phase = "converting";
        run.Progress = 0;
        run.BytesDone = run.BytesTotal = null;
        run.BytesPerSecond = null;
        var args = w.Args.Select(a => a == AgentProtocol.Input ? ffmpegInput : a == AgentProtocol.Output ? output : a).ToList();
        _logger.LogInformation("Converting {Title} with {Encoder}", w.Title, w.Encoder);
        var sw = Stopwatch.StartNew();
        await FfmpegRunner.RunAsync(_options.Ffmpeg, args, w.DurationTicks, (p, s) =>
        {
            run.Progress = p;
            if (s is { } speed)
            {
                run.Speed = speed;
            }
        }, ct, FfmpegStallTimeout);
        TryDelete(input);

        long size = new FileInfo(output).Length;
        _logger.LogInformation("{Title}: converted in {Minutes:F1} min ({MB} MB); sending it back", w.Title, sw.Elapsed.TotalMinutes, size / 1_000_000);
        run.Phase = "uploading";
        run.Speed = null;
        await UploadAsync(run, $"ReelForge/AgentApi/Jobs/{w.JobId}/Result", output, size, ct);
        _logger.LogInformation("{Title}: done", w.Title);
    }

    /// <summary>Fetches the original, resuming where it left off if the connection drops or stalls.</summary>
    private async Task DownloadAsync(Running run, string url, string path, long total, CancellationToken ct)
    {
        run.Phase = "downloading";
        run.BytesTotal = total;
        run.BytesDone = 0;
        _logger.LogInformation("{Title}: copying the original here ({MB} MB)", run.Work.Title, total / 1_000_000);
        var sw = Stopwatch.StartNew();
        for (int attempt = 1; ; attempt++)
        {
            long have = File.Exists(path) ? new FileInfo(path).Length : 0;
            try
            {
                using var stall = new StallGuard(TransferStallTimeout, ct);
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                if (have > 0)
                {
                    req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(have, null);
                }

                using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, stall.Token);
                if (!resp.IsSuccessStatusCode)
                {
                    throw new HttpRequestException($"the server answered {(int)resp.StatusCode} {resp.ReasonPhrase}", null, resp.StatusCode);
                }

                bool resumed = have > 0 && resp.StatusCode == HttpStatusCode.PartialContent;
                await using var src = await resp.Content.ReadAsStreamAsync(stall.Token);
                await using var dst = new FileStream(path, resumed ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20, useAsync: true);
                long done = resumed ? have : 0;
                var meter = new RateMeter(done);
                var buf = new byte[1 << 20];
                int n;
                while ((n = await src.ReadAsync(buf, stall.Token)) > 0)
                {
                    await dst.WriteAsync(buf.AsMemory(0, n), stall.Token);
                    done += n;
                    stall.Moved();
                    run.BytesDone = done;
                    run.Progress = Math.Min(0.999, (double)done / total);
                    run.BytesPerSecond = meter.Update(done);
                }

                if (done < total)
                {
                    throw new IOException($"the copy ended early ({done / 1_000_000} of {total / 1_000_000} MB)");
                }

                _logger.LogInformation("{Title}: copied in {Minutes:F1} min ({Rate:F0} MB/s)", run.Work.Title, sw.Elapsed.TotalMinutes, total / 1e6 / Math.Max(1, sw.Elapsed.TotalSeconds));
                return;
            }
            catch (Exception ex) when (!ct.IsCancellationRequested && attempt < TransferAttempts && ex is IOException or HttpRequestException or OperationCanceledException)
            {
                string why = ex is OperationCanceledException ? $"no data for {TransferStallTimeout.TotalMinutes:0} min" : ex.Message;
                _logger.LogWarning("{Title}: copying the original stalled ({Why}); trying again ({Attempt} of {Max})", run.Work.Title, why, attempt + 1, TransferAttempts);
                await Task.Delay(TimeSpan.FromSeconds(5 * attempt), ct);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new IOException($"Copying the original from the server stopped moving (no data for {TransferStallTimeout.TotalMinutes:0} minutes, {TransferAttempts} tries)");
            }
        }
    }

    /// <summary>
    /// Sends the converted file back in pieces of a few dozen MB, so it gets through proxies (Cloudflare and
    /// the like cap a single upload at ~100 MB) and a dropped connection only costs the current piece.
    /// </summary>
    private async Task UploadAsync(Running run, string url, string path, long size, CancellationToken ct)
    {
        run.BytesTotal = size;
        var sw = Stopwatch.StartNew();
        AgentUploadState? state = null;
        for (int attempt = 1; state is null; attempt++)
        {
            try
            {
                using var stall = new StallGuard(TransferStallTimeout, ct);
                using var resp = await _http.GetAsync($"{url}/Part", stall.Token);
                if (resp.StatusCode == HttpStatusCode.NotFound)
                {
                    _logger.LogInformation("{Title}: the server is an older version; sending the file in one go", run.Work.Title);
                    await UploadWholeAsync(run, url, path, size, ct);
                    return;
                }

                await ThrowIfRejected(resp);
                state = await resp.Content.ReadFromJsonAsync<AgentUploadState>(stall.Token);
            }
            catch (Exception ex) when (Retryable(ex, ct, attempt))
            {
                await NoteRetry(run, "sending it back", ex, attempt, ct);
            }
        }

        int part = Math.Clamp(state.MaxPart, 1 << 20, 64 << 20);
        long sent = Math.Min(state.Received, size);
        var meter = new RateMeter(sent);
        await using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20, useAsync: true);
        var buf = new byte[part];
        int failures = 0;
        while (sent < size)
        {
            int n = (int)Math.Min(part, size - sent);
            fs.Position = sent;
            await fs.ReadExactlyAsync(buf.AsMemory(0, n), ct);
            try
            {
                using var stall = new StallGuard(TransferStallTimeout, ct);
                long baseSent = sent;
                await using var body = new ProgressStream(new MemoryStream(buf, 0, n, writable: false), done =>
                {
                    stall.Moved();
                    run.BytesDone = baseSent + done;
                    run.Progress = Math.Min(0.999, (double)(baseSent + done) / size);
                    run.BytesPerSecond = meter.Update(baseSent + done);
                });
                using var content = new StreamContent(body, 1 << 20);
                content.Headers.ContentLength = n;
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                using var resp = await _http.PutAsync($"{url}/Part?offset={sent}", content, stall.Token);
                if (resp.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
                {
                    // Out of step with the server (a piece got lost): carry on from what it actually has.
                    var have = await resp.Content.ReadFromJsonAsync<AgentUploadState>(CancellationToken.None);
                    sent = Math.Min(have?.Received ?? 0, size);
                    continue;
                }

                await ThrowIfRejected(resp);
                var got = await resp.Content.ReadFromJsonAsync<AgentUploadState>(stall.Token);
                sent = got?.Received ?? sent + n;
                run.BytesDone = sent;
                failures = 0;
            }
            catch (Exception ex) when (Retryable(ex, ct, ++failures))
            {
                await NoteRetry(run, "sending it back", ex, failures, ct);
            }
        }

        run.Progress = 0.999;
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                using var stall = new StallGuard(TransferStallTimeout, ct);
                using var resp = await _http.PostAsync($"{url}/Done?size={size}", null, stall.Token);
                await ThrowIfRejected(resp);
                break;
            }
            catch (Exception ex) when (Retryable(ex, ct, attempt))
            {
                await NoteRetry(run, "finishing the upload", ex, attempt, ct);
            }
        }

        _logger.LogInformation("{Title}: sent back in {Minutes:F1} min ({Rate:F1} MB/s)", run.Work.Title, sw.Elapsed.TotalMinutes, size / 1e6 / Math.Max(1, sw.Elapsed.TotalSeconds));
    }

    /// <summary>For servers from before piecewise uploads: one PUT, started over if it stalls.</summary>
    private async Task UploadWholeAsync(Running run, string url, string path, long size, CancellationToken ct)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                using var stall = new StallGuard(TransferStallTimeout, ct);
                var meter = new RateMeter(0);
                await using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20, useAsync: true);
                await using var counting = new ProgressStream(fs, done =>
                {
                    stall.Moved();
                    run.BytesDone = done;
                    run.Progress = Math.Min(0.999, (double)done / size);
                    run.BytesPerSecond = meter.Update(done);
                });
                using var content = new StreamContent(counting, 1 << 20);
                content.Headers.ContentLength = size;
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                using var resp = await _http.PutAsync(url, content, stall.Token);
                await ThrowIfRejected(resp);
                return;
            }
            catch (Exception ex) when (Retryable(ex, ct, attempt))
            {
                await NoteRetry(run, "sending it back", ex, attempt, ct);
            }
        }
    }

    private static async Task ThrowIfRejected(HttpResponseMessage resp)
    {
        if (resp.IsSuccessStatusCode)
        {
            return;
        }

        string body = await resp.Content.ReadAsStringAsync(CancellationToken.None);
        if (body.Length > 300)
        {
            body = body[..300]; // proxies answer with whole HTML pages
        }

        var code = resp.StatusCode;
        if (code == HttpStatusCode.Conflict || code == HttpStatusCode.Unauthorized || code == HttpStatusCode.RequestEntityTooLarge)
        {
            string hint = code == HttpStatusCode.RequestEntityTooLarge ? " Something between this PC and the server (a proxy such as Cloudflare?) limits upload size; pair the agent with the server's local address." : string.Empty;
            throw new InvalidOperationException($"The server didn't take it ({(int)code}): {body}{hint}");
        }

        throw new HttpRequestException($"the server answered {(int)code} {resp.ReasonPhrase}", null, code);
    }

    private static bool Retryable(Exception ex, CancellationToken ct, int attempt) =>
        !ct.IsCancellationRequested && ex is IOException or HttpRequestException or OperationCanceledException && attempt < TransferAttempts;

    private async Task NoteRetry(Running run, string what, Exception ex, int attempt, CancellationToken ct)
    {
        string why = ex is OperationCanceledException ? $"no data moved for {TransferStallTimeout.TotalMinutes:0} min" : ex.Message;
        _logger.LogWarning("{Title}: {What} stalled ({Why}); trying again ({Attempt} of {Max})", run.Work.Title, what, why, attempt + 1, TransferAttempts);
        await Task.Delay(TimeSpan.FromSeconds(Math.Min(5 * attempt, 30)), ct);
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
