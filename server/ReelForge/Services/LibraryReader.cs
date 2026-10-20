using Jellyfin.Data.Enums;
using ReelForge.Core;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.MediaInfo;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>
/// Turns Jellyfin's library (already scanned and probed by the engine) into <see cref="MediaFile"/>s.
/// No disk probing happens here: everything comes from Jellyfin's database, so a scan of
/// thousands of titles takes seconds.
/// </summary>
public sealed class LibraryReader
{
    private readonly ILibraryManager _library;
    private readonly ILogger<LibraryReader> _logger;

    public LibraryReader(ILibraryManager library, ILogger<LibraryReader> logger)
    {
        _library = library;
        _logger = logger;
    }

    public sealed record LibraryInfo(string Id, string Name, string? CollectionType, IReadOnlyList<string> Locations);

    public IReadOnlyList<LibraryInfo> GetLibraries() =>
        _library.GetVirtualFolders()
            .Where(v => v.CollectionType is null || v.CollectionType.ToString() is "movies" or "tvshows" or "homevideos" or "mixed")
            .Select(v => new LibraryInfo(v.ItemId, v.Name, v.CollectionType?.ToString(), v.Locations))
            .ToList();

    /// <summary>Reads every movie and episode file, optionally limited to one library.</summary>
    public IReadOnlyList<MediaFile> ReadAll(Guid? libraryId = null, MediaKind? kind = null)
    {
        var types = kind switch
        {
            MediaKind.Movie => new[] { BaseItemKind.Movie },
            MediaKind.Episode => new[] { BaseItemKind.Episode },
            _ => new[] { BaseItemKind.Movie, BaseItemKind.Episode },
        };

        var query = new InternalItemsQuery
        {
            IncludeItemTypes = types,
            IsVirtualItem = false,
            Recursive = true,
            IsFolder = false,
        };

        if (libraryId is { } lib && lib != Guid.Empty)
        {
            query.AncestorIds = [lib];
        }

        var seriesProviders = new Dictionary<Guid, IReadOnlyDictionary<string, string>>();
        var result = new List<MediaFile>();
        foreach (var item in _library.GetItemList(query))
        {
            if (item is not Video video)
            {
                continue;
            }

            try
            {
                result.AddRange(ToFiles(video, seriesProviders));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ReelForge: skipped {Path} while reading library", video.Path);
            }
        }

        return result;
    }

    /// <summary>Reads the current state of one specific version of one item (used right before converting).</summary>
    public MediaFile? ReadOne(Guid itemId, string mediaSourceId)
    {
        if (_library.GetItemById(itemId) is not Video video)
        {
            return null;
        }

        return ToFiles(video, new Dictionary<Guid, IReadOnlyDictionary<string, string>>())
            .FirstOrDefault(f => f.MediaSourceId.Equals(mediaSourceId, StringComparison.OrdinalIgnoreCase));
    }

    private IEnumerable<MediaFile> ToFiles(Video video, Dictionary<Guid, IReadOnlyDictionary<string, string>> seriesCache)
    {
        bool plainVideo = video.VideoType == VideoType.VideoFile && video.AdditionalParts.Length == 0;
        foreach (var src in video.GetMediaSources(false))
        {
            if (src.Protocol != MediaProtocol.File || string.IsNullOrEmpty(src.Path))
            {
                continue;
            }

            yield return Map(video, src, plainVideo, seriesCache);
        }
    }

    private MediaFile Map(Video video, MediaSourceInfo src, bool plainVideo, Dictionary<Guid, IReadOnlyDictionary<string, string>> seriesCache)
    {
        var streams = src.MediaStreams ?? Array.Empty<MediaStream>();
        var v = src.VideoStream ?? streams.FirstOrDefault(s => s.Type == MediaStreamType.Video);

        long size = src.Size ?? 0;
        if (size <= 0 && File.Exists(src.Path))
        {
            size = new FileInfo(src.Path).Length;
        }

        Guid itemId = Guid.TryParse(src.Id, out var g) ? g : video.Id;

        var common = new MediaFile
        {
            ItemId = itemId,
            MediaSourceId = src.Id ?? video.Id.ToString("N"),
            Kind = video is Episode ? MediaKind.Episode : MediaKind.Movie,
            Title = video.Name ?? Path.GetFileNameWithoutExtension(src.Path),
            Year = video.ProductionYear,
            ProviderIds = video.ProviderIds ?? new Dictionary<string, string>(),
            Path = src.Path,
            SizeBytes = size,
            Container = src.Container ?? Path.GetExtension(src.Path).TrimStart('.'),
            DurationTicks = src.RunTimeTicks ?? video.RunTimeTicks ?? 0,
            VideoCodec = v?.Codec ?? string.Empty,
            VideoStreamIndex = v?.Index ?? -1,
            VideoProfile = v?.Profile,
            Width = v?.Width ?? 0,
            Height = v?.Height ?? 0,
            BitDepth = v?.BitDepth ?? 8,
            FrameRate = v?.AverageFrameRate ?? v?.RealFrameRate ?? 0,
            IsInterlaced = v?.IsInterlaced ?? false,
            Range = MapRange(v),
            ColorPrimaries = v?.ColorPrimaries,
            ColorTransfer = v?.ColorTransfer,
            ColorSpace = v?.ColorSpace,
            VideoBitrate = v?.BitRate ?? 0,
            TotalBitrate = src.Bitrate ?? 0,
            AudioTracks = streams.Where(s => s.Type == MediaStreamType.Audio)
                .OrderBy(s => s.Index)
                .Select(s => new AudioTrack(s.Codec ?? "unknown", s.Channels ?? 2, s.BitRate ?? 0, s.Language, s.Profile))
                .ToList(),
            SubtitleTracks = streams.Where(s => s.Type == MediaStreamType.Subtitle)
                .OrderBy(s => s.IsExternal).ThenBy(s => s.Index)
                .Select(s => new SubtitleTrack(s.Codec ?? "unknown", s.Language, s.IsForced, s.IsExternal))
                .ToList(),
            IsPlainFile = plainVideo,
        };

        if (video is Episode ep)
        {
            Guid seriesId = ep.SeriesId;
            if (!seriesCache.TryGetValue(seriesId, out var seriesIds))
            {
                seriesIds = (_library.GetItemById(seriesId) as Series)?.ProviderIds ?? new Dictionary<string, string>();
                seriesCache[seriesId] = seriesIds;
            }

            string se = ep.ParentIndexNumber is { } s && ep.IndexNumber is { } e
                ? $"S{s:00}E{e:00}" + (ep.IndexNumberEnd is { } end && end != e ? $"-E{end:00}" : string.Empty)
                : string.Empty;

            return common with
            {
                Title = $"{ep.SeriesName} {se}".Trim() + (string.IsNullOrEmpty(ep.Name) ? string.Empty : $" · {ep.Name}"),
                SeriesId = seriesId,
                SeriesName = ep.SeriesName,
                SeasonNumber = ep.ParentIndexNumber,
                EpisodeNumber = ep.IndexNumber,
                EpisodeNumberEnd = ep.IndexNumberEnd,
                ProviderIds = seriesIds,
            };
        }

        if (video is Movie && video.ProductionYear is { } y && !(video.Name ?? string.Empty).EndsWith($"({y})", StringComparison.Ordinal))
        {
            return common with { Title = $"{video.Name} ({y})" };
        }

        return common;
    }

    private static DynamicRange MapRange(MediaStream? v)
    {
        if (v is null)
        {
            return DynamicRange.Sdr;
        }

        return v.VideoRangeType switch
        {
            VideoRangeType.DOVI or VideoRangeType.DOVIWithHDR10 or VideoRangeType.DOVIWithHLG or VideoRangeType.DOVIWithSDR
                or VideoRangeType.DOVIWithEL or VideoRangeType.DOVIWithHDR10Plus or VideoRangeType.DOVIWithELHDR10Plus
                or VideoRangeType.DOVIInvalid => DynamicRange.DolbyVision,
            VideoRangeType.HDR10Plus => DynamicRange.Hdr10Plus,
            VideoRangeType.HDR10 => DynamicRange.Hdr10,
            VideoRangeType.HLG => DynamicRange.Hlg,
            _ => DynamicRange.Sdr,
        };
    }
}
