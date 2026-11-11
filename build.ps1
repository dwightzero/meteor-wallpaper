# Builds the portable package: publish -> add docs/scripts -> zip.
# Requires .sdk\dotnet.exe (installed once by dotnet-install.ps1).

# --- encoding guard (keep this block ASCII-only) -----------------------------
# This script writes Chinese file names (关闭壁纸.bat etc.), so it must be read
# as UTF-8. Editors love to strip the BOM; if that happens PowerShell 5.1 reads
# the file as ANSI, the literals turn to mojibake and WriteAllText throws
# "Illegal characters in path". Fix our own bytes and restart once.
$selfPath = $MyInvocation.MyCommand.Path
$raw = [System.IO.File]::ReadAllBytes($selfPath)
$hasBom = $raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF
if (-not $hasBom) {
    if ($env:MW_BUILD_BOM_RETRY -eq '1') {
        Write-Host 'build.ps1 is not UTF-8 with BOM and could not be fixed.' -ForegroundColor Red
        exit 3
    }
    $text = [System.Text.Encoding]::UTF8.GetString($raw)
    [System.IO.File]::WriteAllText($selfPath, $text, (New-Object System.Text.UTF8Encoding($true)))
    $env:MW_BUILD_BOM_RETRY = '1'
    Write-Host 'build.ps1 had no BOM; re-wrote it and restarting...' -ForegroundColor Yellow
    & powershell -NoProfile -ExecutionPolicy Bypass -File $selfPath
    exit $LASTEXITCODE
}
# -----------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dotnet = Join-Path $root '.sdk\dotnet.exe'
$proj = Join-Path $root 'src\MeteorWallpaper\MeteorWallpaper.csproj'
$dist = Join-Path $root 'dist\MeteorWallpaper'
$zip = Join-Path $root 'dist\MeteorWallpaper_v1.7.1.zip'

# Keep every tool write inside the project folder.
$env:TMP = Join-Path $root '.tmp'
$env:TEMP = $env:TMP
$env:APPDATA = Join-Path $root '.appdata\Roaming'
$env:LOCALAPPDATA = Join-Path $root '.appdata\Local'
New-Item -ItemType Directory -Force -Path $env:TMP, $env:APPDATA, $env:LOCALAPPDATA | Out-Null
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_CLI_HOME = Join-Path $root '.dhome'
$env:NUGET_PACKAGES = Join-Path $root '.nuget'
$env:MSBUILDDISABLENODEREUSE = '1'

Write-Host '== publish' -ForegroundColor Cyan
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
& $dotnet publish $proj -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=false -o $dist --no-restore -nodeReuse:false
if ($LASTEXITCODE -ne 0) { throw "publish failed: $LASTEXITCODE" }

Write-Host '== docs' -ForegroundColor Cyan
$docs = Join-Path $root 'docs'
if (Test-Path (Join-Path $docs '使用说明.txt')) {
    Copy-Item (Join-Path $docs '使用说明.txt') (Join-Path $dist '使用说明.txt') -Force
    Copy-Item (Join-Path $docs '使用说明.txt') (Join-Path $dist 'README.txt') -Force
}

$gbk = [Text.Encoding]::GetEncoding(936)
[IO.File]::WriteAllText((Join-Path $dist '截图-太阳系.bat'),
    "@echo off`r`ncd /d `"%~dp0`"`r`nMeteorWallpaper.exe --capture `"%~dp0preview-solar.png`" --mode solar --wait 9000`r`necho.`r`necho preview-solar.png 已生成，把这张图发给我。`r`npause", $gbk)
[IO.File]::WriteAllText((Join-Path $dist '截图-地球.bat'),
    "@echo off`r`ncd /d `"%~dp0`"`r`nMeteorWallpaper.exe --capture `"%~dp0preview-earth.png`" --mode earth --wait 12000`r`necho.`r`necho preview-earth.png 已生成，把这张图发给我。`r`npause", $gbk)

[IO.File]::WriteAllText((Join-Path $dist '关闭壁纸.bat'),
    "@echo off`r`ncd /d `"%~dp0`"`r`nMeteorWallpaper.exe --quit`r`nif errorlevel 1 (`r`n  echo.`r`n  echo 没找到正在运行的流星壁纸（可能已经关了）。`r`n) else (`r`n  echo.`r`n  echo 已关闭流星壁纸。`r`n)`r`necho.`r`ntimeout /t 4 >nul", $gbk)

$diag = @"

@echo off
cd /d "%~dp0"
set OUT=%~dp0诊断结果
if not exist "%OUT%" mkdir "%OUT%"

echo [1/4] 环境自检...
MeteorWallpaper.exe --selftest "%OUT%\selftest.txt"

echo [2/4] 渲染太阳系视角（约 15 秒）...
MeteorWallpaper.exe --capture "%OUT%\solar.png" --mode solar --wait 9000

echo [3/4] 渲染地球视角（约 18 秒）...
MeteorWallpaper.exe --capture "%OUT%\earth.png" --mode earth --wait 12000

echo [4/4] 收集日志...
if exist "data\meteor.log" copy /y "data\meteor.log" "%OUT%\meteor.log" >nul

echo.
echo 完成。请把「诊断结果」整个文件夹打包发给我。
echo 里面包含：selftest.txt（环境）、solar.png / earth.png（真实渲染）、meteor.log（运行日志）
pause
"@
[IO.File]::WriteAllText((Join-Path $dist '诊断.bat'), $diag, $gbk)
if ($NoZip) { Write-Host 'skip zip' -ForegroundColor Yellow; return }

Write-Host '== zip' -ForegroundColor Cyan
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $dist, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "done: $zip ($size MB)" -ForegroundColor Green
