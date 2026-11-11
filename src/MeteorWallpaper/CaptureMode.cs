using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MeteorWallpaper;

/// <summary>
/// Development helper: renders the scene in a normal window and writes a PNG.
/// Usage: MeteorWallpaper.exe --capture out.png [--mode solar|earth] [--seed 12345]
///                           [--wait 6000] [--w 1600] [--h 900]
/// </summary>
internal sealed class CaptureForm : Form
{
    private readonly WebView2 _wv = new();
    private readonly string _outPath;
    private readonly string _mode;
    private readonly int _seed;
    private readonly int _waitMs;
    private readonly TaskCompletionSource<bool> _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public int ExitCode { get; private set; }

    public CaptureForm(int width, int height, string mode, int seed, int waitMs, string outPath)
    {
        _mode = mode;
        _seed = seed;
        _waitMs = waitMs;
        _outPath = outPath;

        Text = "Meteor Wallpaper Capture";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(0, 0);
        ClientSize = new Size(width, height);
        ShowInTaskbar = false;
        BackColor = Color.Black;

        _wv.Dock = DockStyle.Fill;
        _wv.DefaultBackgroundColor = Color.Black;
        Controls.Add(_wv);

        Shown += async (_, _) => await RunAsync();
    }

    private async Task RunAsync()
    {
        try
        {
            Log.W($"capture seed={_seed}");
            await WebViewSetup.InitAsync(_wv, $"?mode={_mode}&interactive=1&seed={_seed}", OnMessage);

            await Task.WhenAny(_ready.Task, Task.Delay(20000));
            Log.W($"capture ready={_ready.Task.IsCompleted}");
            await Task.Delay(_waitMs);

            Directory.CreateDirectory(Path.GetDirectoryName(_outPath)!);
            await using (var fs = File.Create(_outPath))
                await _wv.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);

            Log.W($"capture written {_outPath} {new FileInfo(_outPath).Length} bytes");
            ExitCode = 0;
        }
        catch (Exception ex)
        {
            Log.E("capture failed", ex);
            ExitCode = 1;
        }
        finally
        {
            Close();
        }
    }

    private void OnMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("type", out var t) && t.GetString() == "ready")
                _ready.TrySetResult(true);
        }
        catch { }
    }
}

internal static class CaptureMode
{
    public static int Run(string[] args)
    {
        var outPath = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : "capture.png";
        var mode = Arg(args, "--mode") ?? "solar";
        var wait = int.TryParse(Arg(args, "--wait"), out var w) ? w : 6000;
        var width = int.TryParse(Arg(args, "--w"), out var cw) ? cw : 1600;
        var height = int.TryParse(Arg(args, "--h"), out var ch) ? ch : 900;
        var seed = int.TryParse(Arg(args, "--seed"), out var sd) && sd > 0 ? sd : Random.Shared.Next(1, int.MaxValue);

        using var form = new CaptureForm(width, height, mode, seed, wait, Path.GetFullPath(outPath));
        Application.Run(form);
        return form.ExitCode;
    }

    private static string? Arg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        return null;
    }
}
