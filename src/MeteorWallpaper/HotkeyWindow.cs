using System.Runtime.InteropServices;

namespace MeteorWallpaper;

/// <summary>Hidden message-only window that receives WM_HOTKEY.</summary>
internal sealed class HotkeyWindow : NativeWindow, IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    public const uint MOD_ALT = 0x0001;
    public const uint MOD_CONTROL = 0x0002;
    public const uint MOD_SHIFT = 0x0004;
    public const uint MOD_NOREPEAT = 0x4000;
    private const int HotkeyId = 0xB001;

    public const uint VkM = 0x4D;

    public string ActiveCombination { get; private set; } = "禁用";

    public event Action? Pressed;

    public HotkeyWindow()
    {
        CreateHandle(new CreateParams { Caption = "MeteorWallpaperHotkey" });
    }

    public bool TryRegister(string name, uint modifiers, uint vk)
    {
        if (Native.RegisterHotKey(Handle, HotkeyId, modifiers | MOD_NOREPEAT, vk))
        {
            ActiveCombination = name;
            Log.W($"hotkey registered: {name}");
            return true;
        }
        Log.W($"hotkey {name} unavailable, err={Marshal.GetLastWin32Error()}");
        return false;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HotkeyId)
        {
            Pressed?.Invoke();
            return;
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        try { Native.UnregisterHotKey(Handle, HotkeyId); } catch { }
        DestroyHandle();
    }
}
