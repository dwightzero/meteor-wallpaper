using System.Drawing;

namespace MeteorWallpaper;

/// <summary>
/// Owns the WorkerW dance: the wallpaper window lives as a child of the shell's WorkerW,
/// which sits above the desktop background and below the desktop icons.
///
/// WM_SPAWN_WORKER (0x052C) must be sent sparingly - every send makes Explorer create
/// another WorkerW window, which is how you end up re-parenting in a loop.
/// </summary>
internal static class DesktopHost
{
    private static int _spawnSends;
    private static IntPtr _workerW = IntPtr.Zero;

    public static IntPtr WorkerW => _workerW;

    public static bool IsAttached => _workerW != IntPtr.Zero && Native.IsWindow(_workerW);

    public static IntPtr FindWorkerW()
    {
        var progman = Native.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return IntPtr.Zero;

        var worker = EnumWorker(progman);
        if (worker != IntPtr.Zero)
        {
            _workerW = worker;
            return worker;
        }

        // No WorkerW yet: ask the shell once (at most twice per process).
        if (_spawnSends < 2)
        {
            _spawnSends++;
            Native.SendMessageTimeout(progman, Native.WM_SPAWN_WORKER, new IntPtr(0xD), IntPtr.Zero,
                0x0002 /* SMTO_ABORTIFHUNG */, 1500, out _);
            Thread.Sleep(150);
            worker = EnumWorker(progman);
        }

        if (worker == IntPtr.Zero)
        {
            Log.W("no WorkerW found, falling back to Progman");
            worker = progman;
        }

        _workerW = worker;
        return worker;
    }

    private static IntPtr EnumWorker(IntPtr progman)
    {
        var found = IntPtr.Zero;
        Native.EnumWindows((top, _) =>
        {
            var view = Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (view != IntPtr.Zero)
            {
                var w = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
                if (w != IntPtr.Zero) found = w;
            }
            return true;
        }, IntPtr.Zero);

        if (found == IntPtr.Zero)
            found = Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);

        return found;
    }

    public static bool Attach(IntPtr hwnd, Rectangle bounds)
    {
        var worker = FindWorkerW();
        if (worker == IntPtr.Zero) return false;

        var alreadyChild = Native.GetParent(hwnd) == worker;
        if (!alreadyChild)
        {
            Native.SetParent(hwnd, worker);
            var err = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
            Log.W($"setparent hwnd={hwnd} -> worker={worker} now={Native.GetParent(hwnd)} err={err}");

            var style = Native.GetWindowLong(hwnd, Native.GWL_STYLE);
            style &= ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME |
                       Native.WS_SYSMENU | Native.WS_MINIMIZEBOX | Native.WS_MAXIMIZEBOX);
            style |= Native.WS_CHILD | Native.WS_VISIBLE;
            Native.SetWindowLong(hwnd, Native.GWL_STYLE, style);

            var ex = Native.GetWindowLong(hwnd, Native.GWL_EXSTYLE);
            ex |= Native.WS_EX_TOOLWINDOW;
            ex &= ~Native.WS_EX_NOACTIVATE;
            ex &= ~0x00000008; // WS_EX_TOPMOST
            Native.SetWindowLong(hwnd, Native.GWL_EXSTYLE, ex);
        }

        var local = ToWorkerSpace(worker, bounds);
        Native.SetWindowPos(hwnd, IntPtr.Zero, local.X, local.Y, local.Width, local.Height,
            Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);

        Log.W($"attached workerW={worker} child={alreadyChild} rect={local}");
        return true;
    }

    public static void Detach(IntPtr hwnd)
    {
        Native.SetParent(hwnd, IntPtr.Zero);
        _workerW = IntPtr.Zero;

        var style = Native.GetWindowLong(hwnd, Native.GWL_STYLE);
        style &= ~Native.WS_CHILD;
        style |= Native.WS_POPUP | Native.WS_VISIBLE;
        Native.SetWindowLong(hwnd, Native.GWL_STYLE, style);
    }

    public static void Resize(IntPtr hwnd, Rectangle bounds)
    {
        var worker = IsAttached ? _workerW : IntPtr.Zero;
        var local = worker != IntPtr.Zero ? ToWorkerSpace(worker, bounds) : bounds;
        Native.SetWindowPos(hwnd, IntPtr.Zero, local.X, local.Y, local.Width, local.Height,
            Native.SWP_NOZORDER | Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
    }

    private static Rectangle ToWorkerSpace(IntPtr worker, Rectangle bounds)
    {
        if (!Native.GetWindowRect(worker, out var wr)) return bounds;
        return new Rectangle(bounds.X - wr.Left, bounds.Y - wr.Top, bounds.Width, bounds.Height);
    }
}
