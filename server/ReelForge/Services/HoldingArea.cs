using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

public sealed record HeldFile
{
    public required string Id { get; init; }

    public required string Title { get; init; }

    public required string OriginalPath { get; init; }

    public required string HeldPath { get; init; }

    public required long SizeBytes { get; init; }

    /// <summary>Gets why it was removed: "Duplicate" or "Replaced by converted copy".</summary>
    public required string Reason { get; init; }

    public required DateTime HeldAtUtc { get; init; }

    /// <summary>Gets subtitle/NFO/artwork files that belonged only to this file and were moved with it.</summary>
    public IReadOnlyList<SidecarMove> Sidecars { get; init; } = Array.Empty<SidecarMove>();
}

public sealed record SidecarMove(string OriginalPath, string HeldPath);

/// <summary>
/// Nothing ReelForge removes is deleted on the spot. Files are moved into a hidden
/// ".reelforge-holding" folder on the same drive (an instant rename, no copying) and kept for
/// the configured number of days, so any removal can be undone from the UI. Jellyfin ignores
/// dot-folders, so held files never show up in the library.
/// </summary>
public sealed class HoldingArea
{
    private const string FolderName = ".reelforge-holding";
    private static readonly string[] SidecarExtensions =
        [".srt", ".ass", ".ssa", ".sub", ".idx", ".vtt", ".sup", ".smi", ".nfo", ".jpg", ".jpeg", ".png", ".webp", ".tbn", ".bif"];

    private static readonly string[] VideoExtensions =
        [".mkv", ".mp4", ".m4v", ".avi", ".mov", ".wmv", ".ts", ".m2ts", ".mpg", ".mpeg", ".webm", ".iso", ".divx", ".flv", ".vob", ".ogm"];

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    private readonly ILogger<HoldingArea> _logger;
    private readonly object _gate = new();
    private readonly string _manifestPath;
    private List<HeldFile> _entries;

    public HoldingArea(ILogger<HoldingArea> logger)
        : this(logger, Plugin.Instance?.DataDirectory ?? Path.Combine(Path.GetTempPath(), "reelforge"))
    {
    }

    internal HoldingArea(ILogger<HoldingArea> logger, string dataDirectory)
    {
        _logger = logger;
        Directory.CreateDirectory(dataDirectory);
        _manifestPath = Path.Combine(dataDirectory, "holding.json");
        _entries = Load(_manifestPath);
    }

    public IReadOnlyList<HeldFile> List()
    {
        lock (_gate)
        {
            return _entries.OrderByDescending(e => e.HeldAtUtc).ToList();
        }
    }

    /// <summary>
    /// Removes a media file from the library: moves it (and sidecars that belong only to it) into
    /// the holding area, or deletes it outright when <paramref name="holdingDays"/> is 0.
    /// </summary>
    /// <summary>
    /// Gets or sets library root folders. The holding folder goes in the library root that contains
    /// the file, which is all but guaranteed to be the same disk, so "removing" is an instant rename.
    /// </summary>
    public IReadOnlyList<string> LibraryRoots { get; set; } = Array.Empty<string>();

    public HeldFile? Remove(string path, string title, string reason, int holdingDays, bool includeSidecars)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException("File no longer exists", path);
        }

        long size = new FileInfo(path).Length;
        var sidecars = includeSidecars ? FindExclusiveSidecars(path) : new List<string>();

        if (holdingDays <= 0)
        {
            File.Delete(path);
            foreach (var s in sidecars)
            {
                TryDelete(s);
            }

            _logger.LogInformation("ReelForge: permanently deleted {Path} ({Reason})", path, reason);
            return null;
        }

        string id = Guid.NewGuid().ToString("N")[..12];
        string bucket = HoldingDirectoryFor(path, id, LibraryRoots);
        string heldPath = Path.Combine(bucket, Path.GetFileName(path));
        File.Move(path, heldPath);

        var moved = new List<SidecarMove>();
        foreach (var s in sidecars)
        {
            try
            {
                string dest = Path.Combine(bucket, Path.GetFileName(s));
                File.Move(s, dest);
                moved.Add(new SidecarMove(s, dest));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ReelForge: could not move sidecar {Path}", s);
            }
        }

        var entry = new HeldFile
        {
            Id = id,
            Title = title,
            OriginalPath = path,
            HeldPath = heldPath,
            SizeBytes = size,
            Reason = reason,
            HeldAtUtc = DateTime.UtcNow,
            Sidecars = moved,
        };

        lock (_gate)
        {
            _entries.Add(entry);
            Save();
        }

        _logger.LogInformation("ReelForge: moved {Path} to holding ({Reason})", path, reason);
        return entry;
    }

    /// <summary>Puts a held file back exactly where it was.</summary>
    public void Restore(string id)
    {
        HeldFile entry;
        lock (_gate)
        {
            entry = _entries.FirstOrDefault(e => e.Id == id) ?? throw new KeyNotFoundException("Not in the holding area");
        }

        if (File.Exists(entry.OriginalPath))
        {
            throw new IOException($"Something already exists at {entry.OriginalPath}; move it first.");
        }

        Directory.CreateDirectory(Path.GetDirectoryName(entry.OriginalPath)!);
        File.Move(entry.HeldPath, entry.OriginalPath);
        foreach (var s in entry.Sidecars)
        {
            if (File.Exists(s.HeldPath) && !File.Exists(s.OriginalPath))
            {
                File.Move(s.HeldPath, s.OriginalPath);
            }
        }

        TryDeleteEmptyUpwards(Path.GetDirectoryName(entry.HeldPath)!);
        lock (_gate)
        {
            _entries.RemoveAll(e => e.Id == id);
            Save();
        }
    }

    /// <summary>Permanently deletes one held file.</summary>
    public void Purge(string id)
    {
        HeldFile? entry;
        lock (_gate)
        {
            entry = _entries.FirstOrDefault(e => e.Id == id);
        }

        if (entry is null)
        {
            return;
        }

        TryDelete(entry.HeldPath);
        foreach (var s in entry.Sidecars)
        {
            TryDelete(s.HeldPath);
        }

        TryDeleteEmptyUpwards(Path.GetDirectoryName(entry.HeldPath)!);
        lock (_gate)
        {
            _entries.RemoveAll(e => e.Id == id);
            Save();
        }
    }

    /// <summary>Deletes everything held longer than the retention period. Returns bytes freed.</summary>
    public long PurgeExpired(int holdingDays)
    {
        if (holdingDays <= 0)
        {
            holdingDays = 0;
        }

        var cutoff = DateTime.UtcNow.AddDays(-holdingDays);
        List<HeldFile> expired;
        lock (_gate)
        {
            expired = _entries.Where(e => e.HeldAtUtc < cutoff).ToList();
        }

        long freed = 0;
        foreach (var e in expired)
        {
            Purge(e.Id);
            freed += e.SizeBytes;
        }

        return freed;
    }

    /// <summary>
    /// Sidecars are files next to the video named "&lt;video name&gt;.xxx" (e.g. "Movie.en.srt", "Movie.nfo").
    /// They are only taken along when no other video in the folder shares that name, so the copy
    /// you keep never loses its subtitles.
    /// </summary>
    internal static List<string> FindExclusiveSidecars(string videoPath)
    {
        string dir = Path.GetDirectoryName(videoPath)!;
        string stem = Path.GetFileNameWithoutExtension(videoPath);
        var siblings = Directory.EnumerateFiles(dir).ToList();

        bool shared = siblings.Any(s =>
            !s.Equals(videoPath, StringComparison.OrdinalIgnoreCase)
            && VideoExtensions.Contains(Path.GetExtension(s), StringComparer.OrdinalIgnoreCase)
            && Path.GetFileNameWithoutExtension(s).Equals(stem, StringComparison.OrdinalIgnoreCase));
        if (shared)
        {
            return new List<string>();
        }

        return siblings.Where(s =>
        {
            string name = Path.GetFileName(s);
            return !s.Equals(videoPath, StringComparison.OrdinalIgnoreCase)
                   && (name.StartsWith(stem + ".", StringComparison.OrdinalIgnoreCase) || name.StartsWith(stem + "-thumb", StringComparison.OrdinalIgnoreCase))
                   && SidecarExtensions.Contains(Path.GetExtension(name), StringComparer.OrdinalIgnoreCase)
                   && !VideoExtensions.Contains(Path.GetExtension(name), StringComparer.OrdinalIgnoreCase);
        }).ToList();
    }

    /// <summary>Holding folder on the same drive as the file, so the move is an instant rename.</summary>
    internal static string HoldingDirectoryFor(string path, string id, IReadOnlyList<string>? libraryRoots = null)
    {
        string day = DateTime.UtcNow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var candidates = new List<string?>();

        // 1. The library folder containing the file (longest match), e.g. D:\Movies
        string full = Path.GetFullPath(path);
        candidates.AddRange((libraryRoots ?? Array.Empty<string>())
            .Select(r => Path.GetFullPath(r).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
            .Where(r => full.StartsWith(r + Path.DirectorySeparatorChar, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            .OrderByDescending(r => r.Length));

        // 2. On Windows the drive root is always the same volume (D:\). On Linux "/" usually isn't, so skip it.
        if (OperatingSystem.IsWindows())
        {
            candidates.Add(Path.GetPathRoot(full));
        }

        // 3. Last resort: next to the file.
        candidates.Add(Path.GetDirectoryName(full));

        foreach (string? root in candidates)
        {
            if (string.IsNullOrEmpty(root))
            {
                continue;
            }

            try
            {
                string holding = Path.Combine(root, FolderName);
                var info = Directory.CreateDirectory(holding);
                if (OperatingSystem.IsWindows())
                {
                    info.Attributes |= FileAttributes.Hidden;
                }

                string bucket = Path.Combine(holding, day, id);
                Directory.CreateDirectory(bucket);
                return bucket;
            }
            catch (UnauthorizedAccessException)
            {
                // Drive/share root not writable: fall back to a holding folder next to the file.
            }
            catch (IOException)
            {
            }
        }

        throw new IOException($"Can't create a holding folder for {path}");
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
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private static void TryDeleteEmptyUpwards(string dir)
    {
        try
        {
            // bucket (id) -> day -> .reelforge-holding; stop at the holding root.
            for (int i = 0; i < 3 && Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any(); i++)
            {
                Directory.Delete(dir);
                dir = Path.GetDirectoryName(dir)!;
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private static List<HeldFile> Load(string path)
    {
        try
        {
            return File.Exists(path)
                ? JsonSerializer.Deserialize<List<HeldFile>>(File.ReadAllText(path), Json) ?? new List<HeldFile>()
                : new List<HeldFile>();
        }
        catch (JsonException)
        {
            File.Copy(path, path + ".corrupt", true);
            return new List<HeldFile>();
        }
    }

    private void Save()
    {
        string tmp = _manifestPath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_entries, Json));
        File.Move(tmp, _manifestPath, true);
    }
}
