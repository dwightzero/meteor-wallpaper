using System.Text.Json;

namespace MeteorWallpaper;

internal sealed class Settings
{
    public bool Enabled { get; set; } = true;
    public string Mode { get; set; } = "solar";
    public double Dim { get; set; } = 0.6;      // 0.2 – 1.0 exposure (advanced, json only)
    public int Fps { get; set; } = 30;          // advanced, json only
    public bool AutoStart { get; set; }
    public double Spin { get; set; } = 1.0;     // 0 = still camera

    /// <summary>Seed of the system currently on screen. Written on every launch.</summary>
    public int Seed { get; set; }

    /// <summary>Keep the stored seed on launch instead of rolling a new one (reproduce a system).</summary>
    public bool KeepSeed { get; set; }

    public bool Welcomed { get; set; }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static string FilePath => Path.Combine(AppContext.BaseDirectory, "settings.json");

    public static Settings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var s = JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath), JsonOptions);
                if (s != null) return s;
            }
        }
        catch (Exception ex) { Log.E("settings load", ex); }
        return new Settings();
    }

    public void Save()
    {
        try { File.WriteAllText(FilePath, JsonSerializer.Serialize(this, JsonOptions)); }
        catch (Exception ex) { Log.E("settings save", ex); }
    }
}
