using System.ComponentModel.DataAnnotations;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ReelForge.Services;

namespace ReelForge.Api;

public sealed record TvCheckInRequest([Required] string DeviceId, string? Name, string? Model, string? Ip, string? AppVersion);

public sealed record TvPasswordRequest(string? Password);

public sealed record TvDto(
    string Id,
    string Name,
    string? Model,
    string? Ip,
    string? AppVersion,
    string? UserName,
    DateTime LastSeenUtc,
    bool AutoUpdate,
    bool UpToDate,
    bool Updating,
    string? Status,
    bool StatusIsError,
    DateTime StatusUtc);

public sealed record TvListDto(string ServerVersion, IReadOnlyList<TvDto> Tvs);

/// <summary>The TV app checks in here when it opens, so the server can keep it up to date.</summary>
[ApiController]
[Route("ReelForge/Tv")]
[Authorize]
public sealed class TvCheckInController : ControllerBase
{
    private readonly TvUpdater _tvs;

    public TvCheckInController(TvUpdater tvs) => _tvs = tvs;

    [HttpPost("CheckIn")]
    public ActionResult<TvCheckInResult> CheckIn([FromBody] TvCheckInRequest req)
    {
        try
        {
            string? user = User.Identity?.Name;
            return _tvs.CheckIn(req.DeviceId, req.Name, req.Model, req.Ip, req.AppVersion, user);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }
}

/// <summary>Media Manager → TVs: the Roku TVs running ReelForge, and their automatic updates.</summary>
[ApiController]
[Route("ReelForge/Tvs")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class TvsController : ControllerBase
{
    private readonly TvUpdater _tvs;

    public TvsController(TvUpdater tvs) => _tvs = tvs;

    [HttpGet]
    public ActionResult<TvListDto> List()
    {
        string target = _tvs.TargetVersion;
        return new TvListDto(target, _tvs.List().Select(t => new TvDto(
            t.Id,
            t.Name,
            t.Model,
            t.Ip,
            t.AppVersion,
            t.UserName,
            t.LastSeenUtc,
            t.ProtectedPassword.Length > 0,
            !TvUpdater.IsOlder(t.AppVersion, target),
            _tvs.IsBusy(t.Id),
            t.Status,
            t.StatusIsError,
            t.StatusUtc)).ToList());
    }

    /// <summary>Saves the TV's developer-mode password (checked against the TV first). An empty password turns automatic updates off.</summary>
    [HttpPut("{id}/Password")]
    public async Task<ActionResult> SetPassword([FromRoute] string id, [FromBody] TvPasswordRequest req, CancellationToken ct)
    {
        try
        {
            var (ok, message) = await _tvs.SetPasswordAsync(id, req.Password ?? string.Empty, ct).ConfigureAwait(false);
            return ok ? Ok(new { Message = message }) : BadRequest(new { error = message });
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPost("{id}/Update")]
    public ActionResult Update([FromRoute] string id)
    {
        return _tvs.StartInstall(id, automatic: false)
            ? Accepted()
            : Conflict(new { error = "This TV is already updating, or has no developer password saved." });
    }

    [HttpDelete("{id}")]
    public ActionResult Remove([FromRoute] string id) => _tvs.Remove(id) ? NoContent() : NotFound();
}
