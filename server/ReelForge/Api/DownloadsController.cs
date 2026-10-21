using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ReelForge.Core;
using ReelForge.Services;

namespace ReelForge.Api;

public sealed record DownloadAudioDto(int Index, string Label, string Codec, int Channels);

public sealed record DownloadOptionsDto(
    Guid ItemId,
    string MediaSourceId,
    string Title,
    string FileName,
    long SizeBytes,
    double DurationSeconds,
    string Container,
    string VideoCodec,
    string? VideoProfile,
    int BitDepth,
    int Width,
    int Height,
    string Range,
    IReadOnlyList<string> AudioCodecs,
    IReadOnlyList<DownloadAudioDto> AudioTracks,
    int TextSubtitles,
    int PictureSubtitles,
    IReadOnlyList<DownloadOption> Options,
    bool UsesGpu);

public sealed record StartDownloadRequest([Required] Guid ItemId, string? MediaSourceId, [Required] string Option, int AudioIndex);

public sealed record DownloadJobDto(
    string Id,
    Guid ItemId,
    string Title,
    string Label,
    string FileName,
    DownloadState State,
    double Progress,
    int? EtaSeconds,
    long EstimatedBytes,
    long SizeBytes,
    string? Error,
    DateTime CreatedUtc,
    DateTime ExpiresUtc);

/// <summary>Downloads for any signed-in person who's allowed to download, limited to titles they can see.</summary>
[ApiController]
[Route("ReelForge/DownloadJobs")]
[Authorize]
public sealed class DownloadsController : ControllerBase
{
    private readonly DownloadService _downloads;
    private readonly EncoderProbe _probe;
    private readonly IUserManager _users;
    private readonly ILibraryManager _library;

    public DownloadsController(DownloadService downloads, EncoderProbe probe, IUserManager users, ILibraryManager library)
    {
        _downloads = downloads;
        _probe = probe;
        _users = users;
        _library = library;
    }

    [HttpGet("Options/{itemId}")]
    public async Task<ActionResult<DownloadOptionsDto>> Options([FromRoute] Guid itemId, [FromQuery] string? mediaSourceId, CancellationToken ct)
    {
        if (Check(itemId) is { } denied)
        {
            return denied;
        }

        var file = _downloads.Read(itemId, mediaSourceId);
        if (file is null)
        {
            return NotFound("This title has no video file to download.");
        }

        var report = await _probe.GetAsync(ct: ct).ConfigureAwait(false);
        var audio = file.AudioTracks.Select((a, i) => new DownloadAudioDto(i, a.DisplayTitle ?? $"{a.Language ?? "Unknown"} {a.Codec.ToUpperInvariant()}", a.Codec, a.Channels)).ToList();
        return new DownloadOptionsDto(
            file.ItemId,
            file.MediaSourceId,
            file.Title,
            file.FileName,
            file.SizeBytes,
            file.Duration.TotalSeconds,
            file.Container,
            file.VideoCodec,
            file.VideoProfile,
            file.BitDepth,
            file.Width,
            file.Height,
            file.Range.ToString(),
            file.AudioTracks.Select(a => a.Codec).ToList(),
            audio,
            file.SubtitleTracks.Count(s => s.IsText),
            file.SubtitleTracks.Count(s => !s.IsText),
            DownloadPlan.Options(file),
            report.Working.Contains("h264_nvenc"));
    }

    [HttpPost]
    public ActionResult<DownloadJobDto> Start([FromBody] StartDownloadRequest req)
    {
        if (Check(req.ItemId) is { } denied)
        {
            return denied;
        }

        var file = _downloads.Read(req.ItemId, req.MediaSourceId);
        if (file is null)
        {
            return NotFound("This title has no video file to download.");
        }

        var option = DownloadPlan.Options(file).FirstOrDefault(o => o.Id == req.Option);
        if (option is null)
        {
            return BadRequest("That size isn't available for this title.");
        }

        try
        {
            return Dto(_downloads.Start(UserId!.Value, file, option, req.AudioIndex));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
    }

    [HttpGet]
    public ActionResult<IReadOnlyList<DownloadJobDto>> List() =>
        UserId is { } uid ? _downloads.ForUser(uid).Select(Dto).ToList() : Unauthorized();

    [HttpDelete("{id}")]
    public ActionResult Remove([FromRoute] string id) =>
        UserId is { } uid && _downloads.Remove(id, uid) ? NoContent() : NotFound();

    /// <summary>The finished file. Supports resuming (range requests), so a dropped phone download can pick up again.</summary>
    [HttpGet("{id}/File")]
    public ActionResult File([FromRoute] string id)
    {
        var job = _downloads.Get(id);
        if (job is null || job.UserId != UserId || job.State != DownloadState.Ready || job.OutputPathOrNull() is not { } path)
        {
            return NotFound();
        }

        return PhysicalFile(path, "video/mp4", job.FileName, enableRangeProcessing: true);
    }

    private Guid? UserId =>
        Guid.TryParse(User.FindFirstValue("Jellyfin-UserId"), out var g) ? g : null;

    /// <summary>Signed in, allowed to download, and can see this title.</summary>
    private ActionResult? Check(Guid itemId)
    {
        User? user = UserId is { } uid ? _users.GetUserById(uid) : null;
        if (user is null)
        {
            return Unauthorized();
        }

        if (!user.HasPermission(PermissionKind.IsAdministrator) && !user.HasPermission(PermissionKind.EnableContentDownloading))
        {
            return StatusCode(403, "Downloads are turned off for your profile. Ask whoever runs the server.");
        }

        var item = _library.GetItemById(itemId);
        if (item is null || !item.IsVisible(user))
        {
            return NotFound();
        }

        return null;
    }

    private static DownloadJobDto Dto(DownloadJob j) =>
        new(j.Id, j.ItemId, j.Title, j.Label, j.FileName, j.State, j.Progress, j.EtaSeconds, j.EstimatedBytes, j.SizeBytes, j.Error, j.CreatedUtc, j.ExpiresUtc);
}
