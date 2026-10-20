using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;

namespace ReelForge.Api;

/// <summary>
/// Serves the ReelForge web app, which is compiled into this DLL as embedded resources.
/// Anonymous because the login page has to load before anyone is signed in; the app itself
/// signs in against Jellyfin's normal API, so nothing here exposes data.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("reelforge")]
public sealed class WebUiController : ControllerBase
{
    private const string Prefix = "ReelForgeWeb/";
    private static readonly Assembly Asm = typeof(WebUiController).Assembly;
    private static readonly FileExtensionContentTypeProvider Types = new();

    // MSBuild uses '\' in RecursiveDir on Windows; normalise once.
    private static readonly Dictionary<string, string> Resources = Asm.GetManifestResourceNames()
        .Where(n => n.Replace('\\', '/').StartsWith(Prefix, StringComparison.Ordinal))
        .ToDictionary(n => n.Replace('\\', '/')[Prefix.Length..], n => n, StringComparer.OrdinalIgnoreCase);

    [HttpGet("")]
    [HttpGet("{**path}")]
    public IActionResult Get([FromRoute] string? path)
    {
        path = (path ?? string.Empty).Trim('/');
        if (path.Length == 0 || !Resources.ContainsKey(path))
        {
            // Client-side routes (e.g. /reelforge/manager/duplicates) all load the app shell.
            if (Path.HasExtension(path) && path.Length > 0)
            {
                return NotFound();
            }

            path = "index.html";
        }

        if (!Resources.TryGetValue(path, out var resource))
        {
            return Content("ReelForge UI is not bundled in this build.", "text/plain");
        }

        var stream = Asm.GetManifestResourceStream(resource);
        if (stream is null)
        {
            return NotFound();
        }

        if (!Types.TryGetContentType(path, out var contentType))
        {
            contentType = "application/octet-stream";
        }

        // Hashed build assets never change; the shell must always be fresh so updates show up.
        Response.Headers.CacheControl = path.StartsWith("assets/", StringComparison.OrdinalIgnoreCase)
            ? "public, max-age=31536000, immutable"
            : "no-cache";
        return File(stream, contentType);
    }
}
