using System.Collections.Concurrent;
using System.Text.Json;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>One time someone watched something: who, what, on which device and app, for how long, and how it was streamed.</summary>
public sealed record WatchRecord
{
    public required Guid UserId { get; init; }

    public required string UserName { get; init; }

    public required Guid ItemId { get; init; }

    public required string Title { get; init; }

    public required string ItemType { get; init; }

    public Guid? SeriesId { get; init; }

    public required string DeviceName { get; init; }

    public required string Client { get; init; }

    public string? RemoteAddress { get; init; }

    /// <summary>Gets "DirectPlay", "DirectStream" or "Transcode".</summary>
    public string? PlayMethod { get; init; }

    /// <summary>Gets the converted picture height when the server was converting, e.g. 720.</summary>
    public int? ConvertedHeight { get; init; }

    public required DateTime StartedUtc { get; init; }

    public DateTime? EndedUtc { get; init; }

    /// <summary>Gets seconds actually spent playing (pauses don't count). Null for entries from the old activity log.</summary>
    public int? WatchedSeconds { get; init; }

    public long? PositionTicks { get; init; }

    public long? RunTimeTicks { get; init; }

    public bool Finished { get; init; }
}

/// <summary>
/// Keeps a watch history by listening to playback start/progress/stop on the server.
/// Stored as one JSON line per finished viewing in the ReelForge data folder; a year is kept.
/// </summary>
public sealed class WatchHistory : IHostedService
{
    private static readonly TimeSpan KeepFor = TimeSpan.FromDays(400);
    private static readonly JsonSerializerOptions Json = new() { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };

    private readonly ISessionManager _sessions;
    private readonly ILogger<WatchHistory> _logger;
    private readonly ConcurrentDictionary<string, Live> _live = new();
    private readonly List<WatchRecord> _records = new();
    private readonly object _gate = new();
    private readonly string _path;

    public WatchHistory(ISessionManager sessions, ILogger<WatchHistory> logger)
    {
        _sessions = sessions;
        _logger = logger;
        _path = Path.Combine(Plugin.Instance?.DataDirectory ?? Path.GetTempPath(), "watch-history.jsonl");
    }

    /// <summary>Gets when history recording started (the oldest record), or null when there's nothing yet.</summary>
    public DateTime? Since
    {
        get
        {
            lock (_gate)
            {
                return _records.Count > 0 ? _records[0].StartedUtc : null;
            }
        }
    }

    /// <summary>Finished viewings since <paramref name="fromUtc"/>, newest first, plus anything playing right now.</summary>
    public IReadOnlyList<WatchRecord> Query(DateTime fromUtc, Guid? userId)
    {
        List<WatchRecord> list;
        lock (_gate)
        {
            list = _records.Where(r => r.StartedUtc >= fromUtc && (userId is null || r.UserId == userId)).ToList();
        }

        list.AddRange(_live.Values.Select(l => l.Snapshot(ended: false)).Where(r => userId is null || r.UserId == userId));
        return list.OrderByDescending(r => r.StartedUtc).ToList();
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        Load();
        _sessions.PlaybackStart += OnStart;
        _sessions.PlaybackProgress += OnProgress;
        _sessions.PlaybackStopped += OnStopped;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _sessions.PlaybackStart -= OnStart;
        _sessions.PlaybackProgress -= OnProgress;
        _sessions.PlaybackStopped -= OnStopped;
        foreach (var key in _live.Keys.ToList())
        {
            if (_live.TryRemove(key, out var l))
            {
                Save(l.Snapshot(ended: true)); // server shutting down mid-film: keep what was watched
            }
        }

        return Task.CompletedTask;
    }

    private static string Key(PlaybackProgressEventArgs e) => $"{e.Session?.Id}|{e.Item?.Id}";

    private void OnStart(object? sender, PlaybackProgressEventArgs e)
    {
        try
        {
            if (e.Item is not Video || e.Session is null || e.Users.Count == 0)
            {
                return;
            }

            // A new start on the same device replaces whatever it was playing before.
            foreach (var other in _live.Where(kv => kv.Key.StartsWith(e.Session.Id + "|", StringComparison.Ordinal)).Select(kv => kv.Key).ToList())
            {
                if (_live.TryRemove(other, out var prev))
                {
                    Save(prev.Snapshot(ended: true));
                }
            }

            _live[Key(e)] = new Live(e);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ReelForge: watch history start failed");
        }
    }

    private void OnProgress(object? sender, PlaybackProgressEventArgs e)
    {
        try
        {
            if (e.Item is not Video || e.Session is null)
            {
                return;
            }

            var live = _live.GetOrAdd(Key(e), _ => new Live(e)); // server restarted mid-film
            live.Update(e, e.IsPaused);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ReelForge: watch history progress failed");
        }
    }

    private void OnStopped(object? sender, PlaybackStopEventArgs e)
    {
        try
        {
            if (!_live.TryRemove(Key(e), out var live))
            {
                return;
            }

            live.Update(e, paused: false);
            live.Finished = e.PlayedToCompletion;
            var record = live.Snapshot(ended: true);
            if (record.WatchedSeconds >= 15)
            {
                Save(record); // "started then backed straight out" isn't worth listing
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ReelForge: watch history stop failed");
        }
    }

    private void Save(WatchRecord r)
    {
        lock (_gate)
        {
            _records.Add(r);
            try
            {
                File.AppendAllText(_path, JsonSerializer.Serialize(r, Json) + "\n");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ReelForge: couldn't save watch history");
            }
        }
    }

    private void Load()
    {
        lock (_gate)
        {
            _records.Clear();
            if (!File.Exists(_path))
            {
                return;
            }

            try
            {
                var cutoff = DateTime.UtcNow - KeepFor;
                int dropped = 0;
                foreach (var line in File.ReadLines(_path))
                {
                    if (string.IsNullOrWhiteSpace(line))
                    {
                        continue;
                    }

                    try
                    {
                        var r = JsonSerializer.Deserialize<WatchRecord>(line, Json);
                        if (r is null || r.StartedUtc < cutoff)
                        {
                            dropped++;
                            continue;
                        }

                        _records.Add(r);
                    }
                    catch (JsonException)
                    {
                        dropped++;
                    }
                }

                _records.Sort((a, b) => a.StartedUtc.CompareTo(b.StartedUtc));
                if (dropped > 0)
                {
                    File.WriteAllLines(_path, _records.Select(r => JsonSerializer.Serialize(r, Json)));
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ReelForge: couldn't read watch history");
            }
        }
    }

    /// <summary>"Dune (2021)" or "Severance · S02E03 · Who Is Alive?".</summary>
    public static string TitleOf(BaseItem item) => item switch
    {
        Episode ep => $"{ep.SeriesName} · S{ep.ParentIndexNumber ?? 0:00}E{ep.IndexNumber ?? 0:00} · {ep.Name}",
        _ when item.ProductionYear is { } y && !(item.Name ?? string.Empty).Contains($"({y})", StringComparison.Ordinal) => $"{item.Name} ({y})",
        _ => item.Name ?? "Unknown",
    };

    private sealed class Live
    {
        private readonly WatchRecord _start;
        private DateTime _lastTick;
        private bool _paused;
        private double _watched;

        public Live(PlaybackProgressEventArgs e)
        {
            var s = e.Session!;
            var item = e.Item!;
            _start = new WatchRecord
            {
                UserId = e.Users[0].Id,
                UserName = s.UserName ?? e.Users[0].Username,
                ItemId = item.Id,
                Title = TitleOf(item),
                ItemType = item.GetBaseItemKind().ToString(),
                SeriesId = item is Episode ep ? ep.SeriesId : null,
                DeviceName = s.DeviceName ?? e.DeviceName ?? "Unknown device",
                Client = s.Client ?? e.ClientName ?? "Unknown app",
                RemoteAddress = s.RemoteEndPoint,
                StartedUtc = DateTime.UtcNow,
                RunTimeTicks = item.RunTimeTicks,
            };
            _lastTick = DateTime.UtcNow;
            Position = e.PlaybackPositionTicks;
            Method = s.PlayState?.PlayMethod?.ToString();
            Height = s.TranscodingInfo?.Height;
        }

        public long? Position { get; private set; }

        public string? Method { get; private set; }

        public int? Height { get; private set; }

        public bool Finished { get; set; }

        public void Update(PlaybackProgressEventArgs e, bool paused)
        {
            lock (this)
            {
                var now = DateTime.UtcNow;
                if (!_paused)
                {
                    // Reports come every few seconds; a long gap means the device went away, so cap it.
                    _watched += Math.Min((now - _lastTick).TotalSeconds, 90);
                }

                _lastTick = now;
                _paused = paused;
                Position = e.PlaybackPositionTicks ?? Position;
                var s = e.Session;
                if (s?.PlayState?.PlayMethod is { } m)
                {
                    Method = m.ToString();
                }

                if (s?.TranscodingInfo?.Height is { } h)
                {
                    Height = h;
                }
            }
        }

        public WatchRecord Snapshot(bool ended)
        {
            lock (this)
            {
                double watched = _watched + (!_paused ? Math.Min((DateTime.UtcNow - _lastTick).TotalSeconds, 90) : 0);
                return _start with
                {
                    EndedUtc = ended ? DateTime.UtcNow : null,
                    WatchedSeconds = (int)watched,
                    PositionTicks = Position,
                    PlayMethod = Method,
                    ConvertedHeight = Method == "Transcode" ? Height : null,
                    Finished = Finished,
                };
            }
        }


    }
}
