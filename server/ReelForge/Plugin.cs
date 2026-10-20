using ReelForge.Core;
using ReelForge.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.DependencyInjection;

namespace ReelForge;

/// <summary>
/// ReelForge: a new front end and Media Manager running inside the Jellyfin engine.
/// The UI is served from this DLL at /reelforge, the Media Manager API at /MediaManager.
/// </summary>
public sealed class Plugin : BasePlugin<PluginConfiguration>
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        DataDirectory = Path.Combine(applicationPaths.DataPath, "reelforge");
        Directory.CreateDirectory(DataDirectory);
    }

    public static Plugin? Instance { get; private set; }

    /// <summary>Gets where ReelForge keeps its job queue and holding-area manifest.</summary>
    public string DataDirectory { get; }

    public override string Name => "ReelForge";

    public override Guid Id => Guid.Parse("6f1d0c52-8a3e-4c1b-9b7e-3d5a2e9f4c71");

    public override string Description => "New UI plus Media Manager: duplicate finder and GPU space saver.";
}

public sealed class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Gets or sets the codec conversions produce.</summary>
    public TargetCodec TargetCodec { get; set; } = TargetCodec.Hevc;

    public QualityPreset Preset { get; set; } = QualityPreset.Balanced;

    /// <summary>Gets or sets a value indicating whether HDR10/HLG files may be converted. Off by default.</summary>
    public bool IncludeHdr { get; set; }

    /// <summary>Gets or sets how many days removed/replaced files stay in the holding area. 0 = delete immediately.</summary>
    public int HoldingDays { get; set; } = 14;

    /// <summary>Gets or sets a value indicating whether conversions wait while anyone is watching something.</summary>
    public bool PauseWhileStreaming { get; set; } = true;

    /// <summary>Gets or sets the hour (0-23, server local time) conversions may start, or -1 for any time.</summary>
    public int WindowStartHour { get; set; } = -1;

    /// <summary>Gets or sets the hour (0-23) after which no new conversion starts, or -1 for any time.</summary>
    public int WindowEndHour { get; set; } = -1;

    /// <summary>Gets or sets how many files convert at once. Quadro cards have no NVENC session limit.</summary>
    public int MaxConcurrentJobs { get; set; } = 1;

    public ConversionSettings ToSettings() => new()
    {
        Codec = TargetCodec,
        Preset = Preset,
        IncludeHdr = IncludeHdr,
    };
}

/// <summary>Registers ReelForge's services with the Jellyfin host.</summary>
public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<LibraryReader>();
        serviceCollection.AddSingleton<HoldingArea>();
        serviceCollection.AddSingleton<EncoderProbe>();
        serviceCollection.AddSingleton<ConversionQueue>();
        serviceCollection.AddHostedService(sp => sp.GetRequiredService<ConversionQueue>());
        serviceCollection.AddHostedService<UpdateFeed>();
        serviceCollection.AddTransient<Microsoft.AspNetCore.Hosting.IStartupFilter, FrontDoor>();
    }
}
