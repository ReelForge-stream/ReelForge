using MediaBrowser.Controller.Configuration;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace ReelForge.Services;

/// <summary>
/// Makes ReelForge the front door: the server's root URL opens ReelForge, and until first-run
/// setup is finished the classic web app's wizard is replaced by ReelForge's own setup.
/// The classic admin dashboard (/web/) stays available afterwards for advanced settings.
/// </summary>
public sealed class FrontDoor : IStartupFilter
{
    private readonly IServerConfigurationManager _config;

    public FrontDoor(IServerConfigurationManager config) => _config = config;

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (ctx, nextMiddleware) =>
        {
            if (HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))
            {
                string target = Redirect(ctx.Request.Path.Value ?? "/", _config.Configuration.IsStartupWizardCompleted);
                if (target.Length > 0)
                {
                    ctx.Response.Redirect(target, permanent: false);
                    return;
                }
            }

            await nextMiddleware(ctx).ConfigureAwait(false);
        });
        next(app);
    };

    /// <summary>Returns where to send a browser for this path, or "" to leave it alone.</summary>
    internal static string Redirect(string path, bool setupDone)
    {
        string p = path.TrimEnd('/');
        if (p.Length == 0)
        {
            return setupDone ? "/reelforge/" : "/reelforge/setup";
        }

        if (!setupDone && (p.Equals("/web", StringComparison.OrdinalIgnoreCase) || p.Equals("/web/index.html", StringComparison.OrdinalIgnoreCase)))
        {
            return "/reelforge/setup";
        }

        return string.Empty;
    }
}
