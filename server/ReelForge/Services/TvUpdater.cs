using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace ReelForge.Services;

/// <summary>A Roku TV (or stick) running the ReelForge app.</summary>
public sealed class TvRecord
{
    /// <summary>Gets the app's id for this TV (Roku's per-app client id).</summary>
    public required string Id { get; init; }

    public string Name { get; set; } = "Roku";

    public string? Model { get; set; }

    /// <summary>Gets or sets the TV's address on the home network, as the app reported it.</summary>
    public string? Ip { get; set; }

    public string? AppVersion { get; set; }

    public string? UserName { get; set; }

    public DateTime LastSeenUtc { get; set; }

    /// <summary>Gets or sets the Roku's serial number, read from the TV itself when the password was saved.
    /// Updates are only sent to an address that answers with this serial.</summary>
    public string? Serial { get; set; }

    /// <summary>Gets or sets the developer-mode password, encrypted on this machine. Never sent to clients.</summary>
    public string ProtectedPassword { get; set; } = string.Empty;

    public string? Status { get; set; }

    public bool StatusIsError { get; set; }

    public DateTime StatusUtc { get; set; }

    /// <summary>Gets or sets the version the last automatic install tried, and when, so a failing TV isn't retried on every launch.</summary>
    public string? LastAttemptVersion { get; set; }

    public DateTime LastAttemptUtc { get; set; }
}

/// <summary>What the TV app hears back when it checks in.</summary>
public sealed record TvCheckInResult(string ServerVersion, bool UpdateAvailable, bool AutoUpdate, bool Updating);

/// <summary>
/// Keeps the ReelForge Roku app on every TV at the same version as this server. Each TV checks in when the
/// app opens; if it's behind and an admin saved that TV's developer password (Media Manager → TVs), the server
/// downloads ReelForge-Roku-&lt;version&gt;.zip from the GitHub release and installs it on the TV through
/// Roku's developer installer (http://&lt;tv&gt;/plugin_install), the same thing the README has people do by hand.
/// </summary>
public sealed partial class TvUpdater
{
    public const string ReleaseAssetUrl = "https://github.com/ReelForge-stream/ReelForge/releases/download/v{0}/ReelForge-Roku-{0}.zip";

    /// <summary>A TV whose automatic install failed isn't retried for this long (the admin can still press Update now).</summary>
    public static readonly TimeSpan RetryAfter = TimeSpan.FromHours(6);

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    private static readonly HttpClient Download = new() { Timeout = TimeSpan.FromMinutes(5) };
    private static readonly HttpClient Ecp = new() { Timeout = TimeSpan.FromSeconds(5) };

    private readonly object _gate = new();
    private readonly List<TvRecord> _tvs;

    // Tests point these at a stand-in Roku on this machine
    internal static bool AllowLoopbackForTests { get; set; }

    internal static int InstallerPort { get; set; } = 80;

    internal static int EcpPort { get; set; } = 8060;
    private readonly HashSet<string> _busy = new(StringComparer.Ordinal);
    private readonly ILogger<TvUpdater> _logger;
    private readonly string _path;
    private readonly string _dataDir;

    public TvUpdater(ILogger<TvUpdater> logger)
        : this(logger, Plugin.Instance?.DataDirectory ?? Path.GetTempPath())
    {
    }

    internal TvUpdater(ILogger<TvUpdater> logger, string dataDir)
    {
        _logger = logger;
        _dataDir = dataDir;
        _path = Path.Combine(dataDir, "tvs.json");
        _tvs = Load();
    }

    /// <summary>Gets or sets the version TVs should run; defaults to this server's version (tests override it).</summary>
    internal string? TargetVersionOverride { get; set; }

    public string TargetVersion => TargetVersionOverride ?? Api.AgentApiController.ServerVersion;

    [GeneratedRegex("^[A-Za-z0-9._-]{1,128}$")]
    private static partial Regex IdPattern();

    public IReadOnlyList<TvRecord> List()
    {
        lock (_gate)
        {
            return _tvs.OrderByDescending(t => t.LastSeenUtc).ToList();
        }
    }

    public bool IsBusy(string id)
    {
        lock (_gate)
        {
            return _busy.Contains(id);
        }
    }

    /// <summary>True when <paramref name="have"/> is an older x.y.z than <paramref name="want"/>.</summary>
    public static bool IsOlder(string? have, string? want)
    {
        if (!TryVersion(want, out var w))
        {
            return false;
        }

        return !TryVersion(have, out var h) || h < w;
    }

    private static bool TryVersion(string? s, out Version v)
    {
        v = new Version(0, 0);
        if (string.IsNullOrWhiteSpace(s))
        {
            return false;
        }

        var parts = s.Trim().TrimStart('v').Split('.');
        if (parts.Length < 2 || parts.Length > 4 || !parts.All(p => int.TryParse(p, out _)))
        {
            return false;
        }

        v = new Version(int.Parse(parts[0]), int.Parse(parts[1]), parts.Length > 2 ? int.Parse(parts[2]) : 0);
        return true;
    }

    /// <summary>
    /// True for an IPv4 address on a home network (10.x, 172.16-31.x, 192.168.x). Passwords are only ever
    /// sent to these, never to an address on the internet.
    /// </summary>
    public static bool IsHomeAddress(string? ip)
    {
        if (!IPAddress.TryParse(ip, out var a) || a.AddressFamily != AddressFamily.InterNetwork)
        {
            return false;
        }

        var b = a.GetAddressBytes();
        if (AllowLoopbackForTests && b[0] == 127)
        {
            return true;
        }

        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
    }

    /// <summary>The TV app opened: remember it and, if it's behind and we may, start updating it.</summary>
    public TvCheckInResult CheckIn(string id, string? name, string? model, string? ip, string? appVersion, string? userName)
    {
        if (!IdPattern().IsMatch(id ?? string.Empty))
        {
            throw new ArgumentException("Bad TV id");
        }

        string target = TargetVersion;
        TvRecord tv;
        bool start = false;
        lock (_gate)
        {
            tv = _tvs.FirstOrDefault(t => t.Id == id) ?? Add(id!);
            tv.Name = Clean(name, 60) ?? tv.Name;
            tv.Model = Clean(model, 40) ?? tv.Model;
            if (IsHomeAddress(ip))
            {
                tv.Ip = ip;
            }

            tv.AppVersion = Clean(appVersion, 20);
            tv.UserName = Clean(userName, 60) ?? tv.UserName;
            tv.LastSeenUtc = DateTime.UtcNow;

            bool behind = IsOlder(tv.AppVersion, target);
            if (!behind && tv.LastAttemptVersion == target && !tv.StatusIsError && !_busy.Contains(id!))
            {
                SetStatus(tv, $"Up to date ({target})", false);
            }

            if (behind && tv.ProtectedPassword.Length > 0 && !_busy.Contains(id!)
                && !(tv.LastAttemptVersion == target && DateTime.UtcNow - tv.LastAttemptUtc < RetryAfter))
            {
                start = true;
            }

            Save();
        }

        if (start)
        {
            StartInstall(id!, automatic: true);
        }

        return new TvCheckInResult(target, IsOlder(tv.AppVersion, target), tv.ProtectedPassword.Length > 0, IsBusy(id!));
    }

    /// <summary>Saves (or with an empty password, forgets) a TV's developer password. Reads the TV's serial
    /// so updates later only go to this same Roku, and checks the password against the TV right away.</summary>
    public async Task<(bool Ok, string Message)> SetPasswordAsync(string id, string password, CancellationToken ct)
    {
        string? ip;
        lock (_gate)
        {
            var tv = _tvs.FirstOrDefault(t => t.Id == id) ?? throw new KeyNotFoundException();
            if (string.IsNullOrEmpty(password))
            {
                tv.ProtectedPassword = string.Empty;
                tv.Serial = null;
                SetStatus(tv, "Automatic updates off", false);
                Save();
                return (true, "Password removed. This TV won't update by itself.");
            }

            ip = tv.Ip;
        }

        if (!IsHomeAddress(ip))
        {
            return (false, "This TV hasn't reported its home-network address yet. Open ReelForge on the TV once, then try again.");
        }

        string? serial = await ReadSerialAsync(ip!, ct).ConfigureAwait(false);
        if (serial is null)
        {
            return (false, $"Couldn't reach the TV at {ip}. Make sure it's on, and on the same network as this server.");
        }

        var check = await CheckPasswordAsync(ip!, password, ct).ConfigureAwait(false);
        if (check is not null)
        {
            return (false, check);
        }

        lock (_gate)
        {
            var tv = _tvs.FirstOrDefault(t => t.Id == id) ?? throw new KeyNotFoundException();
            tv.ProtectedPassword = TvSecret.Protect(password, _dataDir);
            tv.Serial = serial;
            tv.LastAttemptVersion = null;
            SetStatus(tv, "Automatic updates on", false);
            Save();
        }

        return (true, "Saved. This TV now updates by itself when a new version comes out.");
    }

    public bool Remove(string id)
    {
        lock (_gate)
        {
            bool removed = _tvs.RemoveAll(t => t.Id == id) > 0;
            Save();
            return removed;
        }
    }

    /// <summary>Starts installing the current version on a TV in the background. False if it's already updating or has no password.</summary>
    public bool StartInstall(string id, bool automatic)
    {
        lock (_gate)
        {
            var tv = _tvs.FirstOrDefault(t => t.Id == id);
            if (tv is null || tv.ProtectedPassword.Length == 0 || !_busy.Add(id))
            {
                return false;
            }

            tv.LastAttemptVersion = TargetVersion;
            tv.LastAttemptUtc = DateTime.UtcNow;
            SetStatus(tv, "Getting the update…", false);
            Save();
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await InstallAsync(id, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ReelForge: updating TV {Id} failed", id);
                Update(id, t => SetStatus(t, "Update failed: " + ex.Message, true));
            }
            finally
            {
                lock (_gate)
                {
                    _busy.Remove(id);
                }
            }
        });
        return true;
    }

    private async Task InstallAsync(string id, CancellationToken ct)
    {
        string version = TargetVersion;
        TvRecord snapshot;
        lock (_gate)
        {
            var tv = _tvs.First(t => t.Id == id);
            snapshot = new TvRecord { Id = tv.Id, Ip = tv.Ip, Serial = tv.Serial, ProtectedPassword = tv.ProtectedPassword };
        }

        if (!IsHomeAddress(snapshot.Ip))
        {
            throw new InvalidOperationException("the TV's home-network address isn't known yet");
        }

        string zip = await GetPackageAsync(version, ct).ConfigureAwait(false);

        // Only hand the password to the same Roku the admin set it up on
        string? serial = await ReadSerialAsync(snapshot.Ip!, ct).ConfigureAwait(false);
        if (serial is null)
        {
            throw new InvalidOperationException($"couldn't reach the TV at {snapshot.Ip}");
        }

        if (!string.IsNullOrEmpty(snapshot.Serial) && !string.Equals(serial, snapshot.Serial, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"a different Roku answered at {snapshot.Ip}; save this TV's password again");
        }

        Update(id, t => SetStatus(t, $"Installing {version}…", false));
        string password = TvSecret.Unprotect(snapshot.ProtectedPassword, _dataDir);
        string result = await UploadAsync(snapshot.Ip!, password, zip, ct).ConfigureAwait(false);
        Update(id, t =>
        {
            t.AppVersion = result == "identical" ? version : t.AppVersion;
            SetStatus(t, $"Installed {version}", false);
        });
        _logger.LogInformation("ReelForge: installed Roku app {Version} on {Ip}", version, snapshot.Ip);
    }

    /// <summary>The Roku app .zip for a version, downloaded once from the GitHub release and kept in the data folder.</summary>
    private async Task<string> GetPackageAsync(string version, CancellationToken ct)
    {
        string dir = Path.Combine(_dataDir, "roku");
        Directory.CreateDirectory(dir);
        string path = Path.Combine(dir, $"ReelForge-Roku-{version}.zip");
        if (File.Exists(path) && new FileInfo(path).Length > 0)
        {
            return path;
        }

        foreach (var old in Directory.GetFiles(dir, "ReelForge-Roku-*.zip"))
        {
            File.Delete(old); // only the current version is ever needed
        }

        string url = string.Format(System.Globalization.CultureInfo.InvariantCulture, ReleaseAssetUrl, version);
        using var resp = await Download.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (resp.StatusCode == HttpStatusCode.NotFound)
        {
            throw new InvalidOperationException($"ReelForge {version} has no Roku app on GitHub yet");
        }

        resp.EnsureSuccessStatusCode();
        string tmp = path + ".part";
        await using (var fs = File.Create(tmp))
        {
            await resp.Content.CopyToAsync(fs, ct).ConfigureAwait(false);
        }

        File.Move(tmp, path, overwrite: true);
        return path;
    }

    /// <summary>The Roku's serial number from its ECP port (8060), or null if nothing Roku answers there.</summary>
    internal static async Task<string?> ReadSerialAsync(string ip, CancellationToken ct)
    {
        try
        {
            string xml = await Ecp.GetStringAsync($"http://{ip}:{EcpPort}/query/device-info", ct).ConfigureAwait(false);
            var m = Regex.Match(xml, "<serial-number>([^<]+)</serial-number>");
            return m.Success ? m.Groups[1].Value.Trim() : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return null;
        }
    }

    private static HttpClient Installer(string ip, string password, TimeSpan timeout)
    {
        var creds = new CredentialCache { { new Uri($"http://{ip}:{InstallerPort}/"), "Digest", new NetworkCredential("rokudev", password) } };
        return new HttpClient(new HttpClientHandler { Credentials = creds, PreAuthenticate = false }, disposeHandler: true) { Timeout = timeout };
    }

    /// <summary>Null when the password opens the TV's installer page, otherwise what's wrong in plain words.</summary>
    private static async Task<string?> CheckPasswordAsync(string ip, string password, CancellationToken ct)
    {
        try
        {
            using var http = Installer(ip, password, TimeSpan.FromSeconds(8));
            using var resp = await http.GetAsync($"http://{ip}:{InstallerPort}/plugin_install", ct).ConfigureAwait(false);
            if (resp.StatusCode == HttpStatusCode.Unauthorized)
            {
                return "The TV didn't accept that password. It's the one you set when you turned on developer mode (user rokudev).";
            }

            return resp.IsSuccessStatusCode ? null : $"The TV's installer answered {(int)resp.StatusCode}. Is developer mode still on?";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return "The TV's developer installer didn't answer. Turn developer mode on again (Home ×3, Up ×2, Right, Left, Right, Left, Right).";
        }
    }

    /// <summary>Posts the .zip to the TV's installer. Returns "installed" or "identical" (already that exact build).</summary>
    private static async Task<string> UploadAsync(string ip, string password, string zipPath, CancellationToken ct)
    {
        using var http = Installer(ip, password, TimeSpan.FromMinutes(3));

        // Digest auth needs a first request to get the challenge; a GET is cheap and lets the POST go in one try.
        using (var probe = await http.GetAsync($"http://{ip}:{InstallerPort}/plugin_install", ct).ConfigureAwait(false))
        {
            if (probe.StatusCode == HttpStatusCode.Unauthorized)
            {
                throw new InvalidOperationException("the TV no longer accepts the saved password (developer mode turned off and on again?)");
            }
        }

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("Install"), "mysubmit");
        var file = new ByteArrayContent(await File.ReadAllBytesAsync(zipPath, ct).ConfigureAwait(false));
        file.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
        form.Add(file, "archive", Path.GetFileName(zipPath));
        using var resp = await http.PostAsync($"http://{ip}:{InstallerPort}/plugin_install", form, ct).ConfigureAwait(false);
        string body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return InstallOutcome((int)resp.StatusCode, body);
    }

    /// <summary>Reads the installer's reply page.</summary>
    internal static string InstallOutcome(int status, string body)
    {
        if (status == 401)
        {
            throw new InvalidOperationException("the TV didn't accept the saved password");
        }

        if (body.Contains("Identical to previous version", StringComparison.OrdinalIgnoreCase))
        {
            return "identical";
        }

        if (status is >= 200 and < 300 && body.Contains("Install Success", StringComparison.OrdinalIgnoreCase))
        {
            return "installed";
        }

        var m = Regex.Match(body, @"<font color=""red"">([^<]{1,200})</font>", RegexOptions.IgnoreCase);
        string why = m.Success ? m.Groups[1].Value.Trim() : $"the TV's installer answered {status}";
        throw new InvalidOperationException(why);
    }

    private TvRecord Add(string id)
    {
        var tv = new TvRecord { Id = id };
        _tvs.Add(tv);
        return tv;
    }

    private static void SetStatus(TvRecord tv, string status, bool error)
    {
        tv.Status = status;
        tv.StatusIsError = error;
        tv.StatusUtc = DateTime.UtcNow;
    }

    private void Update(string id, Action<TvRecord> change)
    {
        lock (_gate)
        {
            var tv = _tvs.FirstOrDefault(t => t.Id == id);
            if (tv is not null)
            {
                change(tv);
                Save();
            }
        }
    }

    private static string? Clean(string? s, int max)
    {
        if (string.IsNullOrWhiteSpace(s))
        {
            return null;
        }

        s = new string(s.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return s.Length > max ? s[..max] : s;
    }

    private List<TvRecord> Load()
    {
        try
        {
            if (File.Exists(_path))
            {
                return JsonSerializer.Deserialize<List<TvRecord>>(File.ReadAllText(_path)) ?? new();
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ReelForge: could not read {Path}", _path);
        }

        return new();
    }

    private void Save()
    {
        try
        {
            string tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(_tvs, Json));
            File.Move(tmp, _path, overwrite: true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ReelForge: could not save {Path}", _path);
        }
    }
}

/// <summary>
/// Encrypts saved TV passwords. On Windows: DPAPI (machine scope), like NAS passwords. Elsewhere (Docker,
/// HardyOS): AES-GCM with a random key kept in the ReelForge data folder, readable only by the server's user.
/// </summary>
internal static class TvSecret
{
    private const string AesPrefix = "aes:";

    public static string Protect(string plain, string dataDir)
    {
        if (OperatingSystem.IsWindows())
        {
            return Secret.Protect(plain);
        }

        byte[] key = Key(dataDir);
        byte[] nonce = RandomNumberGenerator.GetBytes(12);
        byte[] data = Encoding.UTF8.GetBytes(plain);
        byte[] cipher = new byte[data.Length];
        byte[] tag = new byte[16];
        using (var aes = new AesGcm(key, 16))
        {
            aes.Encrypt(nonce, data, cipher, tag);
        }

        return AesPrefix + Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
    }

    public static string Unprotect(string stored, string dataDir)
    {
        if (!stored.StartsWith(AesPrefix, StringComparison.Ordinal))
        {
            return Secret.Unprotect(stored);
        }

        byte[] all = Convert.FromBase64String(stored[AesPrefix.Length..]);
        byte[] plain = new byte[all.Length - 28];
        using (var aes = new AesGcm(Key(dataDir), 16))
        {
            aes.Decrypt(all.AsSpan(0, 12), all.AsSpan(28), all.AsSpan(12, 16), plain);
        }

        return Encoding.UTF8.GetString(plain);
    }

    private static byte[] Key(string dataDir)
    {
        string path = Path.Combine(dataDir, "tv-secret.key");
        if (File.Exists(path))
        {
            return File.ReadAllBytes(path);
        }

        byte[] key = RandomNumberGenerator.GetBytes(32);
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
        if (!OperatingSystem.IsWindows())
        {
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        }

        try
        {
            using var fs = new FileStream(path, options);
            fs.Write(key);
        }
        catch (IOException) when (File.Exists(path))
        {
            return File.ReadAllBytes(path); // another thread made it first
        }

        return key;
    }
}
