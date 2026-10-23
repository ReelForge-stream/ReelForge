namespace ReelForge.Core;

// Messages between the server and agents (other PCs converting files). This file is compiled into
// both the server module and the agent, so the two always agree.

public static class AgentProtocol
{
    /// <summary>Header carrying "agentId.secret" on every agent request.</summary>
    public const string AuthHeader = "X-ReelForge-Agent";

    public const string Input = "{input}";
    public const string Output = "{output}";
}

public sealed record AgentRegisterRequest(string Key, string Name, string? Os, string? Version);

public sealed record AgentRegisterResponse(string AgentId, string Secret, string ServerVersion);

/// <summary>
/// How one file the agent is working on is going. Phase is "downloading", "converting" or "uploading";
/// Progress is for that phase (0-1). Bytes are filled in while downloading or uploading.
/// </summary>
public sealed record AgentJobStatus(string JobId, double Progress, double? Speed, string? Phase, long? BytesDone = null, long? BytesTotal = null, double? BytesPerSecond = null);

/// <summary>Sent every few seconds: what the PC can do and how each of its files is going.</summary>
public sealed record AgentPollRequest(
    string? Version,
    List<string> Gpus,
    List<string> Encoders,
    List<string> TenBitHevc,
    List<AgentJobStatus> Jobs);

/// <summary>What an agent is told to do: ffmpeg arguments with {input}/{output} placeholders.</summary>
public sealed record AgentWork(string JobId, string Title, IReadOnlyList<string> Args, long DurationTicks, string SourceToken, string Encoder, long EstimatedBytes, long SourceBytes = 0);

/// <summary>
/// The reply: new files to start (never more than the agent's "files at once" allows), files to stop,
/// and the server's version (agents update to match).
/// </summary>
public sealed record AgentPollResponse(List<AgentWork> Start, List<string> Stop, string ServerVersion, int PollSeconds, bool Enabled, int MaxJobs);

public sealed record AgentFailRequest(string Error);

/// <summary>How much of a converted file the server has, and the biggest piece it takes at once.</summary>
public sealed record AgentUploadState(long Received, int MaxPart);
