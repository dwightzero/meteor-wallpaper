using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace MeteorWallpaper;

/// <summary>The window that hosts the web scene and can live either on the desktop or in front.</summary>
internal sealed class WallpaperWindow : Form
{
    private readonly WebView2 _wv = new();
    private Rectangle _desktopBounds;

    public bool IsInteractive { get; private set; }
    public bool IsReady { get; private set; }

    public event Action? SceneReady;
    public event Action? ExitInteractionRequested;
    public event Action<string>? SceneError;
    public event Action<int, bool>? Stats;
    public event Action? SpecChanged;

    public DateTime LastStatsUtc { get; private set; } = DateTime.MinValue;
    public int LastFps { get; private set; }

    // Filled from the scene's "spec" message: what the current seed produced.
    public int SceneSeed { get; private set; }
    public int PlanetCount { get; private set; }
    public int BeltCount { get; private set; }
    public string StarName { get; private set; } = "";
    public int BuildMs { get; private set; }

    /// <summary>HWND captured at creation; unlike Form.Handle it is never recreated.</summary>
    public IntPtr RawHandle { get; private set; }

    public WallpaperWindow()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;
        AutoScaleMode = AutoScaleMode.None;
        DoubleBuffered = true;
        Text = "Meteor Wallpaper";

        _wv.Dock = DockStyle.Fill;
        _wv.DefaultBackgroundColor = Color.Black;
        _wv.AllowExternalDrop = false;
        Controls.Add(_wv);
    }

    public async Task InitAsync(string query)
    {
        await WebViewSetup.InitAsync(_wv, query, OnWebMessage);

        _wv.CoreWebView2.ProcessFailed += (_, e) =>
        {
            Log.E($"webview2 process failed: {e.ProcessFailedKind}");
            IsReady = false;
            // A dead renderer usually recovers with a reload; the host timer keeps the
            // window off the desktop until the scene reports ready again.
            try { _wv.CoreWebView2.Reload(); } catch { }
        };
        _wv.CoreWebView2.NavigationCompleted += (_, e) =>
            Log.W($"navigation completed ok={e.IsSuccess} status={e.WebErrorStatus}");
    }

    private void OnWebMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            switch (type)
            {
                case "ready":
                    IsReady = true;
                    Log.W("scene ready");
                    SceneReady?.Invoke();
                    break;
                case "exitInteract":
                    ExitInteractionRequested?.Invoke();
                    break;
                case "log":
                    Log.W("js: " + (root.TryGetProperty("msg", out var m) ? m.GetString() : json));
                    break;
                case "error":
                    var msg = root.TryGetProperty("msg", out var em) ? em.GetString() ?? json : json;
                    Log.E("scene error: " + msg);
                    SceneError?.Invoke(msg ?? "unknown");
                    break;
                case "stats":
                {
                    var fps = 0.0;
                    var paused = false;
                    if (root.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.Object)
                    {
                        if (v.TryGetProperty("fps", out var f) && f.ValueKind == JsonValueKind.Number) fps = f.GetDouble();
                        if (v.TryGetProperty("paused", out var p) &&
                            (p.ValueKind == JsonValueKind.True || p.ValueKind == JsonValueKind.False)) paused = p.GetBoolean();
                    }
                    LastStatsUtc = DateTime.UtcNow;
                    LastFps = (int)Math.Round(fps);
                    Log.W($"scene fps={LastFps} paused={paused}");
                    Stats?.Invoke(LastFps, paused);
                    break;
                }
                case "spec":
                {
                    if (!root.TryGetProperty("value", out var v) || v.ValueKind != JsonValueKind.Object) break;
                    SceneSeed = Int(v, "seed");
                    PlanetCount = Int(v, "planets");
                    BeltCount = Int(v, "belts");
                    BuildMs = Int(v, "buildMs");
                    StarName = v.TryGetProperty("star", out var sn) ? sn.GetString() ?? "" : "";
                    Log.W($"scene spec seed={SceneSeed} star={StarName} planets={PlanetCount} belts={BeltCount} build={BuildMs}ms");
                    SpecChanged?.Invoke();
                    break;
                }
            }
        }
        catch (Exception ex) { Log.E("bad web message: " + json, ex); }
    }

    private static int Int(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number
            ? (int)Math.Round(p.GetDouble())
            : 0;

    public void Send(string cmd, object? value = null)
    {
        try
        {
            var core = _wv.CoreWebView2;
            if (core == null) return;
            var payload = value == null
                ? JsonSerializer.Serialize(new { cmd })
                : JsonSerializer.Serialize(new { cmd, value });
            core.PostWebMessageAsJson(payload);
        }
        catch (Exception ex) { Log.E("send failed: " + cmd, ex); }
    }

    public bool AttachToDesktop(Rectangle bounds)
    {
        _desktopBounds = bounds;
        IsInteractive = false;
        SetBounds(bounds.X, bounds.Y, bounds.Width, bounds.Height);
        if (!IsHandleCreated) return false;
        return DesktopHost.Attach(Handle, bounds);
    }

    public void ShowInteractive(Rectangle bounds)
    {
        IsInteractive = true;
        if (IsHandleCreated) DesktopHost.Detach(Handle);
        SetBounds(bounds.X, bounds.Y, bounds.Width, bounds.Height);
        Show();
        Native.SetWindowPos(Handle, Native.HWND_TOPMOST, bounds.X, bounds.Y, bounds.Width, bounds.Height,
            Native.SWP_SHOWWINDOW);
        Activate();
        Native.SetForegroundWindow(Handle);
        // Keyboard (Esc) goes to the web view only if the browser control actually has focus.
        try { _wv.Focus(); } catch { }
        Send("interactive", true);
    }

    public void ReturnToDesktop()
    {
        IsInteractive = false;
        Send("interactive", false);
        if (IsHandleCreated) DesktopHost.Attach(Handle, _desktopBounds);
    }

    public void Pause()
    {
        if (IsInteractive) return;
        Send("paused", true);
    }

    public void Resume()
    {
        Send("paused", false);
    }

    /// <summary>Last-resort recovery when the renderer stops producing frames.</summary>
    public void ReloadScene()
    {
        try
        {
            Log.W("reloading scene");
            IsReady = false;
            _wv.CoreWebView2?.Reload();
        }
        catch (Exception ex) { Log.E("reload failed", ex); }
    }

    protected override bool ShowWithoutActivation => true;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        RawHandle = Handle;
        Log.W($"wallpaper hwnd={Handle}");
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        try { _wv.Dispose(); } catch { }
        base.OnFormClosing(e);
    }
}
