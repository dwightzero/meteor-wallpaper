using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace MeteorWallpaper;

/// <summary>
/// Console-only environment probe. Runs without creating any window, so it also works
/// when something is wrong with the GUI side of the app.
/// Usage: MeteorWallpaper.exe --selftest [outfile]
/// </summary>
internal static class SelfTest
{
    private const string WebView2ClientGuid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    [DllImport("kernel32.dll")]
    private static extern uint ProcessIdToSessionId(uint processId, out uint sessionId);

    public static int Run(string outPath)
    {
        var sb = new StringBuilder();
        void Line(string s) => sb.AppendLine(s);

        try
        {
            Line($"time           : {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            Line($"os             : {Environment.OSVersion}  64bit={Environment.Is64BitProcess}");
            Line($"dotnet         : {Environment.Version}");
            Line($"exe            : {Environment.ProcessPath}");
            Line($"base dir       : {AppContext.BaseDirectory}");
            Line($"cwd            : {Environment.CurrentDirectory}");
            Line($"user           : {Environment.UserName}@{Environment.MachineName}");
            Line($"session        : {SessionId()}");
            Line($"webview2       : {WebView2Version() ?? "NOT FOUND"}");
            Line($"progman        : {Native.FindWindow("Progman", null)}");
            Line($"workerW        : {DesktopHost.FindWorkerW()}");
            Line($"screens        : {Screens()}");
            Line($"config dir     : {WebViewSetup.DataDir}");
            Line($"assets dir     : {WebViewSetup.AssetsDir} exists={Directory.Exists(WebViewSetup.AssetsDir)}");
            Line($"three.js       : {Path.Combine(WebViewSetup.AssetsDir, "three.module.js")} " +
                 $"exists={File.Exists(Path.Combine(WebViewSetup.AssetsDir, "three.module.js"))}");
            Line($"galaxy.js      : {Path.Combine(WebViewSetup.AssetsDir, "galaxy.js")} " +
                 $"exists={File.Exists(Path.Combine(WebViewSetup.AssetsDir, "galaxy.js"))}");
            var settings = Settings.Load();
            Line($"settings       : {Settings.FilePath} exists={File.Exists(Settings.FilePath)} " +
                 $"seed={settings.Seed} keepSeed={settings.KeepSeed}");
            Line($"autostart      : {Autostart.IsEnabled()}");
        }
        catch (Exception ex)
        {
            Line("selftest failed: " + ex);
        }

        var text = sb.ToString();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            File.WriteAllText(outPath, text, Encoding.UTF8);
        }
        catch { }
        try { Console.Out.Write(text); } catch { }
        return 0;
    }

    private static string SessionId()
    {
        try
        {
            if (ProcessIdToSessionId((uint)Environment.ProcessId, out var sid) == 0)
                return sid.ToString();
        }
        catch { }
        return "?";
    }

    public static string? WebView2Version()
    {
        foreach (var (hive, path) in new (RegistryKey, string)[]
                 {
                     (Registry.LocalMachine, $@"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WebView2ClientGuid}"),
                     (Registry.LocalMachine, $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WebView2ClientGuid}"),
                     (Registry.CurrentUser, $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WebView2ClientGuid}")
                 })
        {
            try
            {
                using var key = hive.OpenSubKey(path);
                if (key?.GetValue("pv") is string pv && pv.Length > 0) return pv;
            }
            catch { }
        }

        // fall back to the on-disk runtime folder
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft", "EdgeWebView", "Application");
            if (Directory.Exists(dir))
            {
                var versions = Directory.GetDirectories(dir)
                    .Select(Path.GetFileName)
                    .Where(v => v != null && v[0] >= '0' && v[0] <= '9')
                    .OrderByDescending(v => v, StringComparer.OrdinalIgnoreCase)
                    .ToList();
                if (versions.Count > 0) return versions[0] + " (disk)";
            }
        }
        catch { }
        return null;
    }

    private static string Screens()
    {
        try
        {
            return string.Join("; ", Screen.AllScreens.Select(s =>
                $"{s.DeviceName} {s.Bounds.Width}x{s.Bounds.Height}@{s.Bounds.X},{s.Bounds.Y} primary={s.Primary}"));
        }
        catch (Exception ex) { return "n/a (" + ex.GetType().Name + ")"; }
    }
}
