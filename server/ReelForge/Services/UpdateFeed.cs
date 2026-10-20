using MediaBrowser.Controller.Configuration;
using MediaBrowser.Model.Updates;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>
/// Makes ReelForge update itself from GitHub with zero setup. On startup it adds the ReelForge
/// release feed to the server's plugin repositories; the server's built-in daily "Update Plugins"
/// task then installs new versions (UI included, since the UI ships inside this module).
/// </summary>
public sealed class UpdateFeed : IHostedService
{
    /// <summary>Published by the release workflow on every tagged version.</summary>
    public const string ManifestUrl = "https://raw.githubusercontent.com/ReelForge-stream/ReelForge/update-feed/manifest.json";

    private readonly IServerConfigurationManager _config;
    private readonly ILogger<UpdateFeed> _logger;

    public UpdateFeed(IServerConfigurationManager config, ILogger<UpdateFeed> logger)
    {
        _config = config;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var server = _config.Configuration;
            var repos = server.PluginRepositories ?? Array.Empty<RepositoryInfo>();
            if (!repos.Any(r => string.Equals(r.Url, ManifestUrl, StringComparison.OrdinalIgnoreCase)))
            {
                server.PluginRepositories = repos
                    .Append(new RepositoryInfo { Name = "ReelForge", Url = ManifestUrl, Enabled = true })
                    .ToArray();
                _config.SaveConfiguration();
                _logger.LogInformation("ReelForge: registered update feed {Url}", ManifestUrl);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ReelForge: could not register the update feed");
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
