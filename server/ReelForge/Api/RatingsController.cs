using System.Security.Claims;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ReelForge.Services;

namespace ReelForge.Api;

public sealed record OmdbKeyRequest(string Key);

/// <summary>IMDb / Rotten Tomatoes ratings for the details page.</summary>
[ApiController]
[Route("ReelForge/Ratings")]
[Authorize]
public sealed class RatingsController : ControllerBase
{
    private readonly RatingsService _ratings;
    private readonly ILibraryManager _library;
    private readonly IUserManager _users;

    public RatingsController(RatingsService ratings, ILibraryManager library, IUserManager users)
    {
        _ratings = ratings;
        _library = library;
        _users = users;
    }

    [HttpGet("{itemId}")]
    public async Task<ActionResult<Ratings>> Get([FromRoute] Guid itemId, CancellationToken ct)
    {
        var user = Guid.TryParse(User.FindFirstValue("Jellyfin-UserId"), out var uid) ? _users.GetUserById(uid) : null;
        var item = _library.GetItemById(itemId);
        if (user is null || item is null || !item.IsVisible(user))
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "private, max-age=3600";
        return await _ratings.GetAsync(item, ct).ConfigureAwait(false);
    }

    /// <summary>Whether a key is set (only its last 4 characters are ever shown).</summary>
    [HttpGet("Settings")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public ActionResult<object> Settings()
    {
        string k = Plugin.Instance!.Configuration.OmdbApiKey ?? string.Empty;
        return Ok(new { HasKey = k.Length > 0, KeyHint = k.Length > 4 ? "••••" + k[^4..] : k.Length > 0 ? "••••" : null });
    }

    /// <summary>Saves a key after checking OMDb accepts it. An empty key turns OMDb ratings off.</summary>
    [HttpPost("Settings")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public async Task<ActionResult> SaveSettings([FromBody] OmdbKeyRequest req, CancellationToken ct)
    {
        string key = (req.Key ?? string.Empty).Trim();
        if (key.Length > 0 && await RatingsService.TestKeyAsync(key, ct).ConfigureAwait(false) is { } problem)
        {
            return BadRequest(problem);
        }

        Plugin.Instance!.Configuration.OmdbApiKey = key;
        Plugin.Instance.SaveConfiguration();
        return NoContent();
    }
}
