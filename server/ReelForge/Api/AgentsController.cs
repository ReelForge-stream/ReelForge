using System.IO.Compression;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.MediaEncoding;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ReelForge.Core;
using ReelForge.Services;

namespace ReelForge.Api;

/// <summary>
/// What agents (other PCs) call. Not signed in to Jellyfin: pairing uses the pairing key, everything
/// after that the agent's own secret, and file downloads a one-off token per file.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("ReelForge/AgentApi")]
public sealed class AgentApiController : ControllerBase
{
    private readonly AgentRegistry _agents;
    private readonly ConversionQueue _queue;
    private readonly IMediaEncoder _encoder;

    public AgentApiController(AgentRegistry agents, ConversionQueue queue, IMediaEncoder encoder)
    {
        _agents = agents;
        _queue = queue;
        _encoder = encoder;
    }

    internal static string ServerVersion => typeof(Plugin).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "0.0.0";

    private string? Address => HttpContext.Connection.RemoteIpAddress?.ToString();

    [HttpPost("Register")]
    public ActionResult<AgentRegisterResponse> Register([FromBody] AgentRegisterRequest req)
    {
        if (!AgentRegistry.KeyMatches(AgentRegistry.PairingKey(), req.Key))
        {
            return Unauthorized("That pairing key isn't right. Copy the install script again from Media Manager → Agents.");
        }

        string name = string.IsNullOrWhiteSpace(req.Name) ? "PC" : req.Name.Trim()[..Math.Min(req.Name.Trim().Length, 64)];
        var (agent, secret) = _agents.Register(name, req.Os, req.Version, Address);
        return new AgentRegisterResponse(agent.Id, secret, ServerVersion);
    }

    [HttpPost("Poll")]
    public ActionResult<AgentPollResponse> Poll([FromBody] AgentPollRequest req)
    {
        if (Agent() is not { } a)
        {
            return Unauthorized();
        }

        _agents.Touch(a, r =>
        {
            r.Version = req.Version;
            r.Gpus = req.Gpus ?? new();
            r.Encoders = req.Encoders ?? new();
            r.TenBitHevc = req.TenBitHevc ?? new();
            r.Address = Address;
            r.CurrentJobIds = (req.Jobs ?? new()).Select(j => j.JobId).ToList();
        });

        var stop = new List<string>();
        int active = 0;
        foreach (var j in req.Jobs ?? new())
        {
            if (_queue.AgentShouldStop(a.Id, j.JobId))
            {
                stop.Add(j.JobId);
                continue;
            }

            active++;
            // While a finished file uploads, just keep it alive; otherwise record progress.
            _queue.AgentProgress(a.Id, j.JobId, j.Phase == "uploading" ? 0.999 : j.Progress, j.Phase == "uploading" ? null : j.Speed);
        }

        // Top the PC up to its "files at once".
        var start = new List<AgentWork>();
        int max = Math.Clamp(a.MaxJobs, 1, MaxJobsLimit);
        while (a.Enabled && active + start.Count < max && _queue.ClaimForAgent(a.Id, a.Name, a.Encoders, a.TenBitHevc, a.AllowCpu) is { } work)
        {
            start.Add(work);
        }

        if (start.Count > 0 && a.LastError is not null)
        {
            _agents.Update(a.Id, r => r.LastError = null); // it's working again
        }

        return new AgentPollResponse(start, stop, ServerVersion, start.Count > 0 || active > 0 ? 3 : 10, a.Enabled, max);
    }

    /// <summary>Most cards slow down past this many encodes at once (and GeForce cards cap NVENC sessions).</summary>
    internal const int MaxJobsLimit = 4;

    /// <summary>The original file, for the agent's ffmpeg to read (resumable, seekable).</summary>
    [HttpGet("Jobs/{id}/Source")]
    public ActionResult Source([FromRoute] string id, [FromQuery] string token)
    {
        var job = _queue.JobForSource(id, token ?? string.Empty);
        if (job is null || !System.IO.File.Exists(job.Path))
        {
            return NotFound();
        }

        return PhysicalFile(job.Path, "application/octet-stream", enableRangeProcessing: true);
    }

    /// <summary>The converted file coming back. Written next to the original, then checked and swapped in here.</summary>
    [HttpPut("Jobs/{id}/Result")]
    [DisableRequestSizeLimit]
    public async Task<ActionResult> Result([FromRoute] string id, CancellationToken ct)
    {
        if (Agent() is not { } a)
        {
            return Unauthorized();
        }

        var job = _queue.AgentJob(a.Id, id);
        if (job is null || job.Status != JobStatus.Running || _queue.AgentResultPath(job) is not { } path)
        {
            return Conflict("This file isn't yours to convert any more (cancelled or given to another PC).");
        }

        try
        {
            await using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20, useAsync: true))
            {
                await Request.Body.CopyToAsync(fs, 1 << 20, ct).ConfigureAwait(false);
            }
        }
        catch (Exception ex) when (ex is IOException or OperationCanceledException)
        {
            try
            {
                System.IO.File.Delete(path);
            }
            catch (IOException)
            {
            }

            _queue.AgentFailed(a.Id, id, "upload interrupted");
            return StatusCode(500, "Upload interrupted.");
        }

        _queue.AgentResultReady(job);
        return Accepted();
    }

    [HttpPost("Jobs/{id}/Failed")]
    public ActionResult Failed([FromRoute] string id, [FromBody] AgentFailRequest req)
    {
        if (Agent() is not { } a)
        {
            return Unauthorized();
        }

        _queue.AgentFailed(a.Id, id, string.IsNullOrWhiteSpace(req.Error) ? "conversion failed" : req.Error[..Math.Min(req.Error.Length, 300)]);
        return NoContent();
    }

    /// <summary>The server's own ffmpeg, so every agent uses the same build (installed by the install script).</summary>
    [HttpGet("Ffmpeg")]
    public ActionResult Ffmpeg([FromQuery] string key)
    {
        if (!AgentRegistry.KeyMatches(AgentRegistry.PairingKey(), key))
        {
            return Unauthorized();
        }

        string? ffmpeg = _encoder.EncoderPath;
        if (string.IsNullOrEmpty(ffmpeg) || !System.IO.File.Exists(ffmpeg))
        {
            return NotFound("This server has no ffmpeg to share.");
        }

        var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            zip.CreateEntryFromFile(ffmpeg, OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg", CompressionLevel.Fastest);
        }

        ms.Position = 0;
        return File(ms, "application/zip", "ffmpeg.zip");
    }

    private AgentRecord? Agent() => _agents.Authenticate(Request.Headers[AgentProtocol.AuthHeader].ToString());
}

public sealed record AgentUpdateRequest(bool? Enabled, bool? AllowCpu, string? Name, int? MaxJobs);

/// <summary>The Agents page in Media Manager (admin only).</summary>
[ApiController]
[Route("ReelForge/Agents")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class AgentsController : ControllerBase
{
    private readonly AgentRegistry _agents;
    private readonly ConversionQueue _queue;

    public AgentsController(AgentRegistry agents, ConversionQueue queue)
    {
        _agents = agents;
        _queue = queue;
    }

    [HttpGet]
    public ActionResult<object> List()
    {
        var jobs = _queue.List();
        return Ok(new
        {
            PairingKey = AgentRegistry.PairingKey(),
            ServerVersion = AgentApiController.ServerVersion,
            ConvertOnServer = Plugin.Instance!.Configuration.ConvertOnServer,
            Agents = _agents.List().Select(a =>
            {
                var mine = jobs.Where(j => j.AgentId == a.Id && j.Status is JobStatus.Running or JobStatus.Verifying).ToList();
                return new
                {
                    a.Id,
                    a.Name,
                    a.Enabled,
                    a.AllowCpu,
                    a.MaxJobs,
                    Online = AgentRegistry.IsOnline(a),
                    a.LastSeenUtc,
                    a.PairedUtc,
                    a.Version,
                    a.Os,
                    a.Address,
                    a.Gpus,
                    a.Encoders,
                    a.TenBitHevc,
                    a.FilesConverted,
                    a.BytesSaved,
                    a.LastError,
                    Jobs = mine.Select(job => new { job.Id, job.Title, job.Progress, job.Speed, job.EtaSeconds, job.Encoder, Status = job.Status.ToString() }),
                };
            }),
        });
    }

    [HttpPost("NewKey")]
    public ActionResult<object> NewKey() => Ok(new { PairingKey = AgentRegistry.RotatePairingKey() });

    [HttpPost("{id}")]
    public ActionResult Update([FromRoute] string id, [FromBody] AgentUpdateRequest req)
    {
        _agents.Update(id, a =>
        {
            if (req.Enabled is { } e)
            {
                a.Enabled = e;
            }

            if (req.AllowCpu is { } c)
            {
                a.AllowCpu = c;
            }

            if (req.MaxJobs is { } m)
            {
                a.MaxJobs = Math.Clamp(m, 1, AgentApiController.MaxJobsLimit);
            }

            if (!string.IsNullOrWhiteSpace(req.Name))
            {
                a.Name = req.Name.Trim();
            }
        });
        return NoContent();
    }

    [HttpDelete("{id}")]
    public ActionResult Remove([FromRoute] string id)
    {
        foreach (var j in _queue.List().Where(j => j.AgentId == id && j.Status == JobStatus.Running))
        {
            _queue.AgentFailed(id, j.Id, "agent removed");
        }

        return _agents.Remove(id) ? NoContent() : NotFound();
    }

    [HttpPost("ConvertOnServer")]
    public ActionResult ConvertOnServer([FromQuery] bool on)
    {
        Plugin.Instance!.Configuration.ConvertOnServer = on;
        Plugin.Instance.SaveConfiguration();
        return NoContent();
    }
}
