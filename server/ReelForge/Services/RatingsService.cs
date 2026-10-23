using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>IMDb, Rotten Tomatoes and Metacritic scores for a title. Null means "not known".</summary>
public sealed record Ratings
{
    public string? ImdbId { get; init; }

    public double? Imdb { get; init; }

    public int? ImdbVotes { get; init; }

    /// <summary>Gets the Rotten Tomatoes Tomatometer, 0-100.</summary>
    public int? RottenTomatoes { get; init; }

    public int? Metacritic { get; init; }

    /// <summary>Gets where these came from: "omdb" (IMDb/RT via OMDb) or "library" (what the server already has, source unknown).</summary>
    public string Source { get; init; } = "library";

    /// <summary>Gets the library's own community rating when there's no IMDb score (usually TMDb's).</summary>
    public double? Community { get; init; }

    public DateTime FetchedUtc { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// Looks up IMDb and Rotten Tomatoes ratings through OMDb (needs a free key) and caches them for a week
/// in ratings.json, so each title costs about one lookup a week. Without a key, falls back to the
/// critic and community ratings the library already has.
/// </summary>
public sealed class RatingsService
{
    private static readonly TimeSpan Fresh = TimeSpan.FromDays(7);
    private static readonly TimeSpan RetryMissing = TimeSpan.FromDays(1);
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(8) };
    private readonly ConcurrentDictionary<string, Ratings> _cache;
    private readonly ILogger<RatingsService> _logger;
    private readonly string _path;
    private readonly SemaphoreSlim _saveGate = new(1, 1);
    private DateTime _limitedUntil = DateTime.MinValue;

    public RatingsService(ILogger<RatingsService> logger)
    {
        _logger = logger;
        _path = Path.Combine(Plugin.Instance?.DataDirectory ?? Path.GetTempPath(), "ratings.json");
        _cache = Load();
    }

    private static string Key => Plugin.Instance?.Configuration.OmdbApiKey?.Trim() ?? string.Empty;

    public async Task<Ratings> GetAsync(BaseItem item, CancellationToken ct)
    {
        // Episodes without their own IMDb id use the show's.
        string? imdb = item.GetProviderId(MetadataProvider.Imdb);
        if (string.IsNullOrEmpty(imdb) && item is Episode ep)
        {
            imdb = ep.Series?.GetProviderId(MetadataProvider.Imdb);
        }

        var library = new Ratings
        {
            ImdbId = imdb,
            RottenTomatoes = item.CriticRating is { } c ? (int)Math.Round(c) : null,
            Community = item.CommunityRating is { } r ? Math.Round(r, 1) : null,
            Source = "library",
        };

        if (string.IsNullOrEmpty(imdb) || Key.Length == 0)
        {
            return library;
        }

        if (_cache.TryGetValue(imdb, out var cached) && DateTime.UtcNow - cached.FetchedUtc < (cached.Imdb is null ? RetryMissing : Fresh))
        {
            return Merge(cached, library);
        }

        if (DateTime.UtcNow < _limitedUntil)
        {
            return cached is not null ? Merge(cached, library) : library; // daily limit hit: try again tomorrow
        }

        try
        {
            using var resp = await Http.GetAsync($"https://www.omdbapi.com/?i={Uri.EscapeDataString(imdb)}&apikey={Uri.EscapeDataString(Key)}", ct).ConfigureAwait(false);
            string body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var parsed = Parse(imdb, body, out string? error);
            if (parsed is null)
            {
                if (error?.Contains("limit", StringComparison.OrdinalIgnoreCase) == true)
                {
                    _limitedUntil = DateTime.UtcNow.AddHours(6);
                }

                _logger.LogDebug("ReelForge: OMDb had no ratings for {Imdb}: {Error}", imdb, error);
                parsed = new Ratings { ImdbId = imdb, Source = "omdb" }; // remember the miss for a day
            }

            _cache[imdb] = parsed;
            _ = SaveAsync();
            return Merge(parsed, library);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogDebug("ReelForge: OMDb lookup failed for {Imdb}: {Message}", imdb, ex.Message);
            return cached is not null ? Merge(cached, library) : library;
        }
    }

    /// <summary>OMDb's answer has the RT score etc. as text: "93%", "81/100", "7.8", "1,234,567".</summary>
    internal static Ratings? Parse(string imdbId, string json, out string? error)
    {
        error = null;
        try
        {
            var o = JsonSerializer.Deserialize<OmdbResponse>(json);
            if (o is null || !string.Equals(o.Response, "True", StringComparison.OrdinalIgnoreCase))
            {
                error = o?.Error ?? "no response";
                return null;
            }

            int? rt = null;
            int? mc = null;
            foreach (var r in o.Ratings ?? new())
            {
                if (r.Source == "Rotten Tomatoes" && int.TryParse(r.Value?.TrimEnd('%'), NumberStyles.Integer, CultureInfo.InvariantCulture, out int pct))
                {
                    rt = pct;
                }
                else if (r.Source == "Metacritic" && int.TryParse(r.Value?.Split('/')[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out int m))
                {
                    mc = m;
                }
            }

            return new Ratings
            {
                ImdbId = imdbId,
                Imdb = double.TryParse(o.ImdbRating, NumberStyles.Float, CultureInfo.InvariantCulture, out double i) ? i : null,
                ImdbVotes = int.TryParse(o.ImdbVotes?.Replace(",", string.Empty, StringComparison.Ordinal), NumberStyles.Integer, CultureInfo.InvariantCulture, out int v) ? v : null,
                RottenTomatoes = rt,
                Metacritic = mc ?? (int.TryParse(o.Metascore, NumberStyles.Integer, CultureInfo.InvariantCulture, out int ms) ? ms : null),
                Source = "omdb",
            };
        }
        catch (JsonException)
        {
            error = "unreadable answer";
            return null;
        }
    }

    /// <summary>OMDb wins where it has a value; the library fills the gaps.</summary>
    private static Ratings Merge(Ratings omdb, Ratings library) => omdb with
    {
        RottenTomatoes = omdb.RottenTomatoes ?? library.RottenTomatoes,
        Community = omdb.Imdb is null ? library.Community : null,
    };

    /// <summary>Checks a key with a known title, for the settings page.</summary>
    public static async Task<string?> TestKeyAsync(string key, CancellationToken ct)
    {
        try
        {
            // OMDb answers a bad key with 401 and a JSON explanation, so read the body whatever the status.
            using var resp = await Http.GetAsync($"https://www.omdbapi.com/?i=tt0111161&apikey={Uri.EscapeDataString(key.Trim())}", ct).ConfigureAwait(false);
            string body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (Parse("tt0111161", body, out string? error) is not null)
            {
                return null;
            }

            return error is { Length: > 0 } e ? $"OMDb says: {e.TrimEnd('!')}. Check the key (it's in the email OMDb sent, and needs activating from that email first)." : "OMDb didn't accept that key.";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return "This server couldn't reach omdbapi.com: " + ex.Message;
        }
    }

    private ConcurrentDictionary<string, Ratings> Load()
    {
        try
        {
            if (File.Exists(_path) && JsonSerializer.Deserialize<Dictionary<string, Ratings>>(File.ReadAllText(_path)) is { } d)
            {
                return new ConcurrentDictionary<string, Ratings>(d);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ReelForge: ratings cache unreadable; starting fresh");
        }

        return new ConcurrentDictionary<string, Ratings>();
    }

    private async Task SaveAsync()
    {
        if (!await _saveGate.WaitAsync(0).ConfigureAwait(false))
        {
            return;
        }

        try
        {
            await Task.Delay(2000).ConfigureAwait(false); // batch up a few lookups
            string tmp = _path + ".tmp";
            await File.WriteAllTextAsync(tmp, JsonSerializer.Serialize(_cache)).ConfigureAwait(false);
            File.Move(tmp, _path, true);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ReelForge: couldn't save the ratings cache");
        }
        finally
        {
            _saveGate.Release();
        }
    }

    private sealed class OmdbResponse
    {
        public string? Response { get; set; }

        public string? Error { get; set; }

        [JsonPropertyName("imdbRating")]
        public string? ImdbRating { get; set; }

        [JsonPropertyName("imdbVotes")]
        public string? ImdbVotes { get; set; }

        public string? Metascore { get; set; }

        public List<OmdbRating>? Ratings { get; set; }
    }

    private sealed class OmdbRating
    {
        public string? Source { get; set; }

        public string? Value { get; set; }
    }
}
