using System.Drawing;
using System.Windows.Forms;

namespace MeteorWallpaper;

/// <summary>
/// Kept deliberately short: the wallpaper no longer exposes an exposure/fps/layer
/// panel. A system is generated per launch, so the only real choices are the
/// camera mode, how fast it turns, and whether it starts with Windows.
/// </summary>
internal sealed class SettingsForm : Form
{
    private readonly ComboBox _spin = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 110 };
    private readonly CheckBox _autoStart = new() { Text = "开机自动启动（仅当前用户）", AutoSize = true };
    private readonly RadioButton _solar = new() { Text = "太阳系全景（宏大）", AutoSize = true };
    private readonly RadioButton _earth = new() { Text = "地球视角（流星从天而降）", AutoSize = true };

    private static readonly double[] SpinValues = { 0, 0.4, 1.0, 2.5 };
    private static readonly string[] SpinLabels = { "静止", "慢", "正常", "快" };

    public Settings Result { get; }

    public SettingsForm(Settings current)
    {
        Result = new Settings
        {
            Enabled = current.Enabled,
            Mode = current.Mode,
            Dim = current.Dim,
            Fps = current.Fps,
            AutoStart = current.AutoStart,
            Seed = current.Seed,
            KeepSeed = current.KeepSeed,
            Welcomed = current.Welcomed,
            Spin = current.Spin == 0 ? 0 : current.Spin < 0.7 ? 0.4 : current.Spin < 1.7 ? 1.0 : 2.5
        };

        Text = "流星壁纸 · 设置";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        TopMost = true;
        ClientSize = new Size(420, 336);
        Font = new Font("Microsoft YaHei UI", 9f);

        var title = new Label
        {
            Text = "流星壁纸",
            Font = new Font("Microsoft YaHei UI", 12f, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(18, 12)
        };

        var subtitle = new Label
        {
            Text = "每次启动随机生成一个属于你的星系。",
            AutoSize = true,
            ForeColor = Color.DimGray,
            Location = new Point(20, 42)
        };

        var modeLabel = new Label { Text = "默认视角", AutoSize = true, Location = new Point(20, 78) };
        _solar.Location = new Point(110, 76);
        _earth.Location = new Point(110, 100);
        if (current.Mode == "earth") _earth.Checked = true; else _solar.Checked = true;

        AddRow("旋转速度", _spin, 132, out _);
        _spin.Items.AddRange(SpinLabels);
        _spin.SelectedIndex = Array.IndexOf(SpinValues, Result.Spin) is var i && i >= 0 ? i : 2;

        _autoStart.Location = new Point(20, 172);
        _autoStart.Checked = current.AutoStart || Autostart.IsEnabled();

        var seedInfo = new Label
        {
            Text = current.Seed > 0 ? $"当前星系：种子 {current.Seed}" : "当前星系：启动后生成",
            AutoSize = true,
            ForeColor = Color.DimGray,
            Location = new Point(20, 208)
        };

        var hint = new Label
        {
            Text = "托盘 →「换一个星系」立即换一套。\r\n" +
                   "想固定这一套：把 settings.json 里的 keepSeed 改成 true 再启动。\r\n" +
                   "Ctrl+Alt+M 进入交互，拖动旋转、滚轮缩放、Esc 返回桌面。",
            AutoSize = false,
            Size = new Size(380, 56),
            Location = new Point(20, 232),
            ForeColor = Color.DimGray
        };

        var ok = new Button { Text = "确定", DialogResult = DialogResult.OK, Location = new Point(230, 294), Size = new Size(80, 28) };
        var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, Location = new Point(320, 294), Size = new Size(80, 28) };

        Controls.AddRange(new Control[]
        {
            title, subtitle, modeLabel, _solar, _earth, _autoStart, seedInfo, hint, ok, cancel
        });

        AcceptButton = ok;
        CancelButton = cancel;

        ok.Click += (_, _) =>
        {
            Result.Spin = SpinValues[Math.Max(0, _spin.SelectedIndex)];
            Result.AutoStart = _autoStart.Checked;
            Result.Mode = _earth.Checked ? "earth" : "solar";
        };
    }

    private void AddRow(string label, Control control, int y, out Label hint)
    {
        var l = new Label { Text = label, AutoSize = true, Location = new Point(20, y + 4) };
        control.Location = new Point(110, y);
        hint = new Label { Text = string.Empty, AutoSize = true, Location = new Point(control.Right + 10, y + 4) };
        Controls.Add(l);
        Controls.Add(control);
        Controls.Add(hint);
    }
}
