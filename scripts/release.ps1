# Locked In release script (ASCII only - PowerShell 5.1 chokes on smart punctuation)
# Usage: .\scripts\release.ps1  (run from the repo root, after bumping "version" in src-tauri\tauri.conf.json)
# Builds a signed installer, creates the GitHub release, uploads the artifacts
# and updates latest.json so every installed app shows the update popup.

param(
  [string]$Message = "",
  # oldest version still allowed to run; below it the app force-updates.
  # Omitted -> keeps whatever min_version the current latest.json carries.
  [string]$MinVersion = ""
)

$ErrorActionPreference = "Stop"
$repo = "JuanArtxz/locked-in"

$conf = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$version = $conf.version
Write-Host "Releasing v$version" -ForegroundColor Green

# signed build (private key + password never live in the repo)
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\lockedin.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content "$env:USERPROFILE\.tauri\lockedin.key.pass" -Raw
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$bundle = "src-tauri\target\release\bundle\nsis"
$exe = Get-ChildItem "$bundle\*_$($version)_x64-setup.exe" | Select-Object -First 1
$sig = Get-ChildItem "$bundle\*_$($version)_x64-setup.exe.sig" | Select-Object -First 1
if (-not $exe -or -not $sig) { throw "installer or signature not found in $bundle" }

# github release with both artifacts
gh release create "v$version" $exe.FullName $sig.FullName --repo $repo --title "Locked In v$version" --generate-notes
if ($LASTEXITCODE -ne 0) { throw "gh release failed" }

# updater manifest (GitHub asset names replace spaces with dots)
$assetName = $exe.Name -replace ' ', '.'

# min_version: explicit param wins, otherwise carry the previous one forward
if (-not $MinVersion -and (Test-Path "latest.json")) {
  try {
    $prev = Get-Content "latest.json" -Raw | ConvertFrom-Json
    if ($prev.PSObject.Properties.Name -contains "min_version") { $MinVersion = $prev.min_version }
  } catch {}
}

$manifest = [ordered]@{
  version   = $version
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $sig.FullName -Raw).Trim()
      url       = "https://github.com/$repo/releases/download/v$version/$assetName"
    }
  }
}
if ($MinVersion) { $manifest["min_version"] = $MinVersion }

# WriteAllText with BOM-less UTF8: Out-File -Encoding utf8 adds a BOM in PS 5.1,
# and a BOM breaks the updater's JSON parsing
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$PWD\latest.json", $json, [System.Text.UTF8Encoding]::new($false))

git add latest.json
git commit -m "release v$version"
git push
Write-Host "v$version released - every app shows the update popup within 6h or on next launch" -ForegroundColor Green
