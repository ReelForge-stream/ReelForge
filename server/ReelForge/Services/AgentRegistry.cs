using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>Another PC that converts files for this server.</summary>
public sealed class AgentRecord
{
    public required string Id { get; init; }

    public required string Name { get; set; }

    /// <summary>Gets or sets the SHA-256 of the agent's secret; the secret itself is only ever on the agent.</summary>
    public required string SecretHash { get; init; }

    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether this agent may use its processor when its graphics card can't do a file.</summary>
    public bool AllowCpu { get; set; }

    public DateTime PairedUtc { get; init; } = DateTime.UtcNow;

    public DateTime LastSeenUtc { get; set; }

    public string? Version { get; set; }

    public string? Os { get; set; }

    public string? Address { get; set; }

    /// <summary>Gets or sets the server address the agent uses (host[:port]), to spot agents going out over the internet.</summary>
    public string? ServerHost { get; set; }

    public List<string> Gpus { get; set; } = new();

    /// <summary>Gets or sets the encoders that passed a test encode on the agent (hevc_nvenc, hevc_amf, ...).</summary>
    public List<string> Encoders { get; set; } = new();

    /// <summary>Gets or sets the GPU HEVC encoders that also passed a 10-bit test.</summary>
    public List<string> TenBitHevc { get; set; } = new();

    /// <summary>Gets or sets how many files this PC converts at the same time (1 to 4).</summary>
    public int MaxJobs { get; set; } = 1;

    public List<string> CurrentJobIds { get; set; } = new();

    public int FilesConverted { get; set; }

    public long BytesSaved { get; set; }

    public string? LastError { get; set; }
}

/// <summary>
/// The PCs paired with this server (agents.json in the ReelForge data folder) and the pairing key
/// new ones use. Each agent gets its own random secret at pairing; only its hash is stored here.
/// </summary>
public sealed class AgentRegistry
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    private readonly object _gate = new();
    private readonly List<AgentRecord> _agents;
    private readonly ILogger<AgentRegistry> _logger;
    private readonly string _path;

    public AgentRegistry(ILogger<AgentRegistry> logger)
        : this(logger, Path.Combine(Plugin.Instance?.DataDirectory ?? Path.GetTempPath(), "agents.json"))
    {
    }

    internal AgentRegistry(ILogger<AgentRegistry> logger, string path)
    {
        _logger = logger;
        _path = path;
        _agents = Load();
    }

    /// <summary>An agent counts as online if it checked in within this long (it checks in every few seconds).</summary>
    public static readonly TimeSpan OnlineWindow = TimeSpan.FromSeconds(30);

    public IReadOnlyList<AgentRecord> List()
    {
        lock (_gate)
        {
            return _agents.OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }
    }

    /// <summary>
    /// True when the agent reaches this server by a public name (e.g. through Cloudflare) rather than a
    /// local address: every byte then goes out to the internet and back, slowly and with upload limits.
    /// </summary>
    public static bool LooksLikeInternet(string? host)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            return false;
        }

        string h = host.Trim();
        if (h.StartsWith('['))
        {
            return false; // IPv6 literal
        }

        int colon = h.LastIndexOf(':');
        if (colon > 0)
        {
            h = h[..colon];
        }

        h = h.TrimEnd('.').ToLowerInvariant();
        if (System.Net.IPAddress.TryParse(h, out _) || !h.Contains('.'))
        {
            return false; // an IP address or a plain PC name
        }

        return !(h.EndsWith(".local", StringComparison.Ordinal) || h.EndsWith(".lan", StringComparison.Ordinal) || h.EndsWith(".home.arpa", StringComparison.Ordinal)
            || h.EndsWith(".internal", StringComparison.Ordinal) || h.EndsWith(".localdomain", StringComparison.Ordinal));
    }

    public static bool IsOnline(AgentRecord a) => DateTime.UtcNow - a.LastSeenUtc < OnlineWindow;

    /// <summary>The current pairing key, made on first use. Shape: XXXX-XXXX-XXXX (no look-alike letters).</summary>
    public static string PairingKey()
    {
        var c = Plugin.Instance!.Configuration;
        if (string.IsNullOrEmpty(c.AgentPairingKey))
        {
            c.AgentPairingKey = NewKey();
            Plugin.Instance.SaveConfiguration();
        }

        return c.AgentPairingKey;
    }

    public static string RotatePairingKey()
    {
        Plugin.Instance!.Configuration.AgentPairingKey = NewKey();
        Plugin.Instance.SaveConfiguration();
        return Plugin.Instance.Configuration.AgentPairingKey;
    }

    internal static string NewKey()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var b = RandomNumberGenerator.GetBytes(12);
        var sb = new StringBuilder();
        for (int i = 0; i < 12; i++)
        {
            if (i is 4 or 8)
            {
                sb.Append('-');
            }

            sb.Append(alphabet[b[i] % alphabet.Length]);
        }

        return sb.ToString();
    }

    internal static bool KeyMatches(string expected, string? given)
    {
        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(given))
        {
            return false;
        }

        static byte[] Norm(string k) => Encoding.ASCII.GetBytes(k.Trim().ToUpperInvariant().Replace("-", string.Empty, StringComparison.Ordinal));
        return CryptographicOperations.FixedTimeEquals(Norm(expected), Norm(given));
    }

    /// <summary>Pairs a new agent (or re-pairs a reinstalled one with the same name). Returns its secret, shown to the agent once.</summary>
    public (AgentRecord Agent, string Secret) Register(string name, string? os, string? version, string? address)
    {
        string secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        lock (_gate)
        {
            // Reinstalling on the same PC replaces its old entry instead of leaving a dead one behind.
            var old = _agents.FirstOrDefault(a => a.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
            var agent = new AgentRecord
            {
                Id = old?.Id ?? Guid.NewGuid().ToString("N")[..12],
                Name = name,
                SecretHash = Hash(secret),
                Enabled = old?.Enabled ?? true,
                AllowCpu = old?.AllowCpu ?? false,
                MaxJobs = old?.MaxJobs ?? 1,
                FilesConverted = old?.FilesConverted ?? 0,
                BytesSaved = old?.BytesSaved ?? 0,
                Os = os,
                Version = version,
                Address = address,
                LastSeenUtc = DateTime.UtcNow,
            };
            if (old is not null)
            {
                _agents.Remove(old);
            }

            _agents.Add(agent);
            Save();
            _logger.LogInformation("ReelForge: agent {Name} paired from {Address}", name, address);
            return (agent, secret);
        }
    }

    /// <summary>Checks "id.secret" from an agent's request.</summary>
    public AgentRecord? Authenticate(string? credential)
    {
        if (string.IsNullOrEmpty(credential) || !credential.Contains('.', StringComparison.Ordinal))
        {
            return null;
        }

        var (id, secret) = (credential[..credential.IndexOf('.', StringComparison.Ordinal)], credential[(credential.IndexOf('.', StringComparison.Ordinal) + 1)..]);
        lock (_gate)
        {
            var a = _agents.FirstOrDefault(x => x.Id == id);
            if (a is null)
            {
                return null;
            }

            return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(a.SecretHash), Encoding.ASCII.GetBytes(Hash(secret))) ? a : null;
        }
    }

    public void Touch(AgentRecord a, Action<AgentRecord> update)
    {
        lock (_gate)
        {
            bool wasOffline = !IsOnline(a);
            update(a);
            a.LastSeenUtc = DateTime.UtcNow;
            if (wasOffline)
            {
                Save(); // persist "last seen" occasionally, not every few seconds
            }
        }
    }

    public void Update(string id, Action<AgentRecord> update)
    {
        lock (_gate)
        {
            if (_agents.FirstOrDefault(a => a.Id == id) is { } a)
            {
                update(a);
                Save();
            }
        }
    }

    public bool Remove(string id)
    {
        lock (_gate)
        {
            int n = _agents.RemoveAll(a => a.Id == id);
            Save();
            return n > 0;
        }
    }

    internal static string Hash(string secret) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    private List<AgentRecord> Load()
    {
        try
        {
            return File.Exists(_path) ? JsonSerializer.Deserialize<List<AgentRecord>>(File.ReadAllText(_path), Json) ?? new() : new();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ReelForge: couldn't read the agent list");
            return new();
        }
    }

    private void Save()
    {
        try
        {
            string tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(_agents, Json));
            File.Move(tmp, _path, true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ReelForge: couldn't save the agent list");
        }
    }
}
