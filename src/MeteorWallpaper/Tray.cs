using System.Drawing;
using System.Windows.Forms;
using Microsoft.Win32;

namespace MeteorWallpaper;

internal sealed class TrayContext : ApplicationContext
{
    private readonly Settings _settings;
    private readonly WallpaperWindow _window;
    private readonly NotifyIcon _tray;
    private readonly HotkeyWindow _hotkey;
    private readonly System.Windows.Forms.Timer _watch;
    private readonly EventWaitHandle _quitEvent = QuitSignal.Create();

    private readonly ToolStripMenuItem _enableItem;
    private readonly ToolStripMenuItem _interactItem;
    private readonly ToolStripMenuItem _autostartItem;
    private readonly ToolStripMenuItem _solarItem;
    private readonly ToolStripMenuItem _earthItem;

    private Rectangle _bounds;
    private bool _paused;
    private bool _locked;
    private int _appliedFps;
    private DateTime _lastAttachAttempt = DateTime.MinValue;
    private int _attachFailures;
    private DateTime _lastErrorTip = DateTime.MinValue;
    private readonly DateTime _startedAt = DateTime.UtcNow;

    public TrayContext()
    {
        _settings = Settings.Load();
        _bounds = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);

        _enableItem = new ToolStripMenuItem("开启壁纸", null, (_, _) => ToggleEnabled()) { Checked = _settings.Enabled };
        _interactItem = new ToolStripMenuItem("交互模式", null, (_, _) => ToggleInteraction());
        _solarItem = new ToolStripMenuItem("太阳系全景", null, (_, _) => SetMode("solar"));
        _earthItem = new ToolStripMenuItem("地球视角", null, (_, _) => SetMode("earth"));
        _autostartItem = new ToolStripMenuItem("开机自动启动", null, (_, _) => ToggleAutostart()) { Checked = Autostart.IsEnabled() };

        var viewMenu = new ToolStripMenuItem("视角");
        viewMenu.DropDownItems.Add(_solarItem);
        viewMenu.DropDownItems.Add(_earthItem);

        var nudgeItem = new ToolStripMenuItem("转动一下（测试画面是否在动）", null, (_, _) => _window.Send("nudge"));

        var menu = new ContextMenuStrip();
        menu.Items.Add(_enableItem);
        menu.Items.Add(_interactItem);
        menu.Items.Add(viewMenu);
        menu.Items.Add(new ToolStripMenuItem("换一个星系", null, (_, _) => NewGalaxy()));
        menu.Items.Add(nudgeItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("设置…", null, (_, _) => OpenSettings()));
        menu.Items.Add(new ToolStripMenuItem("状态…", null, (_, _) => ShowStatus()));
        menu.Items.Add(new ToolStripMenuItem("打开数据目录", null, (_, _) => OpenDataFolder()));
        menu.Items.Add(_autostartItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("退出", null, (_, _) => Quit()));

        _tray = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "流星壁纸",
            Visible = true,
            ContextMenuStrip = menu
        };
        _tray.DoubleClick += (_, _) => ToggleInteraction();

        _hotkey = new HotkeyWindow();
        _hotkey.Pressed += ToggleInteraction;
        if (!_hotkey.TryRegister("Ctrl+Alt+M", HotkeyWindow.MOD_CONTROL | HotkeyWindow.MOD_ALT, HotkeyWindow.VkM))
            if (!_hotkey.TryRegister("Ctrl+Shift+M", HotkeyWindow.MOD_CONTROL | HotkeyWindow.MOD_SHIFT, HotkeyWindow.VkM))
                _hotkey.TryRegister("Alt+Shift+M", HotkeyWindow.MOD_ALT | HotkeyWindow.MOD_SHIFT, HotkeyWindow.VkM);

        _interactItem.Text = _hotkey.ActiveCombination == "禁用"
            ? "交互模式（热键不可用，双击托盘图标）"
            : "交互模式   " + _hotkey.ActiveCombination;
        _tray.Text = "流星壁纸 · " + _hotkey.ActiveCombination + " 交互";

        _window = new WallpaperWindow();
        _window.SceneReady += OnSceneReady;
        _window.ExitInteractionRequested += () => _window.ReturnToDesktop();
        _window.SceneError += OnSceneError;
        _window.Stats += OnStats;
        _watch = new System.Windows.Forms.Timer { Interval = 2000 };
        _watch.Tick += (_, _) => Watch();
        _watch.Start();

        SystemEvents.SessionSwitch += OnSessionSwitch;
        SystemEvents.PowerModeChanged += OnPowerMode;
        SystemEvents.DisplaySettingsChanged += OnDisplayChanged;

        // Start the async boot only once the message loop (and its sync context) is running.
        var boot = new System.Windows.Forms.Timer { Interval = 60 };
        boot.Tick += (_, _) =>
        {
            boot.Stop();
            boot.Dispose();
            _ = BootAsync();
        };
        boot.Start();
    }

    private async Task BootAsync()
    {
        try
        {
            _window.SetBounds(0, 0, 1, 1);
            _window.Show();

            // `MeteorWallpaper.exe --quit` (and a second launch) stops us from outside.
            QuitSignal.Listen(_quitEvent, () =>
            {
                try { _window.BeginInvoke(new Action(Quit)); }
                catch (Exception ex) { Log.E("quit dispatch", ex); }
            });

            var seed = ResolveSeed();
            Log.W($"launch seed={seed} keepSeed={_settings.KeepSeed} mode={_settings.Mode}");
            await _window.InitAsync($"?mode={_settings.Mode}&seed={seed}");

            if (!_window.AttachToDesktop(_bounds))
            {
                _attachFailures++;
                Log.E("attach failed: WorkerW not usable");
                _tray.ShowBalloonTip(7000, "流星壁纸",
                    "没能挂到桌面层（WorkerW 不可用）。\n常见原因：安全软件拦截、或程序被以低权限运行。\n详见 data\\meteor.log",
                    ToolTipIcon.Warning);
            }
            else
            {
                Log.W($"layout bounds={_bounds} dpi={Native.GetDpiForWindow(_window.Handle)}");
            }

            if (!_settings.Welcomed)
            {
                _settings.Welcomed = true;
                _settings.Save();
                _tray.ShowBalloonTip(10000, "流星壁纸已启动",
                    "右键右下角的流星图标：开关壁纸、视角、显示内容、设置。\n" +
                    "按 " + _hotkey.ActiveCombination + " 进入交互（拖拽旋转、滚轮缩放、Esc 返回桌面）。",
                    ToolTipIcon.Info);
            }

            ApplySettings();
        }
        catch (Exception ex)
        {
            Log.E("boot failed", ex);
            _window.Hide();
            try { _window.Send("paused", true); } catch { }
            MessageBox.Show(
                "壁纸启动失败：\n" + ex.Message +
                "\n\n常见原因：\n" +
                "1) 缺少 Microsoft Edge WebView2 运行时（Win11 自带，Win10 装过 Edge 即有）\n" +
                "2) 安全软件拦截了 msedgewebview2.exe\n\n" +
                "详细日志：data\\meteor.log",
                "流星壁纸");
        }
    }

    private void OnSceneReady()
    {
        ApplySettings();
        if (!_settings.Enabled) _window.Hide();
    }

    private int _zeroFpsSamples;
    private DateTime _lastRecovery = DateTime.MinValue;

    private void OnStats(int fps, bool paused)
    {
        if (paused || !_settings.Enabled) { _zeroFpsSamples = 0; return; }

        if (fps >= 1)
        {
            _zeroFpsSamples = 0;
            return;
        }

        _zeroFpsSamples++;
        if (_zeroFpsSamples < 3) return;
        if ((DateTime.UtcNow - _lastRecovery).TotalSeconds < 60) return;

        // Three heartbeats with no frames: Chromium has stopped animating this window.
        _lastRecovery = DateTime.UtcNow;
        _zeroFpsSamples = 0;
        Log.W("no frames for 15s, reloading scene");
        _window.ReloadScene();
    }

    private void OnSceneError(string message)
    {
        if ((DateTime.UtcNow - _lastErrorTip).TotalSeconds < 30) return;
        _lastErrorTip = DateTime.UtcNow;
        try
        {
            _tray.ShowBalloonTip(8000, "流星壁纸 · 场景出错",
                message + "\n\n详情见 data\\meteor.log", ToolTipIcon.Error);
        }
        catch { }
    }

    /// <summary>Every launch rolls a fresh system, unless settings.json pins the seed.</summary>
    private int ResolveSeed()
    {
        if (_settings.KeepSeed && _settings.Seed > 0) return _settings.Seed;
        _settings.Seed = NewSeed();
        _settings.Save();
        return _settings.Seed;
    }

    private static int NewSeed() => Random.Shared.Next(1, int.MaxValue);

    /// <summary>Rolls a new seed and rebuilds in place; the scene keeps its camera rules.</summary>
    private void NewGalaxy()
    {
        // Before the scene reports ready the command would be dropped silently.
        if (!_window.IsReady)
        {
            Log.W("new galaxy ignored: scene not ready yet");
            return;
        }

        _settings.Seed = NewSeed();
        _settings.Save();
        _window.Send("seed", _settings.Seed);
        Log.W($"new galaxy seed={_settings.Seed}");
    }

    private void ApplySettings()
    {
        _window.Send("mode", _settings.Mode);
        _window.Send("dim", _settings.Dim);
        _window.Send("spin", _settings.Spin);
        _appliedFps = _settings.Fps;
        _window.Send("fps", _appliedFps);

        Autostart.Set(_settings.AutoStart);
        _autostartItem.Checked = _settings.AutoStart;
        _solarItem.Checked = _settings.Mode == "solar";
        _earthItem.Checked = _settings.Mode == "earth";
    }

    private void Watch()
    {
        // The shell owns our parent window: when Explorer restarts, Windows destroys the
        // child too. Nothing can be salvaged in-process, so relaunch cleanly.
        if (_window.RawHandle != IntPtr.Zero && !Native.IsWindow(_window.RawHandle))
        {
            // Guard against a relaunch loop when the shell itself is gone.
            if ((DateTime.UtcNow - _startedAt).TotalSeconds > 45)
            {
                Log.W("wallpaper window destroyed (shell restart?), relaunching");
                Relaunch();
            }
            else
            {
                Log.W("wallpaper window destroyed right after start; not relaunching");
            }
            return;
        }

        // Never attach before the scene has actually rendered: a failed WebView2 init
        // would otherwise leave a black rectangle on the desktop.
        if (!_settings.Enabled || _window.IsInteractive || !_window.IsReady) return;

        if (!DesktopHost.IsAttached && _attachFailures < 3)
        {
            if ((DateTime.UtcNow - _lastAttachAttempt).TotalSeconds > 8)
            {
                _lastAttachAttempt = DateTime.UtcNow;
                Log.W("workerW lost, re-attaching");
                if (!_window.AttachToDesktop(_bounds)) _attachFailures++;
                else _attachFailures = 0;
            }
        }

        var fullscreen = IsFullscreenApp();
        var shouldPause = fullscreen || _locked;
        if (shouldPause != _paused)
        {
            _paused = shouldPause;
            Log.W($"pause={_paused} (fullscreen={fullscreen} locked={_locked})");
            if (_paused) _window.Pause(); else _window.Resume();
        }

        var fps = SystemInformation.PowerStatus.PowerLineStatus == PowerLineStatus.Offline
            ? Math.Min(20, _settings.Fps)
            : _settings.Fps;
        if (fps != _appliedFps)
        {
            _appliedFps = fps;
            _window.Send("fps", fps);
        }
    }

    /// <summary>Start a fresh instance (used after the shell destroyed our window).</summary>
    private void Relaunch()
    {
        try
        {
            var exe = Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "MeteorWallpaper.exe");
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(exe)
            {
                UseShellExecute = true,
                WorkingDirectory = AppContext.BaseDirectory
            });
        }
        catch (Exception ex) { Log.E("relaunch failed", ex); }
        Quit();
    }

    /// <summary>
    /// QUNS_BUSY is reported for plenty of non-fullscreen situations (and stays set for
    /// a while), which would freeze the wallpaper. Confirm with window geometry instead.
    /// </summary>
    private bool IsFullscreenApp()
    {
        try
        {
            if (Native.SHQueryUserNotificationState(out var state) != 0) return false;
            if (state is 3 or 7) return true;          // D3D fullscreen / fullscreen app
            if (state is not (2 or 4)) return false;   // busy / presentation: verify below

            var fg = Native.GetForegroundWindow();
            if (fg == IntPtr.Zero || fg == _window.Handle) return false;
            if (!Native.GetWindowRect(fg, out var r)) return false;

            var screen = Screen.FromHandle(fg).Bounds;
            var w = r.Right - r.Left;
            var h = r.Bottom - r.Top;
            return w >= screen.Width - 2 && h >= screen.Height - 2;
        }
        catch { return false; }
    }

    private void ToggleEnabled()
    {
        _settings.Enabled = !_settings.Enabled;
        _settings.Save();
        _enableItem.Checked = _settings.Enabled;

        if (_settings.Enabled)
        {
            _window.Show();
            _window.AttachToDesktop(_bounds);
            _window.Resume();
            _paused = false;
        }
        else
        {
            _window.Send("paused", true);
            _window.Hide();
        }
        Log.W("enabled=" + _settings.Enabled);
    }

    private void ToggleInteraction()
    {
        if (!_settings.Enabled) ToggleEnabled();
        if (_window.IsInteractive) _window.ReturnToDesktop();
        else _window.ShowInteractive(_bounds);
        Log.W("interactive=" + _window.IsInteractive);
    }

    private void SetMode(string mode)
    {
        _settings.Mode = mode;
        _settings.Save();
        _window.Send("mode", mode);
        _solarItem.Checked = mode == "solar";
        _earthItem.Checked = mode == "earth";
    }

    private void ToggleAutostart()
    {
        _settings.AutoStart = !_settings.AutoStart;
        _settings.Save();
        Autostart.Set(_settings.AutoStart);
        _autostartItem.Checked = _settings.AutoStart;
    }

    private void OpenSettings()
    {
        using var dlg = new SettingsForm(_settings);
        if (dlg.ShowDialog() != DialogResult.OK) return;

        _settings.Spin = dlg.Result.Spin;
        _settings.Mode = dlg.Result.Mode;
        _settings.AutoStart = dlg.Result.AutoStart;
        _settings.Save();
        ApplySettings();
    }

    private void ShowStatus()
    {
        var version = typeof(TrayContext).Assembly.GetName().Version?.ToString(3) ?? "?";
        var seed = _window.SceneSeed > 0 ? _window.SceneSeed : _settings.Seed;
        var spin = _settings.Spin switch { < 0.1 => "静止", < 0.7 => "慢", < 1.7 => "正常", _ => "快" };
        var lines = new[]
        {
            $"版本            {version}",
            $"桌面挂载        {(DesktopHost.IsAttached ? "正常" : "未挂载")}",
            $"场景就绪        {(_window.IsReady ? "是" : "否")}",
            $"最近帧率        {(_window.LastStatsUtc == DateTime.MinValue ? "尚无数据" : _window.LastFps + " fps")}",
            $"当前视角        {(_settings.Mode == "earth" ? "地球视角" : "太阳系全景")}",
            $"旋转速度        {spin}",
            "",
            $"星系种子        {seed}",
            $"恒星            {(_window.StarName.Length > 0 ? _window.StarName : "构建中")}",
            $"行星 / 尘埃带   {_window.PlanetCount} / {_window.BeltCount}",
            $"场景构建        {(_window.BuildMs > 0 ? _window.BuildMs + " ms" : "-")}",
            "",
            $"热键            {_hotkey.ActiveCombination}",
            $"WebView2        {SelfTest.WebView2Version() ?? "未找到"}",
            "",
            $"日志            {Path.Combine(WebViewSetup.DataDir, "meteor.log")}"
        };
        MessageBox.Show(string.Join(Environment.NewLine, lines), "流星壁纸 · 状态",
            MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void OpenDataFolder()
    {
        try { System.Diagnostics.Process.Start("explorer.exe", WebViewSetup.DataDir); }
        catch (Exception ex) { Log.E("open data folder", ex); }
    }

    private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        _locked = e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.RemoteDisconnect;
        if (!_settings.Enabled || _window.IsInteractive) return;
        if (_locked) _window.Pause();
        else if (!_paused) _window.Resume();
    }

    private void OnPowerMode(object sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Suspend) _window.Send("paused", true);
    }

    private void OnDisplayChanged(object? sender, EventArgs e)
    {
        _bounds = Screen.PrimaryScreen?.Bounds ?? _bounds;
        _window.AttachToDesktop(_bounds);
    }

    private static Icon LoadIcon()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "app.ico");
            if (File.Exists(path)) return new Icon(path);
        }
        catch { }
        return SystemIcons.Application;
    }

    private void Quit()
    {
        Log.W("quit");
        _watch.Stop();
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        SystemEvents.PowerModeChanged -= OnPowerMode;
        SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
        try { _hotkey.Dispose(); } catch { }
        try { _tray.Visible = false; _tray.Dispose(); } catch { }
        try { _window.Hide(); _window.Dispose(); } catch { }
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _tray.Visible = false;
            _tray.Dispose();
        }
        base.Dispose(disposing);
    }
}
