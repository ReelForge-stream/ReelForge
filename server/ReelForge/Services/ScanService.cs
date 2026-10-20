using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>Live progress of one scan, updated by the scan as it works.</summary>
public sealed class ScanProgress
{
    private int _done;
    private int _total;
    private volatile string _phase = "Starting";

    public string Phase { get => _phase; set => _phase = value; }

    public int Done => Volatile.Read(ref _done);

    public int Total => Volatile.Read(ref _total);

    /// <summary>Starts a new phase with a known amount of work (0 = unknown, shown as an animated bar).</summary>
    public void Begin(string phase, int total)
    {
        _phase = phase;
        Volatile.Write(ref _done, 0);
        Volatile.Write(ref _total, total);
    }

    public void Step(int by = 1) => Interlocked.Add(ref _done, by);

    public void Report(int done, int total)
    {
        Volatile.Write(ref _total, total);
        Volatile.Write(ref _done, done);
    }
}

public enum ScanState { Running, Done, Failed, Cancelled }

public sealed record ScanStatus(
    string Id,
    string Kind,
    ScanState State,
    string Phase,
    int Done,
    int Total,
    DateTime StartedUtc,
    DateTime? FinishedUtc,
    string? Error,
    object? Result);

/// <summary>
/// Runs the Media Manager's library scans in the background so the page can show progress, and keeps
/// recent results for a few minutes so coming back to a page is instant.
/// </summary>
public sealed class ScanService
{
    private static readonly TimeSpan KeepFor = TimeSpan.FromMinutes(10);
    private readonly ConcurrentDictionary<string, Scan> _byKey = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, Scan> _byId = new(StringComparer.OrdinalIgnoreCase);
    private readonly ILogger<ScanService> _logger;

    public ScanService(ILogger<ScanService> logger) => _logger = logger;

    private sealed class Scan
    {
        public required string Id { get; init; }
        public required string Key { get; init; }
        public required string Kind { get; init; }
        public ScanProgress Progress { get; } = new();
        public CancellationTokenSource Cts { get; } = new();
        public DateTime StartedUtc { get; } = DateTime.UtcNow;
        public DateTime? FinishedUtc { get; set; }
        public volatile ScanState State = ScanState.Running;
        public string? Error { get; set; }
        public object? Result { get; set; }
    }

    /// <summary>
    /// Starts a scan, or returns the one already running for the same key, or a recent finished one
    /// (unless <paramref name="fresh"/>).
    /// </summary>
    public ScanStatus Start(string kind, string key, bool fresh, Func<ScanProgress, CancellationToken, Task<object>> work)
    {
        if (_byKey.TryGetValue(key, out var existing))
        {
            bool recent = existing.State == ScanState.Done && DateTime.UtcNow - existing.FinishedUtc < KeepFor;
            if (existing.State == ScanState.Running || (recent && !fresh))
            {
                return Snapshot(existing, includeResult: false);
            }
        }

        var scan = new Scan { Id = Guid.NewGuid().ToString("N"), Key = key, Kind = kind };
        _byKey[key] = scan;
        _byId[scan.Id] = scan;
        Prune();

        _ = Task.Run(async () =>
        {
            try
            {
                scan.Result = await work(scan.Progress, scan.Cts.Token).ConfigureAwait(false);
                scan.State = ScanState.Done;
            }
            catch (OperationCanceledException)
            {
                scan.State = ScanState.Cancelled;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ReelForge: {Kind} scan failed", kind);
                scan.Error = ex.Message;
                scan.State = ScanState.Failed;
            }
            finally
            {
                scan.FinishedUtc = DateTime.UtcNow;
            }
        });

        return Snapshot(scan, includeResult: false);
    }

    public ScanStatus? Get(string id) => _byId.TryGetValue(id, out var s) ? Snapshot(s, includeResult: true) : null;

    public bool Cancel(string id)
    {
        if (!_byId.TryGetValue(id, out var s) || s.State != ScanState.Running)
        {
            return false;
        }

        s.Cts.Cancel();
        return true;
    }

    /// <summary>Forget finished results of this kind of scan (e.g. after files were removed or converted).</summary>
    public void Invalidate(string kind)
    {
        foreach (var (key, scan) in _byKey)
        {
            if (string.Equals(scan.Kind, kind, StringComparison.OrdinalIgnoreCase) && scan.State != ScanState.Running)
            {
                _byKey.TryRemove(key, out _);
            }
        }
    }

    private void Prune()
    {
        foreach (var (id, scan) in _byId)
        {
            if (scan.FinishedUtc is { } f && DateTime.UtcNow - f > KeepFor * 2)
            {
                _byId.TryRemove(id, out _);
            }
        }
    }

    private static ScanStatus Snapshot(Scan s, bool includeResult) => new(
        s.Id,
        s.Kind,
        s.State,
        s.Progress.Phase,
        s.Progress.Done,
        s.Progress.Total,
        s.StartedUtc,
        s.FinishedUtc,
        s.Error,
        includeResult && s.State == ScanState.Done ? s.Result : null);
}
