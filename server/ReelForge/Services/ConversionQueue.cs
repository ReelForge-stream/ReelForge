using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using ReelForge.Core;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.IO;
using MediaBrowser.Controller.Session;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum JobStatus
{
    Queued,
    Running,
    Verifying,
    Done,
    Failed,
    Cancelled
}

public sealed class ConversionJob
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N")[..12];

    public Guid ItemId { get; init; }

    public string MediaSourceId { get; init; } = string.Empty;

    public string Title { get; init; } = string.Empty;

    public string Path { get; set; } = string.Empty;

    public long OriginalBytes { get; set; }

    public long EstimatedBytes { get; set; }

    public long? ResultBytes { get; set; }

    public JobStatus Status { get; set; } = JobStatus.Queued;

    /// <summary>Gets or sets progress from 0 to 1.</summary>
    public double Progress { get; set; }

    /// <summary>Gets or sets the encode speed as a multiple of real time, e.g. 6.2 = 6.2x.</summary>
    public double Speed { get; set; }

    public int? EtaSeconds { get; set; }

    public string? Encoder { get; set; }

    public string? Message { get; set; }

    public TargetCodec Codec { get; init; }

    public QualityPreset Preset { get; init; }

    public bool IncludeHdr { get; init; }

    public DateTime CreatedUtc { get; init; } = DateTime.UtcNow;

    public DateTime? StartedUtc { get; set; }

    public DateTime? FinishedUtc { get; set; }

    [JsonIgnore]
    internal CancellationTokenSource? Cancel { get; set; }
}

/// <summary>
/// The Space Saver engine. Runs queued conversions in the background on the GPU, never while
/// someone is watching (configurable), verifies every output before touching the original,
/// then swaps the new file in and parks the original in the holding area.
/// </summary>
public sealed class ConversionQueue : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, Converters = { new JsonStringEnumConverter() } };

    private readonly LibraryReader _reader;
    private readonly HoldingArea _holding;
    private readonly EncoderProbe _probe;
    private readonly ISessionManager _sessions;
    private readonly ILibraryManager _library;
    private readonly IProviderManager _providers;
    private readonly IFileSystem _fileSystem;
    private readonly ILogger<ConversionQueue> _logger;
    private readonly object _gate = new();
    private readonly string _statePath;
    private readonly List<ConversionJob> _jobs;
    private int _running;
    private bool _scanPending;
    private DateTime _lastSave = DateTime.MinValue;
    private DateTime _lastPurge = DateTime.MinValue;

    public ConversionQueue(
        LibraryReader reader,
        HoldingArea holding,
        EncoderProbe probe,
        ISessionManager sessions,
        ILibraryManager library,
        IProviderManager providers,
        IFileSystem fileSystem,
        ILogger<ConversionQueue> logger)
    {
        _providers = providers;
        _fileSystem = fileSystem;
        _reader = reader;
        _holding = holding;
        _probe = probe;
        _sessions = sessions;
        _library = library;
        _logger = logger;
        string dir = Plugin.Instance?.DataDirectory ?? System.IO.Path.Combine(System.IO.Path.GetTempPath(), "reelforge");
        Directory.CreateDirectory(dir);
        _statePath = System.IO.Path.Combine(dir, "jobs.json");
        _jobs = LoadJobs();
    }

    /// <summary>Gets or sets a value indicating whether the queue is paused by the user.</summary>
    public bool Paused { get; set; }

    /// <summary>Gets why the queue is idle right now, if it is waiting on something.</summary>
    public string? WaitingReason { get; private set; }

    private static PluginConfiguration Config => Plugin.Instance?.Configuration ?? new PluginConfiguration();

    public IReadOnlyList<ConversionJob> List()
    {
        lock (_gate)
        {
            return _jobs.OrderBy(j => j.Status switch
                {
                    JobStatus.Running or JobStatus.Verifying => 0,
                    JobStatus.Queued => 1,
                    _ => 2,
                })
                .ThenByDescending(j => j.Status is JobStatus.Queued ? DateTime.MinValue : j.FinishedUtc ?? j.CreatedUtc)
                .ThenBy(j => j.CreatedUtc)
                .ToList();
        }
    }

    public IReadOnlyList<ConversionJob> Enqueue(IEnumerable<(Guid ItemId, string MediaSourceId)> items)
    {
        var settings = Config.ToSettings();
        var added = new List<ConversionJob>();
        lock (_gate)
        {
            foreach (var (itemId, sourceId) in items)
            {
                if (_jobs.Any(j => j.MediaSourceId == sourceId && j.Status is JobStatus.Queued or JobStatus.Running or JobStatus.Verifying))
                {
                    continue;
                }

                var file = _reader.ReadOne(itemId, sourceId);
                if (file is null)
                {
                    continue;
                }

                var est = SpaceSaverEstimator.Estimate(file, settings);
                var job = new ConversionJob
                {
                    ItemId = itemId,
                    MediaSourceId = sourceId,
                    Title = file.Title,
                    Path = file.Path,
                    OriginalBytes = file.SizeBytes,
                    EstimatedBytes = est.EstimatedSizeBytes,
                    Codec = settings.Codec,
                    Preset = settings.Preset,
                    IncludeHdr = settings.IncludeHdr,
                    Message = est.IsCandidate ? null : $"Note: {est.Reason}",
                };
                _jobs.Add(job);
                added.Add(job);
            }

            SaveJobs(force: true);
        }

        return added;
    }

    public bool CancelJob(string id)
    {
        lock (_gate)
        {
            var job = _jobs.FirstOrDefault(j => j.Id == id);
            if (job is null)
            {
                return false;
            }

            if (job.Status == JobStatus.Queued)
            {
                job.Status = JobStatus.Cancelled;
                job.FinishedUtc = DateTime.UtcNow;
            }
            else
            {
                job.Cancel?.Cancel();
            }

            SaveJobs(force: true);
            return true;
        }
    }

    /// <summary>Removes finished, failed and cancelled jobs from the list.</summary>
    public int ClearFinished()
    {
        lock (_gate)
        {
            int n = _jobs.RemoveAll(j => j.Status is JobStatus.Done or JobStatus.Failed or JobStatus.Cancelled);
            SaveJobs(force: true);
            return n;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let Jellyfin finish starting up first.
        await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken).ConfigureAwait(false);
        await _probe.GetAsync(ct: stoppingToken).ConfigureAwait(false);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                Housekeeping();
                ConversionJob? next = null;
                WaitingReason = WhyWait();
                if (WaitingReason is null && Volatile.Read(ref _running) < Math.Clamp(Config.MaxConcurrentJobs, 1, 4))
                {
                    lock (_gate)
                    {
                        next = _jobs.FirstOrDefault(j => j.Status == JobStatus.Queued);
                        if (next is not null)
                        {
                            next.Status = JobStatus.Running;
                            next.StartedUtc = DateTime.UtcNow;
                            next.Cancel = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                            Interlocked.Increment(ref _running);
                        }
                    }
                }

                if (next is not null)
                {
                    _ = Task.Run(() => RunJobAsync(next), CancellationToken.None);
                }
                else if (Volatile.Read(ref _running) == 0 && _scanPending)
                {
                    _scanPending = false;
                    _library.QueueLibraryScan();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ReelForge: queue loop error");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken).ConfigureAwait(false);
        }
    }

    private string? WhyWait()
    {
        if (Paused)
        {
            return "Paused";
        }

        var c = Config;
        if (c.WindowStartHour is >= 0 and <= 23 && c.WindowEndHour is >= 0 and <= 23 && c.WindowStartHour != c.WindowEndHour)
        {
            int h = DateTime.Now.Hour;
            bool inside = c.WindowStartHour < c.WindowEndHour
                ? h >= c.WindowStartHour && h < c.WindowEndHour
                : h >= c.WindowStartHour || h < c.WindowEndHour; // window crosses midnight, e.g. 23 → 7
            if (!inside)
            {
                return $"Waiting for the conversion window ({c.WindowStartHour:00}:00–{c.WindowEndHour:00}:00)";
            }
        }

        if (c.PauseWhileStreaming && _sessions.Sessions.Any(s => s.NowPlayingItem is not null))
        {
            return "Someone is watching — conversions resume when playback stops";
        }

        return null;
    }

    private void Housekeeping()
    {
        if (DateTime.UtcNow - _lastPurge < TimeSpan.FromHours(1))
        {
            return;
        }

        _lastPurge = DateTime.UtcNow;
        try
        {
            long freed = _holding.PurgeExpired(Config.HoldingDays);
            if (freed > 0)
            {
                _logger.LogInformation("ReelForge: holding area released {GB:F1} GB", freed / 1e9);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ReelForge: holding area cleanup failed");
        }
    }

    private async Task RunJobAsync(ConversionJob job)
    {
        string? tempPath = null;
        var ct = job.Cancel!.Token;
        try
        {
            var settings = new ConversionSettings { Codec = job.Codec, Preset = job.Preset, IncludeHdr = job.IncludeHdr };
            var file = _reader.ReadOne(job.ItemId, job.MediaSourceId)
                       ?? throw new InvalidOperationException("Item is no longer in the library");
            if (!File.Exists(file.Path))
            {
                throw new FileNotFoundException("File is missing from disk", file.Path);
            }

            job.Path = file.Path;
            job.OriginalBytes = new FileInfo(file.Path).Length;
            var estimate = SpaceSaverEstimator.Estimate(file, settings);
            if (!estimate.IsCandidate)
            {
                throw new InvalidOperationException($"Skipped: {estimate.Reason}");
            }

            var report = await _probe.GetAsync(ct: ct).ConfigureAwait(false);
            var encoder = EncoderProbe.ChooseFor(file, settings, report)
                          ?? throw new InvalidOperationException("No working encoder for this format on this machine");
            job.Encoder = encoder.VideoEncoder;

            string dir = System.IO.Path.GetDirectoryName(file.Path)!;
            long? free = FreeSpace.Bytes(dir);
            if (free is { } bytesFree && bytesFree < estimate.EstimatedSizeBytes * 1.3 + (512L * 1024 * 1024))
            {
                throw new IOException("Not enough free space on that drive to write the converted copy");
            }

            tempPath = System.IO.Path.Combine(dir, System.IO.Path.GetFileNameWithoutExtension(file.Path) + ".reelforge-tmp");
            var args = FfmpegArgs.Build(file, settings, encoder, estimate.TargetVideoBitrate, tempPath);
            await RunFfmpegAsync(job, file, args, ct).ConfigureAwait(false);

            job.Status = JobStatus.Verifying;
            job.Progress = 1;
            SaveJobs(force: true);
            await VerifyAsync(file, tempPath, ct).ConfigureAwait(false);

            long newSize = new FileInfo(tempPath).Length;
            if (newSize >= job.OriginalBytes * 0.95)
            {
                File.Delete(tempPath);
                throw new InvalidOperationException("Converted copy wasn't meaningfully smaller — kept the original");
            }

            _holding.LibraryRoots = _reader.GetLibraries().SelectMany(l => l.Locations).ToList();
            Swap(file, tempPath, job);
            tempPath = null;
            RefreshItem(job);
            job.ResultBytes = newSize;
            job.Status = JobStatus.Done;
            job.Message = $"Saved {(job.OriginalBytes - newSize) / 1e9:F2} GB";
            _scanPending = true;
        }
        catch (OperationCanceledException)
        {
            job.Status = JobStatus.Cancelled;
            job.Message = "Cancelled";
        }
        catch (Exception ex)
        {
            job.Status = JobStatus.Failed;
            job.Message = ex.Message;
            _logger.LogWarning(ex, "ReelForge: conversion failed for {Path}", job.Path);
        }
        finally
        {
            if (tempPath is not null && File.Exists(tempPath))
            {
                try
                {
                    File.Delete(tempPath);
                }
                catch (IOException)
                {
                }
            }

            job.FinishedUtc = DateTime.UtcNow;
            job.EtaSeconds = null;
            job.Cancel?.Dispose();
            job.Cancel = null;
            Interlocked.Decrement(ref _running);
            SaveJobs(force: true);
        }
    }

    private Task RunFfmpegAsync(ConversionJob job, MediaFile file, IReadOnlyList<string> args, CancellationToken ct) =>
        FfmpegRunner.RunAsync(_probe.FfmpegPath, args, file.DurationTicks, (fraction, speed) =>
        {
            job.Progress = fraction;
            if (speed is { } sp)
            {
                job.Speed = sp;
                job.EtaSeconds = (int)((1 - fraction) * (file.DurationTicks / 1e7) / sp);
            }

            SaveJobs(force: false);
        }, ct);

    internal static (double? OutTimeUs, double? Speed) ParseProgressLine(string line) => FfmpegRunner.ParseProgressLine(line);

    private async Task VerifyAsync(MediaFile source, string outputPath, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(_probe.FfprobePath)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in new[] { "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", outputPath })
        {
            psi.ArgumentList.Add(a);
        }

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Could not start ffprobe");
        string json = await p.StandardOutput.ReadToEndAsync(ct).ConfigureAwait(false);
        await p.WaitForExitAsync(ct).ConfigureAwait(false);
        var result = CheckProbe(source, json);
        if (result is not null)
        {
            throw new InvalidOperationException($"Verification failed: {result}");
        }
    }

    /// <summary>Returns null when the probed output is a faithful copy of the source, else the problem.</summary>
    internal static string? CheckProbe(MediaFile source, string ffprobeJson)
    {
        using var doc = JsonDocument.Parse(ffprobeJson);
        var root = doc.RootElement;
        double duration = 0;
        if (root.TryGetProperty("format", out var fmt) && fmt.TryGetProperty("duration", out var d))
        {
            double.TryParse(d.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out duration);
        }

        int video = 0, audio = 0, subs = 0;
        if (root.TryGetProperty("streams", out var streams))
        {
            foreach (var s in streams.EnumerateArray())
            {
                switch (s.GetProperty("codec_type").GetString())
                {
                    case "video": video++; break;
                    case "audio": audio++; break;
                    case "subtitle": subs++; break;
                }
            }
        }

        double expected = source.Duration.TotalSeconds;
        double tolerance = Math.Max(2.0, expected * 0.005);
        if (video < 1)
        {
            return "no video stream in output";
        }

        if (Math.Abs(duration - expected) > tolerance)
        {
            return $"length is {duration:F0}s, expected {expected:F0}s";
        }

        if (audio != source.AudioTracks.Count)
        {
            return $"audio tracks: found {audio}, expected {source.AudioTracks.Count}";
        }

        int expectedSubs = source.SubtitleTracks.Count(t => !t.IsExternal);
        if (subs != expectedSubs)
        {
            return $"subtitle tracks: found {subs}, expected {expectedSubs}";
        }

        return null;
    }

    /// <summary>
    /// Puts the converted file where the original was (as .mkv, same name so external subtitles
    /// still match), keeps the original's dates so "Recently added" doesn't change, and parks the
    /// original in the holding area. Any failure rolls back.
    /// </summary>
    private void Swap(MediaFile file, string tempPath, ConversionJob job)
    {
        string finalPath = System.IO.Path.ChangeExtension(file.Path, ".mkv");
        if (!finalPath.Equals(file.Path, StringComparison.OrdinalIgnoreCase) && File.Exists(finalPath))
        {
            throw new IOException($"A different file already exists at {System.IO.Path.GetFileName(finalPath)}");
        }

        var created = File.GetCreationTimeUtc(file.Path);
        // Always park the original first (even with a 0-day setting) so a failed move can roll back.
        var held = _holding.Remove(file.Path, file.Title, "Replaced by converted copy", holdingDays: 1, includeSidecars: false)!;
        try
        {
            File.Move(tempPath, finalPath);
        }
        catch
        {
            _holding.Restore(held.Id);
            throw;
        }

        if (Config.HoldingDays <= 0)
        {
            _holding.Purge(held.Id);
        }

        // Keep the creation date so "Recently added" doesn't reshuffle. The modified date is left
        // as now on purpose: that is how Jellyfin notices the file changed and re-reads it.
        if (OperatingSystem.IsWindows())
        {
            try
            {
                File.SetCreationTimeUtc(finalPath, created);
            }
            catch (Exception)
            {
            }
        }

        job.Path = finalPath;
    }

    /// <summary>Asks Jellyfin to re-read the file now (codec, size, bitrate) instead of waiting for a scan.</summary>
    private void RefreshItem(ConversionJob job)
    {
        try
        {
            var options = new MetadataRefreshOptions(new DirectoryService(_fileSystem))
            {
                MetadataRefreshMode = MetadataRefreshMode.Default,
                ReplaceAllMetadata = false,
            };
            _providers.QueueRefresh(job.ItemId, options, RefreshPriority.High);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ReelForge: refresh request failed for {Item}; the library scan will catch it", job.ItemId);
        }
    }

    private static string LastLines(string s, int n) =>
        string.Join(" | ", s.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).TakeLast(n));

    private List<ConversionJob> LoadJobs()
    {
        try
        {
            if (!File.Exists(_statePath))
            {
                return new List<ConversionJob>();
            }

            var jobs = JsonSerializer.Deserialize<List<ConversionJob>>(File.ReadAllText(_statePath), Json) ?? new List<ConversionJob>();
            foreach (var j in jobs.Where(j => j.Status is JobStatus.Running or JobStatus.Verifying))
            {
                // Server restarted mid-encode: start that file over.
                j.Status = JobStatus.Queued;
                j.Progress = 0;
                j.Message = "Restarted after server restart";
                string tmp = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(j.Path) ?? string.Empty, System.IO.Path.GetFileNameWithoutExtension(j.Path) + ".reelforge-tmp");
                if (File.Exists(tmp))
                {
                    File.Delete(tmp);
                }
            }

            return jobs;
        }
        catch (Exception)
        {
            return new List<ConversionJob>();
        }
    }

    private void SaveJobs(bool force)
    {
        lock (_gate)
        {
            if (!force && DateTime.UtcNow - _lastSave < TimeSpan.FromSeconds(10))
            {
                return;
            }

            _lastSave = DateTime.UtcNow;
            try
            {
                string tmp = _statePath + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(_jobs, Json));
                File.Move(tmp, _statePath, true);
            }
            catch (IOException ex)
            {
                _logger.LogWarning(ex, "ReelForge: could not save job list");
            }
        }
    }
}
