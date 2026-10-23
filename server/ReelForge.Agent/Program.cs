using System.Net.Http.Json;
using Microsoft.Extensions.Hosting.WindowsServices;
using ReelForge.Agent;
using ReelForge.Core;

// ReelForge.Agent.exe pair --server http://192.168.1.10:8096 --key ABCD-EFGH-JKLM
// ReelForge.Agent.exe run            (what the Windows service runs)
// ReelForge.Agent.exe probe          (shows which encoders work on this PC)

string Arg(string name) => args.SkipWhile(a => a != name).Skip(1).FirstOrDefault() ?? string.Empty;
string command = args.FirstOrDefault() ?? (WindowsServiceHelpers.IsWindowsService() ? "run" : "help");
string ffmpeg = Arg("--ffmpeg") is { Length: > 0 } f ? f : FindFfmpeg();
bool allowCpu = args.Contains("--cpu");

switch (command)
{
    case "pair":
    {
        string server = Arg("--server").TrimEnd('/');
        string key = Arg("--key");
        string name = Arg("--name") is { Length: > 0 } n ? n : Environment.MachineName;
        if (server.Length == 0 || key.Length == 0)
        {
            Console.Error.WriteLine("Usage: ReelForge.Agent pair --server http://SERVER:8096 --key XXXX-XXXX-XXXX [--name NAME]");
            return 2;
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        try
        {
            using var resp = await http.PostAsJsonAsync($"{server}/ReelForge/AgentApi/Register", new AgentRegisterRequest(key, name, Environment.OSVersion.VersionString, Worker.Version));
            if (!resp.IsSuccessStatusCode)
            {
                Console.Error.WriteLine($"Pairing failed ({(int)resp.StatusCode}): {await resp.Content.ReadAsStringAsync()}");
                return 1;
            }

            var r = (await resp.Content.ReadFromJsonAsync<AgentRegisterResponse>())!;
            var cfg = new AgentConfig { Server = server, AgentId = r.AgentId, Name = name };
            cfg.Secret = r.Secret;
            cfg.Save();
            Console.WriteLine($"Paired {name} with {server} (server version {r.ServerVersion}).");
            return 0;
        }
        catch (HttpRequestException ex)
        {
            Console.Error.WriteLine($"Can't reach {server}: {ex.Message}");
            return 1;
        }
    }

    case "probe":
    {
        var caps = await Probe.RunAsync(ffmpeg, allowCpu, CancellationToken.None);
        Console.WriteLine($"ffmpeg:   {ffmpeg}");
        Console.WriteLine($"Graphics: {string.Join(", ", caps.Gpus)}");
        Console.WriteLine($"Encoders: {string.Join(", ", caps.Encoders)}");
        Console.WriteLine($"10-bit:   {string.Join(", ", caps.TenBitHevc)}");
        return caps.Encoders.Count > 0 ? 0 : 1;
    }

    case "run":
    {
        var cfg = AgentConfig.Load();
        if (cfg is null)
        {
            Console.Error.WriteLine("Not paired yet. Run: ReelForge.Agent pair --server ... --key ...");
            return 1;
        }

        var builder = Host.CreateApplicationBuilder(args);
        builder.Services.AddWindowsService(o => o.ServiceName = "ReelForgeAgent");
        builder.Logging.AddProvider(new FileLoggerProvider());
        builder.Services.AddSingleton(cfg);
        builder.Services.AddSingleton(new AgentOptions(ffmpeg, allowCpu));
        builder.Services.AddHostedService<Worker>();
        await builder.Build().RunAsync();
        return 0;
    }

    default:
        Console.WriteLine("ReelForge Agent " + Worker.Version);
        Console.WriteLine("  pair --server URL --key KEY [--name NAME]   pair this PC with a ReelForge server");
        Console.WriteLine("  run [--cpu]                                 convert files for the server (the service runs this)");
        Console.WriteLine("  probe [--cpu]                               show which encoders work here");
        return command == "help" ? 0 : 2;
}

// ffmpeg next to the agent (put there by the install script), else on PATH.
static string FindFfmpeg()
{
    string dir = AppContext.BaseDirectory;
    foreach (var p in new[] { Path.Combine(dir, "ffmpeg", "ffmpeg.exe"), Path.Combine(dir, "ffmpeg", "ffmpeg"), Path.Combine(dir, "ffmpeg.exe") })
    {
        if (File.Exists(p))
        {
            return p;
        }
    }

    return OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg";
}
