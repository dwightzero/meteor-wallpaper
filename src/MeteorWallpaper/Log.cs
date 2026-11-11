using System.Diagnostics;
using System.Text;

namespace MeteorWallpaper;

internal static class Log
{
    private static readonly object Gate = new();
    private static string? _path;

    public static void Init(string dir)
    {
        try
        {
            Directory.CreateDirectory(dir);
            _path = Path.Combine(dir, "meteor.log");
            if (File.Exists(_path) && new FileInfo(_path).Length > 512 * 1024)
                File.Move(_path, _path + ".1", true);
        }
        catch { }
    }

    public static void W(string msg)
    {
        try
        {
            var line = $"{DateTime.Now:HH:mm:ss.fff} [{Environment.CurrentManagedThreadId}] {msg}";
            Debug.WriteLine(line);
            if (_path != null) lock (Gate) File.AppendAllText(_path, line + Environment.NewLine, Encoding.UTF8);
        }
        catch { }
    }

    public static void E(string msg, Exception? ex = null) => W("ERROR " + msg + (ex != null ? " :: " + ex : ""));
}
