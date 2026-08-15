# fetch-shaders.ps1 — provisionne les shaders GLSL du moteur d'upscale "Turbo" (ffmpeg libplacebo).
# UN SEUL réseau : ArtCNN, licence MIT → bundlable. Idempotent (re-télécharge sans casser).
#
# Anime4K a été retiré : deux familles à départager pour un gain nul face à C4F32. Les poids ArtCNN R
# (ONNX) le sont aussi — NetsuBoard n'embarque aucun runtime neuronal capable de les exécuter.
#
# Cible : vendor/shaders/ (dev, gitignored) ou le dossier passé en argument (packaging → resources/shaders).
param([string]$Dest = "$PSScriptRoot/../vendor/shaders")

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$art = "https://raw.githubusercontent.com/Artoriuz/ArtCNN/main/GLSL"

function Get-File($url, $out) {
  Write-Host "  $([System.IO.Path]::GetFileName($out))"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

Write-Host "Shaders Turbo → $Dest"
# ArtCNN : deux tailles de réseau × trois entraînements — neutre, DS (débruite et accentue), DN
# (débruite et adoucit). Ce sont les six seuls shaders publiés par le dépôt.
foreach ($net in @("C4F32", "C4F16")) {
  foreach ($suffix in @("", "_DS", "_DN")) {
    $name = "ArtCNN_$net$suffix.glsl"
    Get-File "$art/$name" "$Dest/$name"
  }
}
# Licence (attribution).
Get-File "https://raw.githubusercontent.com/Artoriuz/ArtCNN/main/LICENSE" "$Dest/LICENSE_ArtCNN.txt"
Write-Host "OK — shaders Turbo prêts."
