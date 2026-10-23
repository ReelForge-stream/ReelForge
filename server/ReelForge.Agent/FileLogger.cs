namespace ReelForge.Agent;

/// <summary>Plain text log in the agent's data folder (agent.log, rolled over at 5 MB).</summary>
public sealed class FileLoggerProvider : ILoggerProvider
{
    private readonly object _gate = new();
    private readonly string _path = Path.Combine(AgentConfig.DataDir, "agent.log");

    public ILogger CreateLogger(string categoryName) => new FileLogger(this);

    public void Dispose()
    {
    }

    internal void Write(LogLevel level, string message)
    {
        lock (_gate)
        {
            try
            {
                Directory.CreateDirectory(AgentConfig.DataDir);
                if (File.Exists(_path) && new FileInfo(_path).Length > 5_000_000)
                {
                    File.Move(_path, _path + ".old", true);
                }

                File.AppendAllText(_path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {level,-11} {message}{Environment.NewLine}");
            }
            catch (Exception)
            {
            }
        }
    }

    private sealed class FileLogger(FileLoggerProvider owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (IsEnabled(logLevel))
            {
                owner.Write(logLevel, formatter(state, exception) + (exception is null ? string.Empty : " " + exception.Message));
            }
        }
    }
}
