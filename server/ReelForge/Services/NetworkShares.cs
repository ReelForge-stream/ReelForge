using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

public sealed record SavedShare
{
    public required string Id { get; init; }

    /// <summary>Gets the share root, e.g. \\10.0.0.201\plexdata.</summary>
    public required string Path { get; init; }

    public string Username { get; init; } = string.Empty;

    /// <summary>Gets the password, encrypted for this machine (Windows DPAPI). Never sent to clients.</summary>
    public string ProtectedPassword { get; init; } = string.Empty;
}

public sealed record ShareStatus(string Id, string Path, string Username, bool Connected);

public sealed record MappedDrive(string Letter, string Path, bool Reachable);

/// <summary>
/// Lets the ReelForge service reach NAS shares itself. Windows services run as the system account,
/// which has no NAS passwords and can't see the drive letters you mapped in your own login. So
/// ReelForge signs in to each share (WNetAddConnection2, no drive letter), keeps the sign-in
/// encrypted with DPAPI for this machine, and reconnects at startup and whenever a share drops.
/// </summary>
public sealed class NetworkShares : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    private readonly ILogger<NetworkShares> _logger;
    private readonly object _gate = new();
    private readonly string _file;
    private List<SavedShare> _shares;

    public NetworkShares(ILogger<NetworkShares> logger)
    {
        _logger = logger;
        string dir = Plugin.Instance?.DataDirectory ?? System.IO.Path.Combine(System.IO.Path.GetTempPath(), "reelforge");
        Directory.CreateDirectory(dir);
        _file = System.IO.Path.Combine(dir, "network-shares.json");
        _shares = Load();
        ReconnectAll(); // as early as possible, before the first library scan
    }

    public IReadOnlyList<ShareStatus> List()
    {
        lock (_gate)
        {
            return _shares.Select(s => new ShareStatus(s.Id, s.Path, s.Username, Exists(s.Path))).ToList();
        }
    }

    /// <summary>Signs in to the share that contains <paramref name="anyPath"/> and remembers it.</summary>
    public string Connect(string anyPath, string username, string password, bool save)
    {
        string root = ShareRoot(anyPath) ?? throw new ArgumentException("Use a network path like \\\\nas\\share");
        Win32Connect(root, username, password);
        if (save)
        {
            lock (_gate)
            {
                _shares.RemoveAll(s => s.Path.Equals(root, StringComparison.OrdinalIgnoreCase));
                _shares.Add(new SavedShare
                {
                    Id = Guid.NewGuid().ToString("N")[..10],
                    Path = root,
                    Username = username,
                    ProtectedPassword = Secret.Protect(password),
                });
                Save();
            }
        }

        _logger.LogInformation("ReelForge: connected to {Share} as {User}", root, string.IsNullOrEmpty(username) ? "(guest)" : username);
        return root;
    }

    public void Forget(string id)
    {
        lock (_gate)
        {
            var share = _shares.FirstOrDefault(s => s.Id == id);
            if (share is null)
            {
                return;
            }

            _shares.Remove(share);
            Save();
            if (OperatingSystem.IsWindows())
            {
                _ = WNetCancelConnection2W(share.Path, 0, true);
            }
        }
    }

    /// <summary>Lists the disk shares a NAS offers (hidden $ shares left out). Signs in first if credentials are given.</summary>
    public IReadOnlyList<string> SharesOn(string server, string username, string password)
    {
        server = server.Trim().TrimStart('\\').Split('\\')[0];
        if (string.IsNullOrWhiteSpace(server))
        {
            throw new ArgumentException("Enter the NAS address, like 10.0.0.201 or nas");
        }

        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Listing shares needs Windows.");
        }

        if (!string.IsNullOrEmpty(username))
        {
            Win32Connect($@"\\{server}\IPC$", username, password);
        }

        return EnumerateShares(server);
    }

    /// <summary>
    /// Drive letters people mapped in their own Windows logins (Z: → \\nas\share). The service can't
    /// use the letter, but it can use the network path behind it.
    /// </summary>
    public IReadOnlyList<MappedDrive> MappedDrives()
    {
        if (!OperatingSystem.IsWindows())
        {
            return Array.Empty<MappedDrive>();
        }

        var found = new Dictionary<string, MappedDrive>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var users = Microsoft.Win32.Registry.Users;
            foreach (string sid in users.GetSubKeyNames())
            {
                using var net = users.OpenSubKey(sid + @"\Network");
                if (net is null)
                {
                    continue;
                }

                foreach (string letter in net.GetSubKeyNames())
                {
                    using var drive = net.OpenSubKey(letter);
                    if (drive?.GetValue("RemotePath") is string remote && remote.StartsWith(@"\\", StringComparison.Ordinal))
                    {
                        found[remote] = new MappedDrive(letter.ToUpperInvariant() + ":", remote, Exists(remote));
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ReelForge: could not read mapped drives");
        }

        return found.Values.OrderBy(d => d.Letter, StringComparer.Ordinal).ToList();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // A NAS that reboots or sleeps drops the session; put it back.
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken).ConfigureAwait(false);
            ReconnectAll(onlyIfMissing: true);
        }
    }

    private void ReconnectAll(bool onlyIfMissing = false)
    {
        List<SavedShare> shares;
        lock (_gate)
        {
            shares = _shares.ToList();
        }

        foreach (var s in shares)
        {
            if (onlyIfMissing && Exists(s.Path))
            {
                continue;
            }

            try
            {
                Win32Connect(s.Path, s.Username, Secret.Unprotect(s.ProtectedPassword));
                _logger.LogInformation("ReelForge: reconnected {Share}", s.Path);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("ReelForge: could not reconnect {Share}: {Error}", s.Path, ex.Message);
            }
        }
    }

    /// <summary>\\server\share\Movies\x → \\server\share; anything else → null.</summary>
    public static string? ShareRoot(string path)
    {
        string p = path.Trim().Replace('/', '\\');
        if (!p.StartsWith(@"\\", StringComparison.Ordinal))
        {
            return null;
        }

        var parts = p[2..].Split('\\', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 ? $@"\\{parts[0]}\{parts[1]}" : null;
    }

    /// <summary>Plain-language reasons for the Windows network errors people actually hit.</summary>
    public static string Explain(int code) => code switch
    {
        5 => "Access denied. That account can't open this share.",
        53 => "Can't find that NAS. Check the address and that it's on.",
        67 => "That NAS has no share by that name.",
        86 or 1326 => "The username or password is wrong.",
        1219 => "Windows already has a different sign-in for this NAS. Restart the ReelForge service and try again.",
        1244 or 1311 => "The NAS needs a username and password.",
        1909 => "That account is locked on the NAS.",
        2202 => "That username isn't valid on the NAS.",
        _ => new Win32Exception(code).Message,
    };

    private static bool Exists(string path)
    {
        try
        {
            return Directory.Exists(path);
        }
        catch (Exception)
        {
            return false;
        }
    }

    private void Win32Connect(string remote, string username, string password)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Connecting to network shares needs Windows.");
        }

        var res = new NETRESOURCEW { dwType = 1 /* RESOURCETYPE_DISK */, lpRemoteName = remote };
        string? user = string.IsNullOrEmpty(username) ? null : username;
        string? pass = string.IsNullOrEmpty(password) && user is null ? null : password;
        int rc = WNetAddConnection2W(ref res, pass, user, 0);
        if (rc == 1219)
        {
            // Already connected with other credentials: drop that session and use the new ones.
            _ = WNetCancelConnection2W(remote, 0, true);
            rc = WNetAddConnection2W(ref res, pass, user, 0);
        }

        if (rc != 0 && rc != 85 /* already connected */)
        {
            throw new InvalidOperationException(Explain(rc));
        }
    }

    [SupportedOSPlatform("windows")]
    private static List<string> EnumerateShares(string server)
    {
        int rc = NetShareEnum(server, 1, out IntPtr buffer, -1, out int read, out _, IntPtr.Zero);
        try
        {
            if (rc != 0)
            {
                throw new InvalidOperationException(Explain(rc));
            }

            var names = new List<string>();
            int size = Marshal.SizeOf<SHARE_INFO_1>();
            for (int i = 0; i < read; i++)
            {
                var info = Marshal.PtrToStructure<SHARE_INFO_1>(buffer + (i * size));
                bool disk = (info.shi1_type & 0xFF) == 0; // STYPE_DISKTREE
                if (disk && info.shi1_netname is { } n && !n.EndsWith('$'))
                {
                    names.Add(n);
                }
            }

            names.Sort(StringComparer.OrdinalIgnoreCase);
            return names;
        }
        finally
        {
            if (buffer != IntPtr.Zero)
            {
                _ = NetApiBufferFree(buffer);
            }
        }
    }

    private List<SavedShare> Load()
    {
        try
        {
            return File.Exists(_file) ? JsonSerializer.Deserialize<List<SavedShare>>(File.ReadAllText(_file), Json) ?? new() : new();
        }
        catch (Exception)
        {
            return new();
        }
    }

    private void Save()
    {
        string tmp = _file + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_shares, Json));
        File.Move(tmp, _file, true);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NETRESOURCEW
    {
        public int dwScope;
        public int dwType;
        public int dwDisplayType;
        public int dwUsage;
        public string? lpLocalName;
        public string? lpRemoteName;
        public string? lpComment;
        public string? lpProvider;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHARE_INFO_1
    {
        public string? shi1_netname;
        public uint shi1_type;
        public string? shi1_remark;
    }

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetAddConnection2W(ref NETRESOURCEW netResource, string? password, string? username, int flags);

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetCancelConnection2W(string name, int flags, bool force);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetShareEnum(string serverName, int level, out IntPtr bufPtr, int prefMaxLen, out int entriesRead, out int totalEntries, IntPtr resumeHandle);

    [DllImport("netapi32.dll")]
    private static extern int NetApiBufferFree(IntPtr buffer);
}

/// <summary>Encrypts saved NAS passwords so only this machine can read them (Windows DPAPI, machine scope).</summary>
internal static class Secret
{
    private const string Prefix = "dpapi:";

    public static string Protect(string plain)
    {
        if (string.IsNullOrEmpty(plain))
        {
            return string.Empty;
        }

        if (!OperatingSystem.IsWindows())
        {
            return "plain:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(plain)); // dev/test only
        }

        return Prefix + Convert.ToBase64String(Dpapi(Encoding.UTF8.GetBytes(plain), protect: true));
    }

    public static string Unprotect(string stored)
    {
        if (string.IsNullOrEmpty(stored))
        {
            return string.Empty;
        }

        if (stored.StartsWith("plain:", StringComparison.Ordinal))
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(stored[6..]));
        }

        if (!stored.StartsWith(Prefix, StringComparison.Ordinal) || !OperatingSystem.IsWindows())
        {
            return string.Empty;
        }

        return Encoding.UTF8.GetString(Dpapi(Convert.FromBase64String(stored[Prefix.Length..]), protect: false));
    }

    [SupportedOSPlatform("windows")]
    private static byte[] Dpapi(byte[] data, bool protect)
    {
        var input = new DATA_BLOB();
        var output = new DATA_BLOB();
        var handle = GCHandle.Alloc(data, GCHandleType.Pinned);
        try
        {
            input.cbData = data.Length;
            input.pbData = handle.AddrOfPinnedObject();
            const int LocalMachine = 0x4, NoUi = 0x1;
            bool ok = protect
                ? CryptProtectData(ref input, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, LocalMachine | NoUi, ref output)
                : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, NoUi, ref output);
            if (!ok)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            var result = new byte[output.cbData];
            Marshal.Copy(output.pbData, result, 0, output.cbData);
            return result;
        }
        finally
        {
            handle.Free();
            if (output.pbData != IntPtr.Zero)
            {
                _ = LocalFree(output.pbData);
            }
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DATA_BLOB
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(ref DATA_BLOB dataIn, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref DATA_BLOB dataOut);

    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern bool CryptUnprotectData(ref DATA_BLOB dataIn, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref DATA_BLOB dataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr mem);
}
