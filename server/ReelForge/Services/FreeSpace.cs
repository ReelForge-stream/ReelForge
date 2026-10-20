using System.Runtime.InteropServices;

namespace ReelForge.Services;

/// <summary>
/// Free space for any folder, including NAS shares (\\nas\media). DriveInfo only understands
/// drive letters and throws on UNC paths, so Windows asks the OS directly.
/// </summary>
internal static partial class FreeSpace
{
    /// <summary>Returns free bytes available to the server, or null when it can't be determined.</summary>
    public static long? Bytes(string directory)
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                string dir = directory.EndsWith('\\') ? directory : directory + '\\';
                return GetDiskFreeSpaceExW(dir, out ulong available, out _, out _) ? (long)available : null;
            }

            return new DriveInfo(directory).AvailableFreeSpace;
        }
        catch (Exception)
        {
            return null; // unknown: don't block the conversion; ffmpeg will fail cleanly if the disk fills
        }
    }

    [LibraryImport("kernel32.dll", EntryPoint = "GetDiskFreeSpaceExW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetDiskFreeSpaceExW(string directoryName, out ulong freeBytesAvailable, out ulong totalBytes, out ulong totalFreeBytes);
}
