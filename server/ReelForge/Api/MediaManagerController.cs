using System.ComponentModel.DataAnnotations;
using ReelForge.Core;
using ReelForge.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ReelForge.Api;

public sealed record FileRef([Required] Guid ItemId, [Required] string MediaSourceId);

public sealed record FileListRequest([Required] IReadOnlyList<FileRef> Files);

public sealed record FileDto(
    Guid ItemId,
    string MediaSourceId,
    string Title,
    string Path,
    string FileName,
    long SizeBytes,
    string Summary,
    double Score,
    bool Keep,
    string? Edition);

public sealed record DuplicateGroupDto(string Key, string Kind, string Title, bool LooksLikeEditions, long ReclaimableBytes, IReadOnlyList<FileDto> Files);

public sealed record EstimateDto(
    Guid ItemId,
    string MediaSourceId,
    string Title,
    string Kind,
    string Path,
    string Summary,
    long SizeBytes,
    long EstimatedBytes,
    long SavingsBytes,
    double SavingsFraction,
    string Note);

public sealed record SpaceSaverResult(
    IReadOnlyList<EstimateDto> Candidates,
    long TotalSavingsBytes,
    long TotalCandidateBytes,
    int FilesScanned,
    IReadOnlyDictionary<string, int> SkippedByReason,
    EncoderReport Encoder);

public sealed record SettingsDto(
    TargetCodec TargetCodec,
    QualityPreset Preset,
    bool IncludeHdr,
    int HoldingDays,
    bool PauseWhileStreaming,
    int WindowStartHour,
    int WindowEndHour,
    int MaxConcurrentJobs);

/// <summary>Media Manager API. Everything here can delete or rewrite files, so all of it is admin-only.</summary>
[ApiController]
[Route("ReelForge")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class MediaManagerController : ControllerBase
{
    private readonly LibraryReader _reader;
    private readonly HoldingArea _holding;
    private readonly ConversionQueue _queue;
    private readonly EncoderProbe _probe;
    private readonly ILibraryManager _library;
    private readonly IServerConfigurationManager _serverConfig;
    private readonly ScanService _scans;
    private readonly SavingsLedger _savings;

    public MediaManagerController(
        LibraryReader reader,
        HoldingArea holding,
        ConversionQueue queue,
        EncoderProbe probe,
        ILibraryManager library,
        IServerConfigurationManager serverConfig,
        ScanService scans,
        SavingsLedger savings)
    {
        _scans = scans;
        _savings = savings;
        _reader = reader;
        _holding = holding;
        _queue = queue;
        _probe = probe;
        _library = library;
        _serverConfig = serverConfig;
        _holding.LibraryRoots = _reader.GetLibraries().SelectMany(l => l.Locations).ToList();
    }

    private static PluginConfiguration Config => Plugin.Instance!.Configuration;

    [HttpGet("Overview")]
    public async Task<ActionResult<object>> Overview(CancellationToken ct)
    {
        var jobs = _queue.List();
        var held = _holding.List();
        var encoder = await _probe.GetAsync(ct: ct).ConfigureAwait(false);
        return Ok(new
        {
            Libraries = _reader.GetLibraries(),
            Encoder = encoder,
            Jellyfin = CurrentHwAccel(),
            Queue = new
            {
                Paused = _queue.Paused,
                Waiting = _queue.WaitingReason,
                Queued = jobs.Count(j => j.Status == JobStatus.Queued),
                Running = jobs.Count(j => j.Status is JobStatus.Running or JobStatus.Verifying),
                SavedBytes = _savings.Summary(0).TotalSavedBytes,
            },
            Holding = new { Count = held.Count, Bytes = held.Sum(h => h.SizeBytes), Days = Config.HoldingDays },
        });
    }

    /// <summary>Running total of space saved by Space Saver, with every conversion that contributed.</summary>
    [HttpGet("Savings")]
    public ActionResult<object> Savings()
    {
        var sum = _savings.Summary();
        // Replaced originals sit in the holding area until their days are up; that space isn't free yet.
        long waiting = _holding.List().Where(h => h.Reason.StartsWith("Replaced", StringComparison.Ordinal)).Sum(h => h.SizeBytes);
        return Ok(new
        {
            sum.TotalSavedBytes,
            sum.Conversions,
            sum.OriginalBytes,
            sum.NewBytes,
            sum.Since,
            StillHeldBytes = waiting,
            Rows = sum.Rows.Select(r => new
            {
                r.Entry.FinishedUtc,
                r.Entry.ItemId,
                r.Entry.Title,
                r.Entry.Path,
                r.Entry.OriginalBytes,
                r.Entry.NewBytes,
                r.Entry.Encoder,
                r.SavedBytes,
                r.RunningTotalBytes,
            }),
        });
    }

    // ---------------- Duplicates ----------------

    [HttpGet("Duplicates")]
    public ActionResult<IReadOnlyList<DuplicateGroupDto>> Duplicates([FromQuery] Guid? libraryId) =>
        Ok(FindDuplicates(_reader, libraryId, null, CancellationToken.None));

    private static IReadOnlyList<DuplicateGroupDto> FindDuplicates(LibraryReader reader, Guid? libraryId, ScanProgress? progress, CancellationToken ct)
    {
        var files = reader.ReadAll(libraryId, null, progress, ct);
        progress?.Begin("Comparing titles", 0);
        var groups = DuplicateFinder.Find(files);
        return groups.Select(g => new DuplicateGroupDto(
            g.Key,
            g.Kind.ToString(),
            g.Title,
            g.LooksLikeEditions,
            g.LooksLikeEditions ? 0 : g.ReclaimableBytes,
            g.Files.Select(f => new FileDto(
                f.File.ItemId,
                f.File.MediaSourceId,
                f.File.Title,
                f.File.Path,
                f.File.FileName,
                f.File.SizeBytes,
                f.Summary,
                f.Score,
                f.RecommendedKeep,
                f.Edition)).ToList())).ToList();
    }

    /// <summary>
    /// Removes the chosen copies. Paths are always resolved server-side from the library (never taken
    /// from the request), only files that really are duplicates are accepted, and at least one copy
    /// of every title is always left in place.
    /// </summary>
    [HttpPost("Duplicates/Remove")]
    public ActionResult<object> RemoveDuplicates([FromBody] FileListRequest request)
    {
        _scans.Invalidate("duplicates");
        _scans.Invalidate("spacesaver");
        var groups = DuplicateFinder.Find(_reader.ReadAll());
        var wanted = request.Files.Select(f => f.MediaSourceId).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var removed = new List<string>();
        var errors = new List<string>();

        var bySource = groups
            .SelectMany(g => g.Files.Select(f => (Group: g, File: f.File)))
            .GroupBy(x => x.File.MediaSourceId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.First(), StringComparer.OrdinalIgnoreCase);

        foreach (var id in wanted)
        {
            if (!bySource.TryGetValue(id, out var hit))
            {
                errors.Add($"{id}: not a duplicate (refused)");
                continue;
            }

            int remaining = hit.Group.Files.Count(f => !wanted.Contains(f.File.MediaSourceId));
            if (remaining < 1)
            {
                errors.Add($"{hit.File.Title}: refusing to remove every copy");
                continue;
            }

            try
            {
                _holding.Remove(hit.File.Path, hit.File.Title, "Duplicate", Config.HoldingDays, includeSidecars: true);
                removed.Add(hit.File.Path);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                errors.Add($"{hit.File.FileName}: {ex.Message}");
            }
        }

        if (removed.Count > 0)
        {
            _library.QueueLibraryScan();
        }

        return Ok(new { Removed = removed.Count, Errors = errors, HoldingDays = Config.HoldingDays });
    }

    // ---------------- Space Saver ----------------

    [HttpGet("SpaceSaver")]
    public async Task<ActionResult<SpaceSaverResult>> SpaceSaver([FromQuery] Guid? libraryId, [FromQuery] MediaKind? kind, CancellationToken ct) =>
        Ok(await EstimateSavings(_reader, _probe, libraryId, kind, null, ct).ConfigureAwait(false));

    private static async Task<SpaceSaverResult> EstimateSavings(LibraryReader reader, EncoderProbe probe, Guid? libraryId, MediaKind? kind, ScanProgress? progress, CancellationToken ct)
    {
        var settings = Config.ToSettings();
        var files = reader.ReadAll(libraryId, kind, progress, ct)
            .GroupBy(f => f.Path, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();
        progress?.Begin("Estimating savings", files.Count);
        var estimates = new List<SpaceSaverEstimate>(files.Count);
        foreach (var f in files)
        {
            ct.ThrowIfCancellationRequested();
            estimates.Add(SpaceSaverEstimator.Estimate(f, settings));
            progress?.Step();
        }

        var candidates = estimates.Where(e => e.IsCandidate).OrderByDescending(e => e.SavingsBytes).ToList();
        progress?.Begin("Checking the graphics card", 0);
        var report = await probe.GetAsync(ct: ct).ConfigureAwait(false);
        return new SpaceSaverResult(
            candidates.Select(e => new EstimateDto(
                e.File.ItemId,
                e.File.MediaSourceId,
                e.File.Title,
                e.File.Kind.ToString(),
                e.File.Path,
                QualityScorer.Describe(e.File),
                e.File.SizeBytes,
                e.EstimatedSizeBytes,
                e.SavingsBytes,
                Math.Round(e.SavingsFraction, 3),
                e.Reason)).ToList(),
            candidates.Sum(c => c.SavingsBytes),
            candidates.Sum(c => c.File.SizeBytes),
            files.Count,
            estimates.Where(e => !e.IsCandidate).GroupBy(e => e.Reason).ToDictionary(g => g.Key, g => g.Count()),
            report);
    }

    // ---------------- Background scans with progress ----------------

    /// <summary>
    /// Starts (or rejoins) a duplicate or space-saver scan. Poll <c>Scans/{id}</c> for progress; the
    /// result is included once it's done. A recent result is reused unless <paramref name="fresh"/>.
    /// </summary>
    [HttpPost("Scans")]
    public ActionResult<ScanStatus> StartScan([FromQuery, Required] string kind, [FromQuery] Guid? libraryId, [FromQuery] MediaKind? mediaKind, [FromQuery] bool fresh = false)
    {
        var reader = _reader;
        var probe = _probe;
        string key = $"{kind}|{libraryId}|{mediaKind}";
        return kind.ToLowerInvariant() switch
        {
            "duplicates" => Ok(_scans.Start("duplicates", key, fresh, (p, ct) => Task.FromResult<object>(FindDuplicates(reader, libraryId, p, ct)))),
            "spacesaver" => Ok(_scans.Start("spacesaver", key, fresh, async (p, ct) => await EstimateSavings(reader, probe, libraryId, mediaKind, p, ct).ConfigureAwait(false))),
            _ => BadRequest(new { error = "kind must be duplicates or spacesaver" }),
        };
    }

    [HttpGet("Scans/{id}")]
    public ActionResult<ScanStatus> GetScan([FromRoute] string id) => _scans.Get(id) is { } s ? Ok(s) : NotFound();

    [HttpPost("Scans/{id}/Cancel")]
    public ActionResult CancelScan([FromRoute] string id) => _scans.Cancel(id) ? NoContent() : NotFound();

    [HttpPost("SpaceSaver/Queue")]
    public ActionResult<IReadOnlyList<ConversionJob>> Queue([FromBody] FileListRequest request)
    {
        _scans.Invalidate("spacesaver");
        return Ok(_queue.Enqueue(request.Files.Select(f => (f.ItemId, f.MediaSourceId))));
    }

    [HttpGet("Jobs")]
    public ActionResult<object> Jobs() => Ok(new { Paused = _queue.Paused, Waiting = _queue.WaitingReason, Jobs = _queue.List() });

    [HttpPost("Jobs/{id}/Cancel")]
    public ActionResult CancelJob([FromRoute] string id) => _queue.CancelJob(id) ? NoContent() : NotFound();

    [HttpPost("Jobs/ClearFinished")]
    public ActionResult<object> ClearFinished() => Ok(new { Cleared = _queue.ClearFinished() });

    [HttpPost("Jobs/Pause")]
    public ActionResult Pause([FromQuery] bool paused = true)
    {
        _queue.Paused = paused;
        return NoContent();
    }

    // ---------------- Holding area ----------------

    [HttpGet("Holding")]
    public ActionResult<IReadOnlyList<HeldFile>> Holding() => Ok(_holding.List());

    [HttpPost("Holding/{id}/Restore")]
    public ActionResult Restore([FromRoute] string id)
    {
        try
        {
            _holding.Restore(id);
            _scans.Invalidate("duplicates");
            _library.QueueLibraryScan();
            return NoContent();
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (IOException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpDelete("Holding/{id}")]
    public ActionResult Purge([FromRoute] string id)
    {
        _holding.Purge(id);
        return NoContent();
    }

    [HttpPost("Holding/EmptyAll")]
    public ActionResult<object> EmptyAll() => Ok(new { FreedBytes = _holding.PurgeExpired(0) });

    // ---------------- Settings & GPU ----------------

    [HttpGet("Settings")]
    public ActionResult<SettingsDto> GetSettings()
    {
        var c = Config;
        return Ok(new SettingsDto(c.TargetCodec, c.Preset, c.IncludeHdr, c.HoldingDays, c.PauseWhileStreaming, c.WindowStartHour, c.WindowEndHour, c.MaxConcurrentJobs));
    }

    [HttpPost("Settings")]
    public ActionResult<SettingsDto> SaveSettings([FromBody] SettingsDto s)
    {
        var c = Config;
        c.TargetCodec = s.TargetCodec;
        c.Preset = s.Preset;
        c.IncludeHdr = s.IncludeHdr;
        c.HoldingDays = Math.Clamp(s.HoldingDays, 0, 365);
        c.PauseWhileStreaming = s.PauseWhileStreaming;
        c.WindowStartHour = Math.Clamp(s.WindowStartHour, -1, 23);
        c.WindowEndHour = Math.Clamp(s.WindowEndHour, -1, 23);
        c.MaxConcurrentJobs = Math.Clamp(s.MaxConcurrentJobs, 1, 4);
        Plugin.Instance!.SaveConfiguration();
        return GetSettings();
    }

    [HttpPost("Gpu/Refresh")]
    public async Task<ActionResult<EncoderReport>> RefreshGpu(CancellationToken ct) => Ok(await _probe.GetAsync(refresh: true, ct).ConfigureAwait(false));

    /// <summary>
    /// One-click: switch Jellyfin's streaming transcoder to NVIDIA NVENC with GPU decoding for every
    /// codec the card handles. This is the biggest single fix for buffering on remote/mobile playback.
    /// </summary>
    [HttpPost("Gpu/EnableStreamingAcceleration")]
    public async Task<ActionResult<object>> EnableStreamingAcceleration(CancellationToken ct)
    {
        var report = await _probe.GetAsync(ct: ct).ConfigureAwait(false);
        if (!report.Working.Contains("hevc_nvenc"))
        {
            return BadRequest(new { error = report.Summary });
        }

        var opts = (EncodingOptions)_serverConfig.GetConfiguration("encoding");
        opts.HardwareAccelerationType = HardwareAccelerationType.nvenc;
        opts.EnableHardwareEncoding = true;
        opts.AllowHevcEncoding = true;
        opts.AllowAv1Encoding = report.Working.Contains("av1_nvenc");
        opts.EnableDecodingColorDepth10Hevc = report.HevcNvenc10Bit;
        opts.EnableTonemapping = true;
        opts.EnableEnhancedNvdecDecoder = true;
        opts.HardwareDecodingCodecs = ["h264", "hevc", "mpeg2video", "vc1", "vp8", "vp9", "av1"];
        _serverConfig.SaveConfiguration("encoding", opts);
        return Ok(CurrentHwAccel());
    }

    private object CurrentHwAccel()
    {
        var opts = (EncodingOptions)_serverConfig.GetConfiguration("encoding");
        return new
        {
            HardwareAcceleration = opts.HardwareAccelerationType.ToString(),
            opts.EnableHardwareEncoding,
            opts.AllowHevcEncoding,
            opts.EnableTonemapping,
        };
    }
}
