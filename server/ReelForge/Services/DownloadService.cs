using System.Collections.Concurrent;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ReelForge.Core;

namespace ReelForge.Services;

public enum DownloadState
{
    Waiting,
    Converting,
    Ready,
    Failed,
}

/// <summary>One "convert this for my phone" request. The finished file is kept for a day, then removed.</summary>
public sealed class DownloadJob
{
    public required string Id { get; init; }

    public required Guid UserId { get; init; }

    public required Guid ItemId { get; init; }

    public required string MediaSourceId { get; init; }

    public required string Title { get; init; }

    public required string OptionId { get; init; }

    public required string Label { get; init; }

    public required int AudioIndex { get; init; }

    public required string FileName { get; init; }

    public long EstimatedBytes { get; init; }

    public DownloadState State { get; set; }

    public double Progress { get; set; }

    public int? EtaSeconds { get; set; }

    public long SizeBytes { get; set; }

    public string? Error { get; set; }

    public DateTime CreatedUtc { get; init; } = DateTime.UtcNow;

    public DateTime? FinishedUtc { get; set; }

    public DateTime ExpiresUtc => (FinishedUtc ?? CreatedUtc).Add(DownloadService.KeepFor);

    internal string? OutputPath { get; set; }

    internal CancellationTokenSource Cancel { get; } = new();

    internal string? OutputPathOrNull() => OutputPath is { } p && File.Exists(p) ? p : null;
}

/// <summary>
/// Converts titles into downloads that play on phones and laptops. One conversion runs at a time
/// (on the GPU when there is one), separate from Space Saver, at below-normal priority.
/// </summary>
public sealed class DownloadService : BackgroundService
{
    public static readonly TimeSpan KeepFor = TimeSpan.FromHours(24);
    private const int MaxActivePerUser = 5;

    private readonly ConcurrentDictionary<string, DownloadJob> _jobs = new();
    private readonly SemaphoreSlim _slot = new(1, 1);
    private readonly LibraryReader _reader;
    private readonly EncoderProbe _probe;
    private readonly ILogger<DownloadService> _logger;
    private readonly string _dir;

    public DownloadService(LibraryReader reader, EncoderProbe probe, IApplicationPaths paths, ILogger<DownloadService> logger)
    {
        _reader = reader;
        _probe = probe;
        _logger = logger;
        _dir = Path.Combine(paths.CachePath, "reelforge-downloads");
    }

    public IReadOnlyList<DownloadJob> ForUser(Guid userId) =>
        _jobs.Values.Where(j => j.UserId == userId).OrderByDescending(j => j.CreatedUtc).ToList();

    public DownloadJob? Get(string id) => _jobs.TryGetValue(id, out var j) ? j : null;

    /// <summary>Queues a conversion, or returns the matching one that's already queued or done.</summary>
    public DownloadJob Start(Guid userId, MediaFile file, DownloadOption option, int audioIndex)
    {
        var existing = _jobs.Values.FirstOrDefault(j =>
            j.UserId == userId && j.ItemId == file.ItemId && j.MediaSourceId == file.MediaSourceId
            && j.OptionId == option.Id && j.AudioIndex == audioIndex && j.State != DownloadState.Failed);
        if (existing is not null)
        {
            return existing;
        }

        if (_jobs.Values.Count(j => j.UserId == userId && j.State is DownloadState.Waiting or DownloadState.Converting) >= MaxActivePerUser)
        {
            throw new InvalidOperationException($"You already have {MaxActivePerUser} downloads being prepared. Wait for one to finish first.");
        }

        Directory.CreateDirectory(_dir);
        long? free = FreeSpace.Bytes(_dir);
        if (free is { } f && f < option.EstimatedBytes * 1.2 + 2L * 1024 * 1024 * 1024)
        {
            throw new InvalidOperationException("The server doesn't have enough free disk space to prepare this download.");
        }

        var job = new DownloadJob
        {
            Id = Guid.NewGuid().ToString("N"),
            UserId = userId,
            ItemId = file.ItemId,
            MediaSourceId = file.MediaSourceId,
            Title = file.Title,
            OptionId = option.Id,
            Label = option.Label,
            AudioIndex = audioIndex,
            FileName = DownloadPlan.FileName(file.Title, option.Label),
            EstimatedBytes = option.EstimatedBytes,
            // Only "waiting" when another conversion really is ahead of it.
            State = _slot.CurrentCount > 0 && !_jobs.Values.Any(j => j.State == DownloadState.Waiting) ? DownloadState.Converting : DownloadState.Waiting,
        };
        _jobs[job.Id] = job;
        _ = Task.Run(() => RunAsync(job, file, option));
        return job;
    }

    /// <summary>Cancels a conversion or removes a finished download.</summary>
    public bool Remove(string id, Guid userId)
    {
        if (!_jobs.TryGetValue(id, out var job) || job.UserId != userId)
        {
            return false;
        }

        _jobs.TryRemove(id, out _);
        job.Cancel.Cancel();
        TryDelete(job.OutputPath);
        return true;
    }

    private async Task RunAsync(DownloadJob job, MediaFile file, DownloadOption option)
    {
        string output = Path.Combine(_dir, job.Id + ".mp4");
        job.OutputPath = output;
        try
        {
            await _slot.WaitAsync(job.Cancel.Token).ConfigureAwait(false);
            try
            {
                job.State = DownloadState.Converting;
                var report = await _probe.GetAsync(ct: job.Cancel.Token).ConfigureAwait(false);
                bool nvenc = report.Working.Contains("h264_nvenc");
                if (!nvenc && !report.Working.Contains("libx264"))
                {
                    throw new InvalidOperationException("This server's ffmpeg can't make H.264 video.");
                }

                var args = DownloadPlan.Build(file, option, job.AudioIndex, nvenc ? "h264_nvenc" : "libx264", nvenc, report.CanToneMap, output);
                _logger.LogInformation("ReelForge: preparing download {Title} ({Label}) with {Encoder}", job.Title, job.Label, nvenc ? "NVENC" : "x264");
                try
                {
                    await RunFfmpeg(args, file, job).ConfigureAwait(false);
                }
                catch (InvalidOperationException) when (nvenc && !job.Cancel.IsCancellationRequested)
                {
                    // Some cards can't decode or encode this particular file on the GPU: do it on the processor.
                    _logger.LogInformation("ReelForge: GPU couldn't convert {Title}; retrying on the CPU", job.Title);
                    job.Progress = 0;
                    var cpu = DownloadPlan.Build(file, option, job.AudioIndex, "libx264", false, report.CanToneMap, output);
                    await RunFfmpeg(cpu, file, job).ConfigureAwait(false);
                }

                job.SizeBytes = new FileInfo(output).Length;
                job.Progress = 1;
                job.EtaSeconds = null;
                job.FinishedUtc = DateTime.UtcNow;
                job.State = DownloadState.Ready;
            }
            finally
            {
                _slot.Release();
            }
        }
        catch (OperationCanceledException)
        {
            TryDelete(output);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ReelForge: download conversion failed for {Title}", job.Title);
            job.State = DownloadState.Failed;
            job.Error = ex is InvalidOperationException ? ex.Message : "The conversion failed.";
            job.FinishedUtc = DateTime.UtcNow;
            TryDelete(output);
        }
    }

    private Task RunFfmpeg(IReadOnlyList<string> args, MediaFile file, DownloadJob job) =>
        FfmpegRunner.RunAsync(_probe.FfmpegPath, args, file.DurationTicks, (fraction, speed) =>
        {
            job.Progress = fraction;
            if (speed is { } sp && sp > 0)
            {
                job.EtaSeconds = (int)((1 - fraction) * (file.DurationTicks / 1e7) / sp);
            }
        }, job.Cancel.Token);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Anything left over from before a restart is unreachable now: clear it out.
        try
        {
            if (Directory.Exists(_dir))
            {
                foreach (var f in Directory.EnumerateFiles(_dir))
                {
                    TryDelete(f);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ReelForge: couldn't clear old downloads");
        }

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15));
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
        {
            foreach (var job in _jobs.Values.Where(j => j.State is DownloadState.Ready or DownloadState.Failed && j.ExpiresUtc < DateTime.UtcNow).ToList())
            {
                _jobs.TryRemove(job.Id, out _);
                TryDelete(job.OutputPath);
            }
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        foreach (var j in _jobs.Values)
        {
            j.Cancel.Cancel();
        }

        await base.StopAsync(cancellationToken).ConfigureAwait(false);
    }

    private static void TryDelete(string? path)
    {
        try
        {
            if (path is not null && File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (Exception)
        {
        }
    }

    internal MediaFile? Read(Guid itemId, string? mediaSourceId)
    {
        var versions = _reader.ReadVersions(itemId);
        return versions.FirstOrDefault(v => string.Equals(v.MediaSourceId, mediaSourceId, StringComparison.OrdinalIgnoreCase)) ?? versions.FirstOrDefault();
    }
}
