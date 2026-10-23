using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>One finished Space Saver conversion and what it saved.</summary>
public sealed record SavingsEntry
{
    public required DateTime FinishedUtc { get; init; }

    public required Guid ItemId { get; init; }

    public required string Title { get; init; }

    /// <summary>Gets where the converted file now lives.</summary>
    public required string Path { get; init; }

    public required long OriginalBytes { get; init; }

    public required long NewBytes { get; init; }

    public string? Encoder { get; init; }

    public long SavedBytes => Math.Max(0, OriginalBytes - NewBytes);
}

/// <summary>An entry with the running total of everything saved up to and including it.</summary>
public sealed record SavingsRow(SavingsEntry Entry, long SavedBytes, long RunningTotalBytes);

public sealed record SavingsSummary(long TotalSavedBytes, int Conversions, long OriginalBytes, long NewBytes, DateTime? Since, IReadOnlyList<SavingsRow> Rows);

/// <summary>
/// A permanent tally of space saved, one JSON line per conversion in the ReelForge data folder.
/// Unlike the queue (which forgets finished jobs after 45 minutes) this is never trimmed.
/// </summary>
public sealed class SavingsLedger
{
    private readonly List<SavingsEntry> _entries = new();
    private readonly object _gate = new();
    private readonly ILogger<SavingsLedger> _logger;
    private readonly string _path;

    public SavingsLedger(ILogger<SavingsLedger> logger)
        : this(logger, System.IO.Path.Combine(Plugin.Instance?.DataDirectory ?? System.IO.Path.GetTempPath(), "space-saved.jsonl"))
    {
    }

    internal SavingsLedger(ILogger<SavingsLedger> logger, string path)
    {
        _logger = logger;
        _path = path;
        Load();
    }

    public bool IsEmpty
    {
        get
        {
            lock (_gate)
            {
                return _entries.Count == 0 && !File.Exists(_path);
            }
        }
    }

    public void Add(SavingsEntry e)
    {
        lock (_gate)
        {
            _entries.Add(e);
            try
            {
                File.AppendAllText(_path, JsonSerializer.Serialize(e) + "\n");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ReelForge: couldn't record space saved for {Title}", e.Title);
            }
        }
    }

    /// <summary>Totals plus every conversion, newest first, each with the running total up to that point.</summary>
    public SavingsSummary Summary(int limit = 1000)
    {
        List<SavingsEntry> list;
        lock (_gate)
        {
            list = _entries.OrderBy(e => e.FinishedUtc).ToList();
        }

        long running = 0;
        var rows = new List<SavingsRow>(list.Count);
        foreach (var e in list)
        {
            running += e.SavedBytes;
            rows.Add(new SavingsRow(e, e.SavedBytes, running));
        }

        rows.Reverse();
        return new SavingsSummary(
            running,
            list.Count,
            list.Sum(e => e.OriginalBytes),
            list.Sum(e => e.NewBytes),
            list.Count > 0 ? list[0].FinishedUtc : null,
            rows.Take(limit).ToList());
    }

    private void Load()
    {
        if (!File.Exists(_path))
        {
            return;
        }

        try
        {
            foreach (var line in File.ReadLines(_path))
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                try
                {
                    if (JsonSerializer.Deserialize<SavingsEntry>(line) is { } e)
                    {
                        _entries.Add(e);
                    }
                }
                catch (JsonException)
                {
                    // A half-written last line after a power cut: skip it.
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ReelForge: couldn't read the space-saved tally");
        }
    }
}
