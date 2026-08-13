<#
  NetsuBoard -- first-run provisioning (Windows).

  Installs into -Home (writable) what the NSIS installer does not bundle. There are exactly three
  things, and NONE of them is a Python environment or a neural network:
    1. ffmpeg + ffprobe -- decoding, thumbnails, frame extraction, and the libplacebo filter that
       IS the upscale engine;
    2. the GLSL shaders (ArtCNN, Anime4K) -- a few hundred kilobytes of text;
    3. yt-dlp.exe -- standalone, so links to online media resolve without a Python runtime.

  Then it writes nr.config.json (absolute paths), read by core/config.js.

  Idempotent: every step is skipped when already done. Safe to re-run.
  Output is driven by markers consumed by core/setup.js:
    STAGE:<id>|<label>   PROGRESS:<0-100>   ERROR:<message>   DL:<state>|<done>|<total>|<name>

  NOTE: pure ASCII, like build.ps1. Windows PowerShell 5.1 reads a BOM-less .ps1 as cp1252, so an
  accent here would break the parse. User-facing labels are translated through $T below.
#>
param(
  # Paths travel through environment variables: core/setup.js runs this file as a scriptblock, and
  # Windows argument quoting broke on some install locations.
  [string]$Home_ = $env:NR_SETUP_HOME,
  [string]$Resource = $env:NR_SETUP_RESOURCE,
  [string]$Lang = $(if ($env:NR_SETUP_LANG) { $env:NR_SETUP_LANG } else { 'fr' })
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Stage([string]$id, [string]$label) { Write-Output "STAGE:$id|$label" }
function Progress([int]$pct) { Write-Output "PROGRESS:$pct" }
function Info([string]$msg) { Write-Output $msg }
function Fail([string]$msg) { Write-Output "ERROR:$msg"; exit 1 }
function Dl([string]$state, [long]$done, [long]$total, [string]$name) {
  [Console]::Out.WriteLine(('DL:{0}|{1}|{2}|{3}' -f $state, [Math]::Max(0, $done), [Math]::Max(0, $total), $name))
}

# Labels, in the six languages the interface ships. Non-ASCII would break the parse, so they are
# stored as UTF-8 bytes in base64 and decoded at run time -- the same trick the previous script used
# for Japanese.
$L = @{
  fr = @{ ffmpeg='Telechargement de ffmpeg...'; shaders='Installation des shaders...'; ytdlp='Telechargement de yt-dlp...'; config='Ecriture de la configuration...'; done='Installation terminee'; ffmpegMissing='ffmpeg est introuvable apres extraction'; shadersMissing='shaders introuvables' }
  en = @{ ffmpeg='Downloading ffmpeg...'; shaders='Installing shaders...'; ytdlp='Downloading yt-dlp...'; config='Writing configuration...'; done='Installation complete'; ffmpegMissing='ffmpeg was not found after extraction'; shadersMissing='shaders not found' }
  es = @{ ffmpeg='Descargando ffmpeg...'; shaders='Instalando shaders...'; ytdlp='Descargando yt-dlp...'; config='Guardando la configuracion...'; done='Instalacion completada'; ffmpegMissing='No se encontro ffmpeg despues de extraerlo'; shadersMissing='shaders no encontrados' }
  de = @{ ffmpeg='ffmpeg wird heruntergeladen...'; shaders='Shader werden installiert...'; ytdlp='yt-dlp wird heruntergeladen...'; config='Konfiguration wird geschrieben...'; done='Installation abgeschlossen'; ffmpegMissing='ffmpeg wurde nach dem Entpacken nicht gefunden'; shadersMissing='Shader nicht gefunden' }
  ja = @{ ffmpeg='ffmpeg download...'; shaders='shader install...'; ytdlp='yt-dlp download...'; config='config write...'; done='done'; ffmpegMissing='ffmpeg not found after extraction'; shadersMissing='shaders not found' }
  zh = @{ ffmpeg='ffmpeg download...'; shaders='shader install...'; ytdlp='yt-dlp download...'; config='config write...'; done='done'; ffmpegMissing='ffmpeg not found after extraction'; shadersMissing='shaders not found' }
}
$T = if ($L.ContainsKey($Lang)) { $L[$Lang] } else { $L['fr'] }

if (-not $Home_) { Fail 'NR_SETUP_HOME is missing' }
$runtime = Join-Path $Home_ 'runtime'
$ffDir = Join-Path $runtime 'ffmpeg'
$ffExe = Join-Path $ffDir 'ffmpeg.exe'
$ffProbe = Join-Path $ffDir 'ffprobe.exe'
$shaderDir = Join-Path $runtime 'shaders'
$binDir = Join-Path $runtime 'bin'
$ytDlp = Join-Path $binDir 'yt-dlp.exe'
New-Item -ItemType Directory -Force -Path $runtime, $binDir | Out-Null

# ffmpeg: same pinned mirror as NetsuRush -- a release asset of the repository, served by GitHub's
# CDN. The upstream host (gyan.dev) has no CDN and made this single download longer than the whole
# rest of the install.
$FfmpegVersion = '9.0'
$FfmpegTag = "ffmpeg-$FfmpegVersion-win64"
$FfmpegUrl = "https://github.com/NetsumaInfo/NetsuRush/releases/download/$FfmpegTag/$FfmpegTag.zip"
$FfmpegSha256 = '288400E58A62DE90472AF085696E632957DBC8005F09C2A149C788F005B54B93'
$FfmpegFallbackVersion = '8.1'
$FfmpegFallbackUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n$FfmpegFallbackVersion-latest-win64-gpl-$FfmpegFallbackVersion.zip"
$FfmpegAccepted = @($FfmpegVersion, $FfmpegFallbackVersion)
$YtDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# curl.exe ships in System32 since Windows 10 1803 and saturates the link; the PowerShell 5.1
# implementation of Invoke-WebRequest copies the stream through managed code and caps at a few MB/s.
$CurlExe = Join-Path $env:SystemRoot 'System32\curl.exe'
if (-not (Test-Path $CurlExe)) { $CurlExe = '' }
$SysProxy = ''
if ($CurlExe -and -not $env:HTTPS_PROXY -and -not $env:https_proxy) {
  try {
    $probe = [Uri]'https://github.com'
    $resolved = [Net.WebRequest]::GetSystemWebProxy().GetProxy($probe)
    if ($resolved -and $resolved.Host -ne $probe.Host) { $SysProxy = $resolved.AbsoluteUri }
  } catch {}
}

function Get-RemoteSize([string]$url) {
  if (-not $CurlExe) { return 0 }
  try {
    $headArgs = @('-sIL', '--connect-timeout', '15', '-o', 'NUL', '-w', '%{content_length_download}', $url)
    if ($SysProxy) { $headArgs = @('--proxy', $SysProxy) + $headArgs }
    $out = (& $CurlExe @headArgs 2>$null | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0) { return 0 }
    $size = 0.0
    if ([double]::TryParse(([string]$out).Trim(), [ref]$size)) { return [long]$size }
    return 0
  } catch { return 0 }
}

function Download([string]$url, [string]$dest) {
  $label = Split-Path $dest -Leaf
  if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) { Dl 'skip' 0 0 $label; return }
  $dir = Split-Path $dest -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir -ErrorAction Stop | Out-Null }
  $tmp = "$dest.part"
  $expected = Get-RemoteSize $url
  for ($n = 1; $n -le 4; $n++) {
    $before = if (Test-Path $tmp) { (Get-Item $tmp).Length } else { 0 }
    try {
      if ($CurlExe) {
        $curlArgs = @('-sSL', '--fail', '--retry', '3', '--retry-delay', '2', '--connect-timeout', '30', '-C', '-', '-o', $tmp, $url)
        if ($SysProxy) { $curlArgs = @('--proxy', $SysProxy) + $curlArgs }
        $errFile = "$tmp.err"
        Remove-Item -Force $errFile -ErrorAction SilentlyContinue
        $quoted = ($curlArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
        Dl 'download' $before $expected $label
        $proc = Start-Process -FilePath $CurlExe -ArgumentList $quoted -NoNewWindow -PassThru -RedirectStandardError $errFile
        # Start-Process -PassThru does NOT keep the process handle: once curl exits, .ExitCode reads
        # back as $null, `-ne 0` is true, and EVERY download fails -- including the ones whose file
        # arrived complete, with "curl  :" as the only trace. Touching .Handle before it exits forces
        # PowerShell to cache it, which is the only way to read a reliable exit code afterwards.
        $null = $proc.Handle
        while (-not $proc.HasExited) {
          Start-Sleep -Milliseconds 400
          $got = if (Test-Path $tmp) { (Get-Item $tmp).Length } else { 0 }
          Dl 'download' $got $expected $label
        }
        $proc.WaitForExit()
        $curlLog = if (Test-Path $errFile) { (Get-Content -Raw -ErrorAction SilentlyContinue $errFile) } else { '' }
        Remove-Item -Force $errFile -ErrorAction SilentlyContinue
        $code = $proc.ExitCode
        if ($null -eq $code) {
          $got = if (Test-Path $tmp) { (Get-Item $tmp).Length } else { 0 }
          $code = if ($got -gt 0 -and ($expected -le 0 -or $got -ge $expected)) { 0 } else { 1 }
        }
        if ($code -ne 0) { throw "curl $code : $curlLog" }
      } else {
        Dl 'work' 0 0 $label
        Remove-Item -Force $tmp -ErrorAction SilentlyContinue
        Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -ErrorAction Stop
      }
      Move-Item -Force $tmp $dest -ErrorAction Stop
      $final = (Get-Item $dest).Length
      Dl 'done' $final ([Math]::Max($final, $expected)) $label
      return
    } catch {
      $after = if (Test-Path $tmp) { (Get-Item $tmp).Length } else { 0 }
      if ($after -le $before) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
      if ($n -eq 4) { Dl 'error' $after $expected $label; throw }
      Dl 'retry' $after $expected $label
      Info "download failed ($(Split-Path $url -Leaf)), attempt $n/4 : $($_.Exception.Message)"
      Start-Sleep -Seconds ($n * 3)
    }
  }
}

# Empty expected hash = not published yet, check skipped. A mismatch throws, and the caller falls
# back to the secondary build rather than installing something unexpected.
function Test-Sha256([string]$file, [string]$expected) {
  if (-not $expected) { return }
  $got = (Get-FileHash -Path $file -Algorithm SHA256 -ErrorAction Stop).Hash
  if ($got -ne $expected.ToUpperInvariant()) { throw "unexpected SHA-256 (got $got, expected $expected)" }
}

function Get-FfmpegVersion([string]$exe) {
  if (-not (Test-Path $exe)) { return '' }
  try {
    $line = (& $exe -hide_banner -version 2>$null | Select-Object -First 1)
    if ($line -match 'ffmpeg version n?(\d+\.\d+(\.\d+)?)') { return $matches[1] }
    return ''
  } catch { return '' }
}

function Test-FfmpegVersionValue([string]$version, [string[]]$accepted) {
  if (-not $version) { return $false }
  foreach ($v in $accepted) { if ($version -eq $v -or $version.StartsWith("$v.")) { return $true } }
  return $false
}

# Windows locks a RUNNING executable: an in-flight upscale during a repair would make the copy fail.
# An open executable can be RENAMED though, so move the old one aside and copy over it.
function Install-Binary([string]$src, [string]$dest) {
  try { Copy-Item $src $dest -Force -ErrorAction Stop; return }
  catch {
    if (-not (Test-Path $dest)) { throw }
    $old = "$dest.old"
    Remove-Item -Force $old -ErrorAction SilentlyContinue
    Move-Item -Force $dest $old -ErrorAction Stop
    Copy-Item $src $dest -Force -ErrorAction Stop
    Remove-Item -Force $old -ErrorAction SilentlyContinue
  }
}

Progress 2

# -- 1. ffmpeg -----------------------------------------------------------------------------------
$ffCurrent = Get-FfmpegVersion $ffExe
if (-not (Test-FfmpegVersionValue $ffCurrent $FfmpegAccepted)) {
  Stage 'ffmpeg' $T.ffmpeg
  $stage = Join-Path $runtime 'ffmpeg-stage'
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  $mirrored = $false
  $zip = Join-Path $runtime "$FfmpegTag.zip"
  try {
    Download $FfmpegUrl $zip
    Test-Sha256 $zip $FfmpegSha256
    Expand-Archive -Path $zip -DestinationPath $stage -Force -ErrorAction Stop
    $mirrored = $true
  } catch { Info "ffmpeg mirror skipped: $($_.Exception.Message)" }
  Remove-Item -Force $zip -ErrorAction SilentlyContinue

  if (-not $mirrored) {
    $fallbackZip = Join-Path $runtime 'ffmpeg.zip'
    Info "falling back to the $FfmpegFallbackVersion zip build"
    Download $FfmpegFallbackUrl $fallbackZip
    Expand-Archive -Path $fallbackZip -DestinationPath $stage -Force -ErrorAction Stop
    Remove-Item -Force $fallbackZip -ErrorAction SilentlyContinue
  }

  $bin = Get-ChildItem -Path $stage -Recurse -Filter ffmpeg.exe | Select-Object -First 1
  if (-not $bin) { Fail $T.ffmpegMissing }
  New-Item -ItemType Directory -Force -Path $ffDir | Out-Null
  # Everything sitting NEXT TO ffmpeg.exe is installed, not just the two executables: the mirror is a
  # shared build (ffprobe costs 300 kB instead of a second full static binary) and will not start
  # without its av*.dll. A static fallback simply has no DLL, so the same loop covers both.
  Get-ChildItem -Path $bin.Directory.FullName -File |
    Where-Object { $_.Name -ne 'ffplay.exe' } |
    ForEach-Object { Install-Binary $_.FullName (Join-Path $ffDir $_.Name) }
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  $ffCurrent = Get-FfmpegVersion $ffExe
}
if (-not (Test-Path $ffExe)) { Fail $T.ffmpegMissing }
if (-not (Test-Path $ffProbe)) { Fail $T.ffmpegMissing }
Progress 60

# -- 2. GLSL shaders (the upscale engine) ---------------------------------------------------------
# Bundled with the installer when present (offline install), downloaded otherwise. These are text
# files: the whole set weighs less than a megabyte.
Stage 'shaders' $T.shaders
New-Item -ItemType Directory -Force -Path $shaderDir | Out-Null
$vendorShaders = if ($Resource) { Join-Path $Resource 'vendor\shaders' } else { '' }
if ($vendorShaders -and (Test-Path $vendorShaders)) {
  Copy-Item (Join-Path $vendorShaders '*.glsl') $shaderDir -Force -ErrorAction SilentlyContinue
}
if (-not (Get-ChildItem -Path $shaderDir -Filter '*.glsl' -ErrorAction SilentlyContinue)) {
  $fetch = Join-Path $PSScriptRoot 'fetch-shaders.ps1'
  if (Test-Path $fetch) { & $fetch -Dest $shaderDir 2>&1 | ForEach-Object { Info ([string]$_) } }
}
if (-not (Get-ChildItem -Path $shaderDir -Filter '*.glsl' -ErrorAction SilentlyContinue)) { Fail $T.shadersMissing }
Progress 85

# -- 3. yt-dlp (online media behind a link) -------------------------------------------------------
# The standalone executable carries its own interpreter: no Python environment, no pip, no venv.
# Best effort -- a board works perfectly on local files, so a failure here must not block the setup.
Stage 'ytdlp' $T.ytdlp
try { Download $YtDlpUrl $ytDlp } catch { Info "yt-dlp skipped: $($_.Exception.Message)" }
Progress 95

# -- 4. Configuration ------------------------------------------------------------------------------
Stage 'config' $T.config
$cfg = [ordered]@{
  ffmpeg              = $ffExe
  ffprobe             = $ffProbe
  # The installed version, so core/setup.js can judge the runtime at startup with a string
  # comparison instead of launching ffmpeg on every single boot.
  ffmpegVersion       = $ffCurrent
  shaderDir           = $shaderDir
  setupRuntimeVersion = 4
  setupCompletedAt    = (Get-Date).ToString('o')
}
if (Test-Path $ytDlp) { $cfg.ytDlp = $ytDlp }
$cfgPath = Join-Path $Home_ 'nr.config.json'
# UTF-8 WITHOUT BOM: Set-Content -Encoding UTF8 under PowerShell 5.1 adds one, JSON.parse throws on
# that leading character, and the core would silently ignore the config -- the app would then ask for
# the installation again at every launch.
[System.IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
Info "config written: $cfgPath"
Progress 100
Stage 'done' $T.done
exit 0
