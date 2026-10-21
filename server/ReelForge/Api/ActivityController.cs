using Jellyfin.Data.Queries;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Activity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ReelForge.Services;

namespace ReelForge.Api;

public sealed record HistoryUserDto(Guid Id, string Name);

public sealed record HistoryDto(IReadOnlyList<WatchRecord> Records, DateTime? TrackingSince, IReadOnlyList<HistoryUserDto> Users);

/// <summary>Who watched what, when, and on which device. Admin only.</summary>
[ApiController]
[Route("ReelForge/Activity")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class ActivityController : ControllerBase
{
    private readonly WatchHistory _history;
    private readonly IActivityManager _activity;
    private readonly IUserManager _users;
    private readonly ILibraryManager _library;

    public ActivityController(WatchHistory history, IActivityManager activity, IUserManager users, ILibraryManager library)
    {
        _history = history;
        _activity = activity;
        _users = users;
        _library = library;
    }

    [HttpGet("History")]
    public async Task<ActionResult<HistoryDto>> History([FromQuery] int days = 30, [FromQuery] Guid? userId = null)
    {
        days = Math.Clamp(days, 1, 400);
        var from = DateTime.UtcNow.AddDays(-days);
        var records = _history.Query(from, userId).ToList();
        var since = _history.Since;

        // Before ReelForge kept its own history, the server's activity log still noted each viewing
        // ("cade has finished playing Dune on Living Room TV"). Fill the gap from there.
        if (since is null || since > from)
        {
            records.AddRange(await FromActivityLog(from, since ?? DateTime.UtcNow, userId).ConfigureAwait(false));
        }

        var users = _users.GetUsers().Select(u => new HistoryUserDto(u.Id, u.Username)).OrderBy(u => u.Name, StringComparer.OrdinalIgnoreCase).ToList();
        return new HistoryDto(records.OrderByDescending(r => r.StartedUtc).Take(2000).ToList(), since, users);
    }

    private async Task<IEnumerable<WatchRecord>> FromActivityLog(DateTime from, DateTime to, Guid? userId)
    {
        try
        {
            var page = await _activity.GetPagedResultAsync(new ActivityLogQuery
            {
                Type = "VideoPlaybackStopped",
                MinDate = from,
                MaxDate = to,
                Limit = 2000,
            }).ConfigureAwait(false);

            var names = _users.GetUsers().ToDictionary(u => u.Id, u => u.Username);
            var list = new List<WatchRecord>();
            foreach (var e in page.Items)
            {
                if (userId is { } want && e.UserId != want)
                {
                    continue;
                }

                // "{user} has finished playing {title} on {device}"
                string text = e.Name ?? string.Empty;
                int playing = text.IndexOf(" playing ", StringComparison.Ordinal);
                int on = text.LastIndexOf(" on ", StringComparison.Ordinal);
                string device = on > 0 ? text[(on + 4)..] : "Unknown device";
                Guid itemId = Guid.TryParse(e.ItemId, out var g) ? g : Guid.Empty;
                var item = itemId == Guid.Empty ? null : _library.GetItemById(itemId);
                string title = item is not null ? WatchHistory.TitleOf(item) : playing > 0 && on > playing ? text[(playing + 9)..on] : text;

                list.Add(new WatchRecord
                {
                    UserId = e.UserId,
                    UserName = names.TryGetValue(e.UserId, out var n) ? n : text.Split(' ')[0],
                    ItemId = itemId,
                    Title = title,
                    ItemType = item?.GetBaseItemKind().ToString() ?? "Video",
                    SeriesId = (item as Episode)?.SeriesId,
                    DeviceName = device,
                    Client = string.Empty,
                    StartedUtc = DateTime.SpecifyKind(e.Date, DateTimeKind.Utc),
                    EndedUtc = DateTime.SpecifyKind(e.Date, DateTimeKind.Utc),
                    RunTimeTicks = item?.RunTimeTicks,
                });
            }

            return list;
        }
        catch (Exception)
        {
            return Array.Empty<WatchRecord>();
        }
    }
}
