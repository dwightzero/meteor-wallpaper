namespace MeteorWallpaper;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Log.Init(Path.Combine(AppContext.BaseDirectory, "data"));

        if (args.Length > 0 && args[0].Equals("--capture", StringComparison.OrdinalIgnoreCase))
        {
            Environment.Exit(CaptureMode.Run(args));
            return;
        }

        if (args.Length > 0 && args[0].Equals("--selftest", StringComparison.OrdinalIgnoreCase))
        {
            var path = args.Length > 1 && !args[1].StartsWith("--")
                ? args[1]
                : Path.Combine(WebViewSetup.DataDir, "selftest.txt");
            Environment.Exit(SelfTest.Run(path));
            return;
        }

        if (args.Length > 0 && args[0].Equals("--attachtest", StringComparison.OrdinalIgnoreCase))
        {
            Environment.Exit(AttachTest.Run(args));
            return;
        }

        // Escape hatch: works even when the tray icon is buried in the overflow.
        if (args.Length > 0 && args[0].Equals("--quit", StringComparison.OrdinalIgnoreCase))
        {
            var result = QuitSignal.Send();
            Environment.Exit(result == 0 ? 0 : 1);
            return;
        }

        using var mutex = new Mutex(true, @"Local\MeteorWallpaper.SingleInstance", out var isFirst);
        if (!isFirst)
        {
            // Second launch doubles as a "stop it" button.
            var answer = MessageBox.Show(
                "流星壁纸已经在运行。\n\n" +
                "点「是」把它关掉（桌面恢复原样；以后想再开，再双击一次这个程序）。\n" +
                "点「否」什么都不做。",
                "流星壁纸", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);

            if (answer == DialogResult.Yes)
            {
                var result = QuitSignal.Send();
                if (result == 2)
                    MessageBox.Show("没找到正在运行的实例（可能是更旧的版本）。\n" +
                                    "请在任务管理器里结束 MeteorWallpaper.exe。",
                        "流星壁纸", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            return;
        }

        try
        {
            Application.Run(new TrayContext());
        }
        catch (Exception ex)
        {
            Log.E("fatal", ex);
            MessageBox.Show(ex.ToString(), "Meteor Wallpaper");
        }
    }
}
