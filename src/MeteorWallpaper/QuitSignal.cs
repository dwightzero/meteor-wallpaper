using System.Threading;

namespace MeteorWallpaper;

/// <summary>
/// Cross-process "please exit" switch.
///
/// The tray icon can be folded into the Windows 11 overflow, and after an Explorer
/// restart it may take a while to come back. The wallpaper must never become
/// impossible to stop, so `MeteorWallpaper.exe --quit` signals the running instance
/// through this named event and the tray exits cleanly.
/// </summary>
internal static class QuitSignal
{
    private const string EventName = @"Local\MeteorWallpaper.Quit";

    public static EventWaitHandle Create() => new(false, EventResetMode.ManualReset, EventName);

    /// <summary>Blocks a background thread until someone asks us to quit.</summary>
    public static void Listen(EventWaitHandle handle, Action onQuit)
    {
        var thread = new Thread(() =>
        {
            try
            {
                handle.WaitOne();
                onQuit();
            }
            catch (Exception ex) { Log.E("quit listener", ex); }
        })
        {
            IsBackground = true,
            Name = "quit-signal"
        };
        thread.Start();
    }

    /// <summary>0 = signalled, 2 = nothing was running, 1 = failed.</summary>
    public static int Send()
    {
        try
        {
            using var handle = EventWaitHandle.OpenExisting(EventName);
            handle.Set();
            Thread.Sleep(600); // give the tray a moment to unload before we exit
            return 0;
        }
        catch (WaitHandleCannotBeOpenedException)
        {
            return 2;
        }
        catch (Exception ex)
        {
            Log.E("quit signal", ex);
            return 1;
        }
    }
}
