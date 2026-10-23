using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ReelForge.Agent;

/// <summary>Where this agent's server is and its credentials. The secret is DPAPI-protected on Windows.</summary>
public sealed class AgentConfig
{
    public string Server { get; set; } = string.Empty;

    public string AgentId { get; set; } = string.Empty;

    /// <summary>Gets or sets the secret, encrypted for this machine on Windows (base64), plain elsewhere.</summary>
    public string SecretData { get; set; } = string.Empty;

    public string Name { get; set; } = Environment.MachineName;

    public static string DataDir =>
        Environment.GetEnvironmentVariable("REELFORGE_AGENT_DATA") is { Length: > 0 } d ? d
        : OperatingSystem.IsWindows() ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ReelForge Agent")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".reelforge-agent");

    private static string FilePath => Path.Combine(DataDir, "agent.json");

    public string Secret
    {
        get
        {
            byte[] b = Convert.FromBase64String(SecretData);
            if (OperatingSystem.IsWindows())
            {
                b = ProtectedData.Unprotect(b, null, DataProtectionScope.LocalMachine);
            }

            return Encoding.UTF8.GetString(b);
        }

        set
        {
            byte[] b = Encoding.UTF8.GetBytes(value);
            if (OperatingSystem.IsWindows())
            {
                b = ProtectedData.Protect(b, null, DataProtectionScope.LocalMachine);
            }

            SecretData = Convert.ToBase64String(b);
        }
    }

    public string Credential => $"{AgentId}.{Secret}";

    public static AgentConfig? Load()
    {
        try
        {
            return File.Exists(FilePath) ? JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(FilePath)) : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(DataDir);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
