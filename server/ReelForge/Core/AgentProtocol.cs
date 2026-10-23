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

/// <summary>Sent every few seconds: what the PC can do and how the current file is going.</summary>
public sealed record AgentPollRequest(
    string? Version,
    List<string> Gpus,
    List<string> Encoders,
    List<string> TenBitHevc,
    string? JobId,
    double Progress,
    double? Speed,
    string? Phase);

/// <summary>What an agent is told to do: ffmpeg arguments with {input}/{output} placeholders.</summary>
public sealed record AgentWork(string JobId, string Title, IReadOnlyList<string> Args, long DurationTicks, string SourceToken, string Encoder, long EstimatedBytes);

/// <summary>The reply: maybe a file to convert, files to stop, and the server's version (agents update to match).</summary>
public sealed record AgentPollResponse(AgentWork? Job, List<string> Stop, string ServerVersion, int PollSeconds, bool Enabled);

public sealed record AgentFailRequest(string Error);
