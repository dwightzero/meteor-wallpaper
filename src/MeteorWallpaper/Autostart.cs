using Microsoft.Win32;

namespace MeteorWallpaper;

/// <summary>Per-user autostart. Nothing outside HKCU is touched, so the app stays portable.</summary>
internal static class Autostart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "MeteorWallpaper";

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) is string s && s.Length > 0;
        }
        catch { return false; }
    }

    public static void Set(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey, true);
            if (key == null) return;
            if (enabled)
            {
                var exe = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "MeteorWallpaper.exe");
                key.SetValue(ValueName, $"\"{exe}\" --tray");
                Log.W("autostart enabled");
            }
            else
            {
                key.DeleteValue(ValueName, false);
                Log.W("autostart disabled");
            }
        }
        catch (Exception ex) { Log.E("autostart", ex); }
    }
}
