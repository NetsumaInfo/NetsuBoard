<#
  Build de l'installeur standalone NetsuBoard (.exe NSIS).
  1. type-check + build du renderer (dist/)
  2. recupere node.exe portable (sidecar du core)
  3. stage core/ + setup.ps1 + shaders dans src-tauri/resources/ (bundles en ressources Tauri)
  4. tauri build -> src-tauri/target/release/bundle/nsis/*-setup.exe

  Le destinataire lance l'installeur ; au 1er demarrage l'app provisionne son runtime
  (ffmpeg, shaders GLSL, yt-dlp -- cf. scripts/setup.ps1) dans %LOCALAPPDATA%\NetsuBoard.
  Aucun venv, aucun poids : NetsuBoard n'embarque pas de sidecar ML.

  NOTE: ce fichier est ASCII pur a dessein. Il est lance DIRECTEMENT par Windows PowerShell 5.1
  (sans BOM => lecture cp1252) ; tout caractere accentue ou tiret long casserait le parse.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Mutex name distinct from NetsuRush's: the two checkouts build side by side and must never
# serialise against each other.
$buildMutex = New-Object System.Threading.Mutex($false, 'Local\NetsuBoardBuild')
try { $hasBuildLock = $buildMutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $hasBuildLock = $true }
if (-not $hasBuildLock) {
  $buildMutex.Dispose()
  throw 'un autre build NetsuBoard est deja en cours'
}

try {
$res = Join-Path $root 'src-tauri\resources'
$stageCore = Join-Path $res 'core'
$stageScripts = Join-Path $res 'scripts'
$stageShaders = Join-Path $res 'shaders'
$stageWindows = Join-Path $res 'windows'
$stageDist = Join-Path $res 'dist'
$outDir = Join-Path $root 'src-tauri\target\release\bundle\nsis'
$manifest = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$artifactFilter = "$($manifest.name)_$($manifest.version)_*-setup.exe"

Write-Host '== 1/5 Verifications (core + i18n) =='
npm run check:core
if ($LASTEXITCODE -ne 0) { throw 'verification core echouee' }
npm run check:i18n
if ($LASTEXITCODE -ne 0) { throw 'verification i18n echouee' }

Write-Host '== 2/5 Renderer (tsc + vite build) =='
npm run build
if ($LASTEXITCODE -ne 0) { throw 'build renderer echoue' }

Write-Host '== 3/5 node.exe (sidecar core) =='
& (Join-Path $PSScriptRoot 'fetch-node.ps1')
if ($LASTEXITCODE -ne 0) { throw 'fetch-node echoue' }
# PAS de runtime mpv. Le lecteur natif est du code herite de NetsuRush : aucune ligne de src\ ou de
# core\ n'appelle nativePlayer ni les commandes player_*. Embarquer libmpv (GPL-2.0-or-later) et les
# DLL ffmpeg qui l'accompagnent obligerait l'installeur a redistribuer leurs textes de licence et
# les sources correspondantes (docs\licensing.md) pour un chemin que rien n'emprunte.
# src-tauri\src\player\bootstrap.rs traite leur absence : il journalise et l'app demarre sans.
# Reintroduire le lecteur = republier l'asset mpv COMPLET (DLL + licences + revisions de source),
# le referencer dans fetch-mpv.ps1, et remettre l'appel ici avec le stage vers resources\windows.

Write-Host '== 4/5 Stage des ressources (core/scripts/shaders) =='
$required = @(
  'core\server.js',
  'scripts\setup.ps1',
  'scripts\uninstall-cleanup.ps1'
  # vendor\shaders n'est PAS exige : l'etape 4 telecharge les shaders (fetch-shaders.ps1) quand la
  # copie locale manque. L'exiger ici rendait ce repli inatteignable et cassait le build d'un clone
  # neuf, ou vendor/ est absent (gitignore).
  # Aucune DLL mpv exigee : voir l'etape 3.
)
foreach ($relative in $required) {
  if (-not (Test-Path (Join-Path $root $relative))) {
    throw "ressource obligatoire absente : $relative"
  }
}
foreach ($d in @($stageCore, $stageScripts)) {
  if (Test-Path $d) { Remove-Item -Recurse -Force $d }
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
# tauri.conf.json embarque resources\**\* EN ENTIER : tout dossier oublie la part dans l'installeur.
# Un stage NetsuRush laissait ainsi python\ et adobe-cep\ dans le paquet, alors que NetsuBoard
# n'embarque aucun sidecar Python et ne pilote aucune application de montage. Le stage est donc une
# liste FERMEE : ce qui n'y figure pas est supprime avant le bundle.
$staged = @('bin', 'core', 'dist', 'scripts', 'shaders', 'windows')
Get-ChildItem -Path $res -Directory -ErrorAction SilentlyContinue |
  Where-Object { $staged -notcontains $_.Name } |
  ForEach-Object {
    Write-Host "  purge d'un reste de stage : $($_.Name)"
    Remove-Item -Recurse -Force $_.FullName
  }
# core/ : code CommonJS uniquement (exclut nr.config.json local + caches eventuels).
Copy-Item -Recurse -Force (Join-Path $root 'core\*') $stageCore
Get-ChildItem -Path $stageCore -Recurse -Filter 'nr.config.json' | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $stageCore -Recurse -Directory -Filter '__pycache__' |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
# Aucun stage python/ : NetsuBoard n'embarque aucun sidecar ML. Son runtime tient en ffmpeg, les
# shaders GLSL et yt-dlp.exe, tous provisionnes par setup.ps1.
# setup.ps1 : provisionnement 1er lancement. Reecrit en UTF-8 AVEC BOM : Windows PowerShell 5.1
# (celui que le core spawn) lit un .ps1 sans BOM comme cp1252 -> les accents deviennent du charabia.
# Le BOM force la lecture UTF-8. Lecture via .NET pour ne pas dependre de l'ANSI.
$ps1Text = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'setup.ps1'), [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $stageScripts 'setup.ps1'), $ps1Text, [System.Text.UTF8Encoding]::new($true))
$uninstallText = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'uninstall-cleanup.ps1'), [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $stageScripts 'uninstall-cleanup.ps1'), $uninstallText, [System.Text.UTF8Encoding]::new($true))

# Aucun stage vendor/ML : OmniShotCut, NOVA-VAD, les poids Real-ESRGAN et sam2 appartenaient aux
# modules IA, qui n existent plus ici. Seuls les shaders sont stages plus bas.

# dist/ (renderer builde) -> resources/dist : sert la vue remote du panneau CEP en production
# (core/appstatic.js expose /app quand NR_RESOURCE_DIR/dist/index.html existe).
if (Test-Path $stageDist) { Remove-Item -Recurse -Force $stageDist }
New-Item -ItemType Directory -Force -Path $stageDist | Out-Null
Copy-Item -Recurse -Force (Join-Path $root 'dist\*') $stageDist

# Shaders Turbo (GLSL libplacebo, MIT) -> resources/shaders (lus via NR_RESOURCE_DIR/shaders).
# Prefere la copie locale vendor/shaders (offline garanti) ; sinon telechargement best-effort.
if (Test-Path $stageShaders) { Remove-Item -Recurse -Force $stageShaders }
$localShaders = Join-Path $root 'vendor\shaders'
if (Test-Path $localShaders) {
  New-Item -ItemType Directory -Force -Path $stageShaders | Out-Null
  Copy-Item -Recurse -Force (Join-Path $localShaders '*') $stageShaders
} else {
  try { & (Join-Path $PSScriptRoot 'fetch-shaders.ps1') $stageShaders }
  catch { throw "fetch-shaders echoue : $_" }
}

# resources\windows : le dossier ou mpv_ffi.rs cherche libmpv-2.dll. Il est VIDE ici (voir etape 3),
# et purge a chaque build pour qu'un ancien stage ne reintroduise pas les DLL en douce.
if (Test-Path $stageWindows) { Remove-Item -Recurse -Force $stageWindows }
New-Item -ItemType Directory -Force -Path $stageWindows | Out-Null

Write-Host '== 5/5 tauri build (NSIS) =='
# Supprime seulement l'artefact de la version courante : ainsi un ancien setup ne peut jamais
# transformer un build incomplet en faux succes, tout en preservant les versions precedentes.
if (Test-Path $outDir) {
  Get-ChildItem -Path $outDir -Filter $artifactFilter -File -ErrorAction SilentlyContinue |
    Remove-Item -Force
}
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw 'tauri build echoue' }

$out = Get-ChildItem -Path $outDir -Filter $artifactFilter -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $out -or $out.Length -le 0) { throw "installeur NSIS introuvable ou vide : $artifactFilter" }
Write-Host "`nInstalleur pret : $($out.FullName)" -ForegroundColor Green
} finally {
  $buildMutex.ReleaseMutex()
  $buildMutex.Dispose()
}
