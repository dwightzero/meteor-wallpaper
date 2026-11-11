using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace MeteorWallpaper;

/// <summary>
/// Throwaway harness: proves that a plain window can be parented into WorkerW on this
/// machine, i.e. that the desktop-layer trick works, without involving WebView2.
/// Usage: MeteorWallpaper.exe --attachtest [seconds]
/// </summary>
internal sealed class AttachTestForm : Form
{
    private readonly int _seconds;
    private readonly string _mode;

    public AttachTestForm(int seconds, string mode)
    {
        _seconds = seconds;
        _mode = mode;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        BackColor = Color.Black;
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        var bounds = Screen.PrimaryScreen!.Bounds;
        SetBounds(bounds.X, bounds.Y, bounds.Width, bounds.Height);

        var ok = DesktopHost.Attach(Handle, bounds);
        Log.W($"attachtest attached={ok} workerW={DesktopHost.WorkerW} dpi={Native.GetDpiForWindow(Handle)}");

        if (_mode != "cycle")
        {
            var single = new System.Windows.Forms.Timer { Interval = Math.Max(1, _seconds) * 1000 };
            single.Tick += (_, _) => { single.Stop(); Log.W("attachtest done"); Close(); };
            single.Start();
            return;
        }

        // attach -> detach to front -> re-attach: the same path Ctrl+Alt+M uses
        var step = 0;
        var timer = new System.Windows.Forms.Timer { Interval = 3000 };
        timer.Tick += (_, _) =>
        {
            step++;
            switch (step)
            {
                case 1:
                    DesktopHost.Detach(Handle);
                    Native.SetWindowPos(Handle, Native.HWND_TOPMOST, bounds.X, bounds.Y, bounds.Width, bounds.Height,
                        Native.SWP_SHOWWINDOW);
                    Log.W($"attachtest detached parent={Native.GetParent(Handle)}");
                    break;
                case 2:
                    var back = DesktopHost.Attach(Handle, bounds);
                    Log.W($"attachtest reattached={back} parent={Native.GetParent(Handle)}");
                    break;
                default:
                    timer.Stop();
                    Log.W("attachtest cycle done");
                    Close();
                    break;
            }
        };
        timer.Start();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        var r = ClientRectangle;

        using (var brush = new LinearGradientBrush(r, Color.FromArgb(6, 10, 24), Color.FromArgb(30, 16, 10), 35f))
            g.FillRectangle(brush, r);

        var imagePath = Path.Combine(AppContext.BaseDirectory, "preview.png");
        if (File.Exists(imagePath))
        {
            try
            {
                using var img = Image.FromFile(imagePath);
                var scale = Math.Max((float)r.Width / img.Width, (float)r.Height / img.Height);
                var w = img.Width * scale;
                var h = img.Height * scale;
                g.DrawImage(img, (r.Width - w) / 2, (r.Height - h) / 2, w, h);
            }
            catch { }
        }

        using var font = new Font("Microsoft YaHei UI", 30f, FontStyle.Bold);
        using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString($"WorkerW 挂载测试 · {_mode}\n{_seconds} 秒后自动消失", font,
            Brushes.White, r, sf);
    }
}

internal static class AttachTest
{
    public static int Run(string[] args)
    {
        var seconds = args.Length > 1 && int.TryParse(args[1], out var s) ? s : 8;
        var mode = args.Length > 2 ? args[2] : "solar";
        Application.Run(new AttachTestForm(seconds, mode));
        return 0;
    }
}
