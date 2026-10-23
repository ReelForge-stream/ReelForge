using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>
/// Makes Jellyfin's "Scan media library" task check for new, changed and removed files every few
/// minutes (5 by default) instead of every 12 hours. NAS shares often don't report changes on
/// their own, so a short regular check is what makes new downloads show up on their own.
/// The scan only looks at what changed, so a quiet library costs very little.
/// </summary>
public sealed class LibraryScanSchedule : IHostedService
{
    public const string TaskKey = "RefreshLibrary";
    private static readonly TimeSpan JellyfinDefault = TimeSpan.FromHours(12);

    private readonly ITaskManager _tasks;
    private readonly ILogger<LibraryScanSchedule> _logger;

    public LibraryScanSchedule(ITaskManager tasks, ILogger<LibraryScanSchedule> logger)
    {
        _tasks = tasks;
        _logger = logger;
    }

    public IScheduledTaskWorker? Task => _tasks.ScheduledTasks.FirstOrDefault(t => t.ScheduledTask.Key == TaskKey);

    /// <summary>Sets the interval. 0 turns the frequent check off (back to Jellyfin's twice a day).</summary>
    public void Apply(int minutes)
    {
        var task = Task;
        if (task is null)
        {
            _logger.LogWarning("ReelForge: the library scan task wasn't found; can't schedule it");
            return;
        }

        var interval = minutes > 0 ? TimeSpan.FromMinutes(minutes) : JellyfinDefault;
        // Keep any time-of-day or startup triggers someone added; replace only the interval ones.
        var others = task.Triggers.Where(t => t.Type != TaskTriggerInfoType.IntervalTrigger);
        task.Triggers = others.Append(new TaskTriggerInfo { Type = TaskTriggerInfoType.IntervalTrigger, IntervalTicks = interval.Ticks }).ToArray();
        _logger.LogInformation("ReelForge: libraries are checked for changes every {Interval}", minutes > 0 ? $"{minutes} min" : "12 hours");
    }

    public void ScanNow()
    {
        if (Task is { } t && t.State != TaskState.Running)
        {
            _tasks.Execute(t, new TaskOptions());
        }
    }

    private readonly CancellationTokenSource _stop = new();

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Plugins start before Jellyfin has loaded its scheduled tasks: wait for the scan task to exist.
        _ = System.Threading.Tasks.Task.Run(async () =>
        {
            for (int i = 0; i < 120 && !_stop.IsCancellationRequested; i++)
            {
                if (Task is not null)
                {
                    try
                    {
                        Apply(Plugin.Instance?.Configuration.LibraryScanMinutes ?? 5);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "ReelForge: couldn't set the library scan schedule");
                    }

                    return;
                }

                await System.Threading.Tasks.Task.Delay(TimeSpan.FromSeconds(5), _stop.Token).ConfigureAwait(false);
            }
        });
        return System.Threading.Tasks.Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _stop.Cancel();
        return System.Threading.Tasks.Task.CompletedTask;
    }
}
