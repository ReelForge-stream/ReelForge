using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace ReelForge.Core;

/// <summary>A set of files that are the same movie or the same episode.</summary>
public sealed record DuplicateGroup
{
    public required string Key { get; init; }

    public required MediaKind Kind { get; init; }

    public required string Title { get; init; }

    /// <summary>Gets all copies, best first. The first entry is the recommended keeper.</summary>
    public required IReadOnlyList<RankedFile> Files { get; init; }

    /// <summary>
    /// Gets a value indicating whether the copies look like intentionally different cuts
    /// (Director's Cut, Extended, 3D, IMAX...). Such groups are shown but nothing is pre-selected.
    /// </summary>
    public bool LooksLikeEditions { get; init; }

    /// <summary>Gets bytes freed by removing every copy except the keeper.</summary>
    public long ReclaimableBytes => Files.Skip(1).Sum(f => f.File.SizeBytes);
}

public sealed record RankedFile(MediaFile File, double Score, string Summary, bool RecommendedKeep, string? Edition);

/// <summary>
/// Finds duplicate movies and TV episodes. Matching is by identity, never by file name alone:
/// movies by TMDb/IMDb id (falling back to normalized title + year), episodes by series identity
/// + season + episode number. The same path is never counted twice.
/// </summary>
public static partial class DuplicateFinder
{
    public static IReadOnlyList<DuplicateGroup> Find(IEnumerable<MediaFile> files)
    {
        var unique = files
            .Where(f => !string.IsNullOrWhiteSpace(f.Path))
            .GroupBy(f => NormalizePath(f.Path), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First());

        var groups = new List<DuplicateGroup>();
        foreach (var bucket in unique.GroupBy(IdentityKey).Where(g => g.Key is not null && g.Count() > 1))
        {
            var members = bucket.ToList();
            var editions = members.Select(m => DetectEdition(m.FileName)).ToList();
            bool looksLikeEditions = editions.Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1;

            var ranked = members
                .Select((m, i) => (File: m, Score: QualityScorer.Score(m), Edition: editions[i]))
                .OrderByDescending(x => x.Score)
                .ThenBy(x => x.File.SizeBytes) // equal quality: keep the smaller file
                .ThenBy(x => x.File.Path, StringComparer.OrdinalIgnoreCase)
                .Select((x, i) => new RankedFile(
                    x.File,
                    x.Score,
                    QualityScorer.Describe(x.File),
                    RecommendedKeep: i == 0 || looksLikeEditions,
                    x.Edition))
                .ToList();

            var first = ranked[0].File;
            groups.Add(new DuplicateGroup
            {
                Key = bucket.Key!,
                Kind = first.Kind,
                Title = first.Title,
                Files = ranked,
                LooksLikeEditions = looksLikeEditions,
            });
        }

        return groups
            .OrderByDescending(g => g.LooksLikeEditions ? 0 : g.ReclaimableBytes)
            .ThenBy(g => g.Title, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    internal static string? IdentityKey(MediaFile f)
    {
        if (f.Kind == MediaKind.Movie)
        {
            if (TryProvider(f, "Tmdb", out var tmdb))
            {
                return $"movie:tmdb:{tmdb}";
            }

            if (TryProvider(f, "Imdb", out var imdb))
            {
                return $"movie:imdb:{imdb.ToLowerInvariant()}";
            }

            string name = NormalizeTitle(f.Title);
            return name.Length == 0 ? null : $"movie:name:{name}:{f.Year?.ToString(CultureInfo.InvariantCulture) ?? "?"}";
        }

        if (f.SeasonNumber is null || f.EpisodeNumber is null)
        {
            return null; // un-numbered episodes can't be matched safely
        }

        string series;
        if (TryProvider(f, "Tvdb", out var tvdb))
        {
            series = $"tvdb:{tvdb}";
        }
        else if (TryProvider(f, "Tmdb", out var stmdb))
        {
            series = $"tmdb:{stmdb}";
        }
        else if (TryProvider(f, "Imdb", out var simdb))
        {
            series = $"imdb:{simdb.ToLowerInvariant()}";
        }
        else if (!string.IsNullOrWhiteSpace(f.SeriesName) && NormalizeTitle(f.SeriesName).Length > 0)
        {
            // The same show in two folders becomes two separate series in Jellyfin,
            // so without metadata ids the (normalised) series name is the identity.
            series = $"name:{NormalizeTitle(f.SeriesName)}";
        }
        else if (f.SeriesId is { } sid && sid != Guid.Empty)
        {
            series = $"id:{sid:N}";
        }
        else
        {
            return null;
        }

        string range = f.EpisodeNumberEnd is { } end && end != f.EpisodeNumber ? $"-{end}" : string.Empty;
        return $"ep:{series}:s{f.SeasonNumber}:e{f.EpisodeNumber}{range}";
    }

    private static bool TryProvider(MediaFile f, string name, out string value)
    {
        foreach (var kv in f.ProviderIds)
        {
            if (kv.Key.Equals(name, StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(kv.Value))
            {
                value = kv.Value.Trim();
                return true;
            }
        }

        value = string.Empty;
        return false;
    }

    /// <summary>Recognises edition labels so intentional alternate cuts are never auto-selected for deletion.</summary>
    public static string? DetectEdition(string fileName)
    {
        var m = EditionRegex().Match(Path.GetFileNameWithoutExtension(fileName));
        if (!m.Success)
        {
            return null;
        }

        string raw = m.Value.ToLowerInvariant();
        if (raw.Contains("3d", StringComparison.Ordinal) || raw.Contains("sbs", StringComparison.Ordinal) || raw.Contains("hou", StringComparison.Ordinal))
        {
            return "3D";
        }

        if (raw.Contains("director", StringComparison.Ordinal))
        {
            return "Director's Cut";
        }

        if (raw.Contains("extended", StringComparison.Ordinal))
        {
            return "Extended";
        }

        if (raw.Contains("unrated", StringComparison.Ordinal) || raw.Contains("uncut", StringComparison.Ordinal))
        {
            return "Unrated";
        }

        if (raw.Contains("theatrical", StringComparison.Ordinal))
        {
            return "Theatrical";
        }

        if (raw.Contains("imax", StringComparison.Ordinal))
        {
            return "IMAX";
        }

        if (raw.Contains("remaster", StringComparison.Ordinal))
        {
            return "Remastered";
        }

        if (raw.Contains("final", StringComparison.Ordinal))
        {
            return "Final Cut";
        }

        if (raw.Contains("special", StringComparison.Ordinal))
        {
            return "Special Edition";
        }

        return "Edition";
    }

    internal static string NormalizeTitle(string title)
    {
        string decomposed = title.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (char c in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            sb.Append(char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : ' ');
        }

        string s = Spaces().Replace(sb.ToString(), " ").Trim();
        if (s.StartsWith("the ", StringComparison.Ordinal))
        {
            s = s[4..];
        }

        return s.Replace("&", "and", StringComparison.Ordinal);
    }

    private static string NormalizePath(string path) => path.Replace('\\', '/').TrimEnd('/');

    [GeneratedRegex(@"(?<![a-z])(director'?s?[ ._-]?cut|extended([ ._-]?(cut|edition))?|unrated|uncut|theatrical([ ._-]?cut)?|imax|remaster(ed)?|final[ ._-]?cut|special[ ._-]?edition|\{edition-[^}]+\}|[ ._-]3d([ ._-]|$)|half[ ._-]?(sbs|ou)|\bh?sbs\b|\bh?ou\b)(?![a-z])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex EditionRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
