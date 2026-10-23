using System.Diagnostics;

namespace ReelForge.Agent;

/// <summary>Cancels a transfer when no bytes have moved for a while (a hung connection never errors on its own).</summary>
internal sealed class StallGuard : IDisposable
{
    private readonly CancellationTokenSource _cts;
    private readonly TimeSpan _limit;
    private long _lastMove = Environment.TickCount64;
    private readonly Timer _timer;

    public StallGuard(TimeSpan limit, CancellationToken outer)
    {
        _limit = limit;
        _cts = CancellationTokenSource.CreateLinkedTokenSource(outer);
        var every = TimeSpan.FromMilliseconds(Math.Clamp(limit.TotalMilliseconds / 4, 50, 5000));
        _timer = new Timer(_ =>
        {
            if (Environment.TickCount64 - Interlocked.Read(ref _lastMove) > _limit.TotalMilliseconds)
            {
                try
                {
                    _cts.Cancel();
                }
                catch (ObjectDisposedException)
                {
                }
            }
        }, null, every, every);
    }

    public CancellationToken Token => _cts.Token;

    public void Moved() => Interlocked.Exchange(ref _lastMove, Environment.TickCount64);

    public void Dispose()
    {
        _timer.Dispose();
        _cts.Dispose();
    }
}

/// <summary>Transfer rate over the last several seconds, so the number on screen follows the network.</summary>
internal sealed class RateMeter
{
    private readonly Queue<(long Ms, long Bytes)> _samples = new();
    private readonly Stopwatch _sw = Stopwatch.StartNew();

    public RateMeter(long start) => _samples.Enqueue((0, start));

    public double? Update(long bytes)
    {
        long now = _sw.ElapsedMilliseconds;
        if (_samples.Count == 0 || now - _samples.Last().Ms >= 250)
        {
            _samples.Enqueue((now, bytes));
        }

        while (_samples.Count > 2 && now - _samples.Peek().Ms > 10_000)
        {
            _samples.Dequeue();
        }

        var (ms, b) = _samples.Peek();
        return now - ms < 500 ? null : (bytes - b) * 1000.0 / (now - ms);
    }
}

/// <summary>A read-only stream that reports how many bytes have been read through it.</summary>
internal sealed class ProgressStream(Stream inner, Action<long> onProgress) : Stream
{
    private long _done;

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => inner.Length;

    public override long Position { get => _done; set => throw new NotSupportedException(); }

    public override int Read(byte[] buffer, int offset, int count) => Count(inner.Read(buffer, offset, count));

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
        Count(await inner.ReadAsync(buffer, cancellationToken));

    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override ValueTask DisposeAsync() => inner.DisposeAsync();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            inner.Dispose();
        }

        base.Dispose(disposing);
    }

    private int Count(int n)
    {
        if (n > 0)
        {
            _done += n;
            onProgress(_done);
        }

        return n;
    }
}
