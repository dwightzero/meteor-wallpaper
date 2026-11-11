using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MeteorWallpaper;

/// <summary>Shared WebView2 bootstrapping: flags, virtual host, settings.</summary>
internal static class WebViewSetup
{
    public const string Host = "app.local";

    /// <summary>
    /// Chromium pauses rAF for windows it believes are occluded. A wallpaper parented
    /// into WorkerW looks occluded to Chromium, so every one of these flags matters.
    /// </summary>
    public const string BrowserArgs =
        "--disable-backgrounding-occluded-windows " +
        "--disable-renderer-backgrounding " +
        "--disable-background-timer-throttling " +
        "--disable-features=CalculateNativeWinOcclusion " +
        "--force-color-profile=srgb " +
        "--autoplay-policy=no-user-gesture-required";

    public static string AssetsDir => Path.Combine(AppContext.BaseDirectory, "wwwroot");

    public static string DataDir
    {
        get
        {
            var preferred = Path.Combine(AppContext.BaseDirectory, "data");
            try
            {
                Directory.CreateDirectory(preferred);
                var probe = Path.Combine(preferred, ".probe");
                File.WriteAllText(probe, "1");
                File.Delete(probe);
                return preferred;
            }
            catch
            {
                var fallback = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MeteorWallpaper");
                Directory.CreateDirectory(fallback);
                return fallback;
            }
        }
    }

    public static async Task InitAsync(WebView2 wv, string? query, Action<string> onMessage, bool devTools = false)
    {
        var options = new CoreWebView2EnvironmentOptions(BrowserArgs);
        var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "wv2"), options);
        await wv.EnsureCoreWebView2Async(env);

        var core = wv.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = devTools;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsPinchZoomEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        core.WebMessageReceived += (_, e) => onMessage(e.WebMessageAsJson);
        core.SetVirtualHostNameToFolderMapping(Host, AssetsDir, CoreWebView2HostResourceAccessKind.Allow);
        core.Navigate($"https://{Host}/index.html{query}");
    }
}
