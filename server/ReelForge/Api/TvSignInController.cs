using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Net.Codecrete.QrCodeGenerator;

namespace ReelForge.Api;

/// <summary>
/// Sign-in QR codes for TV apps. The TV starts Jellyfin's Quick Connect, shows this QR code (a link to
/// /reelforge/link?code=…), and someone signed in on a phone approves it there.
/// </summary>
[ApiController]
[AllowAnonymous] // the TV isn't signed in yet; the image only ever encodes this server's own link page
[Route("ReelForge/QuickConnect")]
public sealed partial class TvSignInController : ControllerBase
{
    [GeneratedRegex("^[0-9A-Za-z]{4,12}$")]
    private static partial Regex CodePattern();

    /// <summary>The link a phone opens to approve a TV, built from the address the TV used to reach this server.</summary>
    internal static string LinkFor(string scheme, string host, string pathBase, string code) =>
        $"{scheme}://{host}{pathBase.TrimEnd('/')}/reelforge/link?code={Uri.EscapeDataString(code)}";

    /// <summary>PNG of the QR code for a Quick Connect code: dark modules on white, with a quiet border.</summary>
    [HttpGet("Qr")]
    public ActionResult Qr([FromQuery] string code, [FromQuery] int size = 480)
    {
        if (string.IsNullOrEmpty(code) || !CodePattern().IsMatch(code))
        {
            return BadRequest("Pass the Quick Connect code, e.g. ?code=429251");
        }

        string link = LinkFor(Request.Scheme, Request.Host.Value ?? "localhost", Request.PathBase.Value ?? string.Empty, code);
        var qr = QrCode.EncodeText(link, QrCode.Ecc.Medium);
        const int border = 3;
        int scale = Math.Clamp(Math.Clamp(size, 120, 1200) / (qr.Size + (border * 2)), 2, 40);
        byte[] png = qr.ToPngBitmap(border, scale, foreground: 0x111111, background: 0xFFFFFF);
        Response.Headers.CacheControl = "no-store";
        return File(png, "image/png");
    }
}
