using System.ComponentModel.DataAnnotations;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ReelForge.Services;

namespace ReelForge.Api;

public sealed record ConnectRequest([Required] string Path, string? Username, string? Password, bool Save = true);

public sealed record ListSharesRequest([Required] string Server, string? Username, string? Password);

/// <summary>
/// NAS access for the setup wizard and folder browser. Open during first-run setup (like the
/// engine's own setup calls), admin-only once setup is done.
/// </summary>
[ApiController]
[Route("ReelForge/Network")]
[Authorize(Policy = Policies.FirstTimeSetupOrElevated)]
public sealed class NetworkController : ControllerBase
{
    private readonly NetworkShares _shares;

    public NetworkController(NetworkShares shares) => _shares = shares;

    /// <summary>Shares ReelForge has signed in to, plus drive letters mapped in people's Windows logins.</summary>
    [HttpGet("Locations")]
    public ActionResult<object> Locations() => Ok(new { Shares = _shares.List(), Mapped = _shares.MappedDrives() });

    [HttpPost("Connect")]
    public ActionResult<object> Connect([FromBody] ConnectRequest r)
    {
        try
        {
            string root = _shares.Connect(r.Path, r.Username?.Trim() ?? string.Empty, r.Password ?? string.Empty, r.Save);
            return Ok(new { Path = root });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or PlatformNotSupportedException)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPost("Shares")]
    public ActionResult<object> Shares([FromBody] ListSharesRequest r)
    {
        try
        {
            return Ok(new { Shares = _shares.SharesOn(r.Server, r.Username?.Trim() ?? string.Empty, r.Password ?? string.Empty) });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or PlatformNotSupportedException)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("Locations/{id}")]
    public ActionResult Forget([FromRoute] string id)
    {
        _shares.Forget(id);
        return NoContent();
    }
}
