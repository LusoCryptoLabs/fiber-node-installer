<#
.SYNOPSIS
    Fiber Network Node installer / uninstaller for Windows

.DESCRIPTION
    This PowerShell script installs or uninstalls the Fiber Network Node on
    Windows. It downloads fnn and ckb-cli, configures a node directory,
    generates a CKB wallet, writes a YAML config file, runs a quick health
    check, and optionally registers a Windows Task Scheduler entry for
    auto-start on login.

    Usage:
      Install:   .\install-fiber.ps1
      Uninstall: .\install-fiber.ps1 -Uninstall
#>
param(
    [switch]$Uninstall
)

Add-Type -AssemblyName System.Net.Http

# Resolve latest release versions from GitHub API (fallback to known-good if offline)
function Get-LatestRelease([string]$repo, [string]$fallback) {
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" `
            -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        if ($rel.tag_name) { return $rel.tag_name }
    } catch {}
    Write-Warn "Could not fetch latest $repo release — using fallback $fallback"
    return $fallback
}

$FNN_VERSION     = Get-LatestRelease 'nervosnetwork/fiber'  'v0.7.1'
$CKB_CLI_VERSION = Get-LatestRelease 'nervosnetwork/ckb-cli' 'v1.9.0'

$FnnUrl    = "https://github.com/nervosnetwork/fiber/releases/download/$FNN_VERSION/fnn_${FNN_VERSION}-x86_64-windows.tar.gz"
$CkbCliUrl = "https://github.com/nervosnetwork/ckb-cli/releases/download/$CKB_CLI_VERSION/ckb-cli_${CKB_CLI_VERSION}_x86_64-pc-windows-msvc.zip"
$NssmUrl   = "https://nssm.cc/release/nssm-2.24.zip"

# Prefer PowerShell 7 (pwsh) when available, fall back to Windows PowerShell 5
$PS = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }

# state
$InstallDir        = "$env:USERPROFILE\fiber-node"
$Network           = 'mainnet'
$VpsIp             = ''
$NodeAlias         = 'scryve-node'
$NodePassword      = ''
$FundingAddress    = ''
$script:DashboardInstalled = $false

function Write-Info { param($msg) Write-Host "ℹ  $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "✓  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "⚠  $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "✗  ERROR: $msg" -ForegroundColor Red }

function Read-MaskedInput {
    param([string]$Prompt)
    Write-Host -NoNewline ($Prompt + ': ')
    $chars = New-Object System.Collections.ArrayList
    while ($true) {
        $key = [Console]::ReadKey($true)
        if ($key.Key -eq 'Enter') { break }
        if ($key.Key -eq 'Backspace') {
            if ($chars.Count -gt 0) {
                $chars.RemoveAt($chars.Count - 1)
                Write-Host -NoNewline "`b `b"
            }
        } else {
            [void]$chars.Add($key.KeyChar)
            Write-Host -NoNewline '*'
        }
    }
    Write-Host ''
    return ($chars -join '')
}

$script:StepTotal = 10
$script:StepCurrent = 0
function Show-Step {
    param([string]$Name)
    $script:StepCurrent++
    $label = "  Step $script:StepCurrent/$script:StepTotal  —  $Name  "
    $bar   = '─' * ($label.Length)
    Write-Host ""
    Write-Host "  $bar" -ForegroundColor DarkCyan
    Write-Host "  Step " -ForegroundColor DarkCyan -NoNewline
    Write-Host "$script:StepCurrent/$script:StepTotal" -ForegroundColor White -NoNewline
    Write-Host "  —  " -ForegroundColor DarkCyan -NoNewline
    Write-Host $Name -ForegroundColor Cyan
    Write-Host "  $bar" -ForegroundColor DarkCyan
}

function Invoke-Download {
    param([string]$Uri, [string]$OutFile, [string]$Label)
    $client = [System.Net.Http.HttpClient]::new()
    $stream = $null
    $out    = $null
    try {
        $response = $client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
        $response.EnsureSuccessStatusCode() | Out-Null
        $total  = $response.Content.Headers.ContentLength
        $stream = $response.Content.ReadAsStreamAsync().Result
        $out    = [System.IO.File]::Create($OutFile)
        $buf    = [byte[]]::new(65536)
        $downloaded = 0
        $read = 0
        $barWidth = 30
        [Console]::WriteLine("")   # blank line so progress bar never overlaps the preceding message
        while (($read = $stream.Read($buf, 0, $buf.Length)) -gt 0) {
            $out.Write($buf, 0, $read)
            $downloaded += $read
            if ($total -gt 0) {
                $pct    = [int]($downloaded * 100 / $total)
                $filled = [int]($pct / 100 * $barWidth)
                $bar    = ([string][char]0x2588 * $filled) + ([string][char]0x2591 * ($barWidth - $filled))
                $mb     = [math]::Round($downloaded / 1MB, 1)
                $tot    = [math]::Round($total / 1MB, 1)
                [Console]::Write("`r  [$bar] $pct%  ($mb / $tot MB)  ")
            }
        }
    } finally {
        if ($out)    { $out.Dispose() }
        if ($stream) { $stream.Dispose() }
        $client.Dispose()
    }
    [Console]::WriteLine("`r  [$([string][char]0x2588 * $barWidth)]  $Label complete.          ")
}

function Invoke-ElevationCheck {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "This installer needs Administrator privileges to configure the firewall." -ForegroundColor Yellow
        Write-Host "Re-launching as Administrator..." -ForegroundColor Yellow
        # Build a single quoted argument string so paths with spaces are handled correctly.
        $uninstallFlag = if ($Uninstall) { ' -Uninstall' } else { '' }
        Start-Process $PS -Verb RunAs `
            -ArgumentList "-ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`"$uninstallFlag"
        exit
    }
}

function Preflight {
    Write-Host "`n==== Fiber Network Node installer (Windows) ====`n"
    # architecture
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        Write-Err "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE). x86_64 required."
        exit 1
    }
    Write-Ok "Architecture: x86_64"

    # tar is required to extract fnn - present on Windows 10 1803+ by default
    if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
        Write-Err "tar.exe not found. It is built into Windows 10 (1803+) and Windows 11."
        Write-Err "If you are on an older version, install Git for Windows and retry."
        exit 1
    }
    Write-Ok "Found tar"

    # check curl or Invoke-WebRequest available implicitly
    Write-Ok "Pre-flight checks passed."
}

function Select-Network {
    Write-Host "`n1) Mainnet`n2) Testnet"
    do {
        $choice = Read-Host 'Enter 1 or 2'
        switch ($choice) {
            '1' {
                $script:Network = 'mainnet'
                Write-Ok 'Selected: Mainnet'; break
            }
            '2' {
                $script:Network = 'testnet'
                Write-Ok 'Selected: Testnet'
                Write-Warn 'Testnet CKB has no real value. Faucet: https://faucet.nervos.org'; break
            }
            default {
                Write-Warn 'Please enter 1 or 2.'
            }
        }
    } until ($choice -in '1','2')
}

function Get-NodeConfig {
    Write-Host "`nDetecting public IP..."
    try {
        $auto = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.ipify.org' -TimeoutSec 5
        if ($auto) {
            Write-Ok "Detected public IP: $auto"
            if ((Read-Host "Use $auto as your node's public IP? [Y/n]") -notmatch '^[Nn]') {
                $script:VpsIp = $auto
            }
        }
    } catch {}
    while (-not $script:VpsIp) {
        $script:VpsIp = (Read-Host "Enter your server's public IP address").Trim()
        if (-not $script:VpsIp) { Write-Warn "IP address cannot be empty." }
    }
    Write-Host "  (Press Enter to keep the default. Do NOT type Y or N here — this is a name, not a yes/no.)" -ForegroundColor DarkGray
    $resp = Read-Host "Choose a name for your node (visible on the network) [$NodeAlias]"
    if ($resp -match '^[yYnN]$') {
        Write-Warn "Looks like you typed Y/N. Keeping default name '$NodeAlias'."
        Write-Warn "To set a custom name, re-run the installer and type the full name here."
    } elseif ($resp) {
        # Strip chars that would break a YAML double-quoted string (quotes, backslash, control chars)
        $script:NodeAlias = ($resp -replace '["\\\x00-\x1f]', '').Trim()
        if (-not $script:NodeAlias) { $script:NodeAlias = 'fiber-node' }
    }
    Write-Ok "Node alias: $NodeAlias"
}

function Setup-Firewall {
    Write-Host "`nConfiguring Windows Firewall rules..."
    # Delete existing rules first to avoid duplicates on re-run
    netsh advfirewall firewall delete rule name="Fiber p2p"    | Out-Null
    netsh advfirewall firewall delete rule name="Fiber RPC block" | Out-Null
    netsh advfirewall firewall add rule name="Fiber p2p"    dir=in action=allow protocol=TCP localport=8228 | Out-Null
    netsh advfirewall firewall add rule name="Fiber RPC block" dir=in action=block  protocol=TCP localport=8227 | Out-Null
    Write-Ok "Firewall rules updated (8228 allowed, 8227 blocked)."
}

function Install-CkbCli {
    if (Test-Path "$InstallDir\ckb-cli.exe") {
        $installedVer = (& "$InstallDir\ckb-cli.exe" --version 2>&1 | Select-Object -First 1) -replace '^ckb-cli\s+', ''
        if ($installedVer -and $installedVer.Trim().StartsWith($CKB_CLI_VERSION.TrimStart('v'))) {
            Write-Ok "ckb-cli $CKB_CLI_VERSION already installed — skipping download."; return
        }
        Write-Info "ckb-cli version mismatch (have: $($installedVer.Trim()), want: $CKB_CLI_VERSION) — re-downloading..."
    }
    Write-Info "Downloading ckb-cli $CKB_CLI_VERSION..."
    New-Item -ItemType Directory -Force -Path $InstallDir\temp | Out-Null
    $zip = "$InstallDir\temp\ckb-cli.zip"
    try {
        Invoke-Download -Uri $CkbCliUrl -OutFile $zip -Label "ckb-cli $CKB_CLI_VERSION"
    } catch {
        Remove-Item "$InstallDir\temp" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Err "Failed to download ckb-cli: $_"
        Write-Err "Check your internet connection and try again."
        exit 1
    }
    Expand-Archive -Path $zip -DestinationPath "$InstallDir\temp" -Force
    $bin = Get-ChildItem -Path "$InstallDir\temp" -Recurse -Filter ckb-cli.exe | Select-Object -First 1
    if (-not $bin) { Write-Err "Could not extract ckb-cli.exe"; exit 1 }
    Copy-Item $bin.FullName -Destination "$InstallDir\ckb-cli.exe" -Force
    Remove-Item "$InstallDir\temp" -Recurse -Force
    Write-Ok "ckb-cli installed to $InstallDir\ckb-cli.exe"
}

function Install-Fnn {
    New-Item -ItemType Directory -Force -Path $InstallDir\ckb | Out-Null
    if (Test-Path "$InstallDir\fnn.exe") {
        $installedVer = (& "$InstallDir\fnn.exe" --version 2>&1 | Select-Object -First 1) -replace '^fnn\s+', ''
        if ($installedVer -and $installedVer.Trim().StartsWith($FNN_VERSION.TrimStart('v'))) {
            Write-Ok "fnn $FNN_VERSION already installed — skipping download."; return
        }
        Write-Info "fnn version mismatch (have: $($installedVer.Trim()), want: $FNN_VERSION) — re-downloading..."
        # Stop any running node before replacing the binary (avoids file-in-use error)
        $svc = Get-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -ne 'Stopped') {
            Stop-Service 'FiberNetworkNode' -Force -ErrorAction SilentlyContinue
            Start-Sleep 2
            Write-Info "Node service stopped before binary update."
        } elseif (Get-Process -Name fnn -ErrorAction SilentlyContinue) {
            Get-Process -Name fnn | Stop-Process -Force
            Start-Sleep 1
            Write-Info "Running node stopped before binary update."
        }
    }
    Write-Info "Downloading fnn $FNN_VERSION..."
    New-Item -ItemType Directory -Force -Path $InstallDir\temp | Out-Null
    $zip = "$InstallDir\temp\fnn.tar.gz"
    try {
        Invoke-Download -Uri $FnnUrl -OutFile $zip -Label "fnn $FNN_VERSION"
    } catch {
        Remove-Item "$InstallDir\temp" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Err "Failed to download fnn: $_"
        Write-Err "Check your internet connection and try again."
        exit 1
    }
    tar -xzf $zip -C "$InstallDir\temp"
    $bin = Get-ChildItem -Path "$InstallDir\temp" -Recurse -Filter fnn.exe | Select-Object -First 1
    if (-not $bin) { Write-Err "Could not extract fnn.exe"; exit 1 }
    Copy-Item $bin.FullName -Destination "$InstallDir\fnn.exe" -Force
    Remove-Item "$InstallDir\temp" -Recurse -Force
    Write-Ok "fnn installed to $InstallDir\fnn.exe"
}

function Get-BuiltinConfig {
    # Returns the hardcoded fallback config string for the given network.
    # YAML requires forward slashes; key path uses forward slashes throughout.
    param([string]$Net, [string]$KeyPath, [string]$Ip, [string]$Alias)
    if ($Net -eq 'mainnet') {
        return @"
fiber:
  listening_addr: "/ip4/0.0.0.0/tcp/8228"
  bootnode_addrs:
    - "/ip4/43.199.24.44/tcp/8228/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v"
    - "/ip4/54.255.71.126/tcp/8228/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2"
  announce_listening_addr: true
  announced_addrs:
    - "/ip4/$Ip/tcp/8228"
  announced_node_name: "$Alias"
  chain: mainnet
  private_key_path: "$KeyPath"
  scripts:
    - name: FundingLock
      script:
        code_hash: 0xe45b1f8f21bff23137035a3ab751d75b36a981deec3e7820194b9c042967f4f1
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x64818d82a372312fb007c480391e1b9759d21b2c7f7959b9c177d72cdc243394
        - cell_dep:
            out_point:
              tx_hash: 0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: 0x2d45c4d3ed3e942f1945386ee82a5d1b7e4bb16d7fe1ab015421174ab747406c
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0xdb16e6dcb17f670e5fb7c556d81e522ec5edb069ad2fa3e898e7ccea6c26a39f
        - cell_dep:
            out_point:
              tx_hash: 0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6
              index: 0x0
            dep_type: code

rpc:
  listening_addr: "127.0.0.1:8227"

ckb:
  rpc_url: "https://mainnet.ckb.dev/rpc"

services:
  - fiber
  - rpc
  - ckb
"@
    } else {
        return @"
fiber:
  listening_addr: "/ip4/0.0.0.0/tcp/8228"
  bootnode_addrs:
    - "/ip4/54.179.226.154/tcp/8228/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy"
    - "/ip4/16.163.7.105/tcp/8228/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV"
  announce_listening_addr: true
  announced_addrs:
    - "/ip4/$Ip/tcp/8228"
  announced_node_name: "$Alias"
  chain: testnet
  private_key_path: "$KeyPath"
  scripts:
    - name: FundingLock
      script:
        code_hash: 0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6
        - cell_dep:
            out_point:
              tx_hash: 0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7
              index: 0x0
            dep_type: code
    - name: CommitmentLock
      script:
        code_hash: 0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8
        hash_type: type
        args: 0x
      cell_deps:
        - type_id:
            code_hash: 0x00000000000000000000000000000000000000000000000000545950455f4944
            hash_type: type
            args: 0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b
        - cell_dep:
            out_point:
              tx_hash: 0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7
              index: 0x0
            dep_type: code

rpc:
  listening_addr: "127.0.0.1:8227"

ckb:
  rpc_url: "https://testnet.ckbapp.dev/"

services:
  - fiber
  - rpc
  - ckb
"@
    }
}

function Write-Config {
    # Stop any running node before overwriting config — prevents file-lock conflicts on re-run
    if (Get-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue) {
        Stop-Service 'FiberNetworkNode' -Force -ErrorAction SilentlyContinue
        Write-Info "Node service stopped for config update."
    } elseif (Get-Process -Name fnn -ErrorAction SilentlyContinue) {
        Get-Process -Name fnn | Stop-Process -Force
        Start-Sleep 1
        Write-Info "Running node stopped for config update."
    }

    # YAML requires forward slashes (backslashes are escape sequences in YAML strings)
    $keyPath = $InstallDir.Replace('\', '/') + '/ckb/key'
    $configPath = "$InstallDir\config.yml"

    if (Test-Path $configPath) {
        $backupPath = "$configPath.backup.$((Get-Date).ToString('yyyyMMddHHmmss'))"
        Copy-Item $configPath $backupPath
        Write-Ok "Old config backed up to $backupPath"
    }

    # Try to download the versioned official config from nervosnetwork/fiber.
    # Using the exact version tag ensures script hashes match the installed fnn binary.
    $configUrl = "https://raw.githubusercontent.com/nervosnetwork/fiber/$FNN_VERSION/config/$Network/config.yml"
    $downloaded = $false

    Write-Info "Fetching official $Network config for $FNN_VERSION from nervosnetwork/fiber..."
    try {
        $raw = (Invoke-WebRequest -UseBasicParsing -Uri $configUrl -TimeoutSec 15 -ErrorAction Stop).Content
        if ($raw -and $raw.Length -gt 100) {
            # Patch the downloaded config with our settings using regex
            # private_key_path
            $raw = $raw -replace '(?m)(private_key_path:\s*).*', "`${1}`"$keyPath`""
            # announced_node_name - strip ALL existing occurrences line-by-line (avoids
            # duplicates regardless of CRLF/LF or indentation), then insert exactly one
            # after the first listening_addr line in the file.
            $raw = ($raw -split '\r?\n' | Where-Object { $_ -notmatch '^\s*announced_node_name:' }) -join "`n"
            # Insert exactly one announced_node_name after the fiber listening_addr.
            # (?m)^ anchors to line-start so announce_listening_addr: is NOT matched.
            $raw = [regex]::Replace($raw, '(?m)^([ \t]*listening_addr:[^\n]*)',
                "`$1`n  announced_node_name: `"$NodeAlias`"", 1)
            # Safety net: if duplicates still exist, keep only the first occurrence
            $lines = $raw -split '\n'
            $seen = $false
            $raw = ($lines | ForEach-Object {
                if ($_ -match '^\s*announced_node_name:') {
                    if (-not $seen) { $seen = $true; $_ }
                } else { $_ }
            }) -join "`n"
            # announced_addrs - replace whatever value is there with our VPS entry
            $raw = [regex]::Replace($raw,
                '(?s)(\s+announced_addrs:).*?(?=\n\s+\w|\nrpc:)',
                "`$1`n    - `"/ip4/$VpsIp/tcp/8228`"")
            # rpc listening_addr - ensure localhost only
            $raw = [regex]::Replace($raw,
                '(?m)(^rpc:\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+listening_addr:)[ \t]*.*',
                '$1 "127.0.0.1:8227"')
            # ckb rpc_url - replace local CKB node default with public endpoint
            $ckbRpcUrl = if ($Network -eq 'mainnet') { 'https://mainnet.ckb.dev/rpc' } else { 'https://testnet.ckbapp.dev/' }
            $raw = [regex]::Replace($raw,
                '(?m)(^ckb:\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+rpc_url:)[ \t]*.*',
                "`$1 `"$ckbRpcUrl`"")

            [System.IO.File]::WriteAllText($configPath, $raw, [System.Text.Encoding]::UTF8)
            $downloaded = $true
            Write-Ok "Official config downloaded and patched."
        }
    } catch {
        Write-Warn "Could not download official config: $_"
    }

    if (-not $downloaded) {
        Write-Warn "Using built-in defaults."
        $config = Get-BuiltinConfig -Net $Network -KeyPath $keyPath -Ip $VpsIp -Alias $NodeAlias
        $config | Out-File -Encoding utf8 $configPath -Force
    }

    # Whitelist BEAF xUDT token for mainnet nodes
    if ($Network -eq 'mainnet') {
        $raw = [System.IO.File]::ReadAllText($configPath)
        if ($raw -notmatch 'udt_cfg_infos') {
            $beaf = @"
  udt_cfg_infos:
    - name: "BEAF"
      symbol: "BEAF"
      decimal: 0
      auto_accept_channel_ckb_funding_amount: "0x0"
      script:
        code_hash: "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95"
        hash_type: "data1"
        args: "0xc639759e988445217e4c08b2e7b416082d9de0cb061194e2f7f35a89bb6fbf4f"

"@
            $raw = [regex]::Replace($raw, '(?m)^rpc:', "$beaf`nrpc:")
            [System.IO.File]::WriteAllText($configPath, $raw, [System.Text.Encoding]::UTF8)
            Write-Ok "BEAF token whitelisted for UDT payments."
        }
    }

    Write-Ok "Config written to $configPath"
}

function Generate-Wallet {
    $keyExists = Test-Path "$InstallDir\ckb\key"

    if (-not $keyExists) {
        $prevLocation = Get-Location
        Set-Location $InstallDir

        # Check whether ckb-cli already has an account (e.g. from a previous install attempt).
        # If so, skip 'account new' - running it again would fail with "Check password failed"
        # because ckb-cli prompts to unlock the existing keystore first.
        $existingList = (& "$InstallDir\ckb-cli.exe" account list 2>&1) | Out-String
        $existingLock = ([regex]::Match($existingList, 'lock_arg:\s*(0x[0-9a-fA-F]+)')).Groups[1].Value

        if ($existingLock) {
            Write-Info "Existing CKB account found in keystore - skipping account creation."
        } else {
            Write-Info "Generating new CKB account (you will be prompted for a keystore password)..."
            & "$InstallDir\ckb-cli.exe" account new
        }

        # Read back the account details
        $listOutput = (& "$InstallDir\ckb-cli.exe" account list 2>&1) | Out-String
        $lock = ([regex]::Match($listOutput, 'lock_arg:\s*(0x[0-9a-fA-F]+)')).Groups[1].Value
        $addr = if ($Network -eq 'mainnet') {
            ([regex]::Match($listOutput, 'mainnet:\s*(\S+)')).Groups[1].Value
        } else {
            ([regex]::Match($listOutput, 'testnet:\s*(\S+)')).Groups[1].Value
        }

        if (-not $lock) {
            Write-Err "Could not parse lock_arg from account list. Cannot export key."
            Write-Host "Raw output was:" -ForegroundColor DarkGray
            Write-Host $listOutput -ForegroundColor DarkGray
            Set-Location $prevLocation
            exit 1
        }

        # Export with retry — cap at 3 attempts to avoid endless loops on wrong password
        $exported = $false
        $attempts = 0
        do {
            $attempts++
            Write-Info "Exporting private key - enter your keystore password when prompted..."
            if (Test-Path 'ckb\exported-key') { Remove-Item 'ckb\exported-key' -Force }
            & "$InstallDir\ckb-cli.exe" account export --lock-arg $lock --extended-privkey-path ckb\exported-key
            if (Test-Path 'ckb\exported-key') {
                $exported = $true
            } else {
                if ($attempts -ge 3) {
                    Write-Err "Export failed after 3 attempts. Re-run the installer with the correct keystore password."
                    Set-Location $prevLocation
                    exit 1
                }
                Write-Warn "Export failed - wrong keystore password? Please try again ($attempts/3)."
            }
        } until ($exported)

        # ASCII encoding - fnn reads this as a raw hex string; BOM or UTF-16 would corrupt it
        Get-Content 'ckb\exported-key' | Select-Object -First 1 | Set-Content 'ckb\key' -Encoding ascii
        Remove-Item 'ckb\exported-key'
        Set-Location $prevLocation
        Write-Ok "Private key saved to $InstallDir\ckb\key"

        $script:FundingAddress = $addr
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host "  YOUR CKB FUNDING ADDRESS" -ForegroundColor Green
        Write-Host "  $addr" -ForegroundColor Yellow
        Write-Host "============================================================" -ForegroundColor Green
        Write-Host "  Send CKB to this address before opening payment channels." -ForegroundColor Cyan
        if ($Network -eq 'testnet') {
            Write-Host "  Testnet faucet: https://faucet.nervos.org" -ForegroundColor Cyan
        }
        Write-Host ""
    } else {
        Write-Warn "Key already exists - skipping wallet generation."
    }

    # Always collect the node password (needed to write start.ps1)
    Write-Host ""
    if ($keyExists) {
        Write-Host "Enter your existing node password (needed to update start.ps1)." -ForegroundColor Yellow
        Write-Host "IMPORTANT: use the same password you chose during the original install." -ForegroundColor Red
        Write-Host "           Using a different password will prevent the node from starting." -ForegroundColor Red
        $script:NodePassword = Read-MaskedInput "  Node password"
    } else {
        Write-Host "Choose a password to encrypt your node's secret key." -ForegroundColor Yellow
        Write-Host "You will need this every time the node starts. Store it somewhere safe." -ForegroundColor Yellow
        do {
            $plain1 = Read-MaskedInput "  Node password"
            $plain2 = Read-MaskedInput "  Confirm password"
            if ($plain1 -ne $plain2 -or $plain1.Length -eq 0) {
                Write-Warn "Passwords don't match or are empty. Try again."
            }
        } until ($plain1 -eq $plain2 -and $plain1.Length -gt 0)
        $script:NodePassword = $plain1
    }
}

function Uninstall-Node {
    Write-Host "`n==== Fiber Network Node Uninstaller ====" -ForegroundColor Red
    Write-Host ""

    if (-not (Test-Path $InstallDir)) {
        Write-Warn "No installation found at $InstallDir. Nothing to remove."
        exit 0
    }

    Write-Host "This will permanently delete your node installation at:" -ForegroundColor Yellow
    Write-Host "  $InstallDir" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "IMPORTANT: If your wallet contains CKB, transfer it out BEFORE uninstalling." -ForegroundColor Red
    Write-Host "           Private key location: $InstallDir\ckb\key" -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "Type UNINSTALL to confirm, or press Enter to cancel"
    if ($confirm -ne 'UNINSTALL') {
        Write-Info "Uninstall cancelled."
        exit 0
    }

    # Stop and remove NSSM Windows Services if present
    foreach ($svcName in @('FiberNetworkNode', 'FiberDashboard')) {
        $svc = Get-Service $svcName -ErrorAction SilentlyContinue
        if ($svc) {
            Stop-Service $svcName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
            sc.exe delete $svcName | Out-Null
            Write-Ok "Windows Service ($svcName) removed."
        }
    }

    # Kill any lingering dashboard processes (hidden tsx/node process started by start-dashboard.ps1)
    Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
        try { $_.MainModule.FileName -like '*fiber-node*' } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Ok "Dashboard processes stopped."

    # Stop any running fnn process (catches manual start.ps1 instances)
    $procs = Get-Process -Name fnn -ErrorAction SilentlyContinue
    if ($procs) {
        Write-Info "Stopping running fnn process..."
        $procs | Stop-Process -Force
        Start-Sleep -Seconds 2
        Write-Ok "fnn stopped."
    }

    # Remove the scheduled task if present (legacy / fallback installs)
    if (Get-ScheduledTask -TaskName 'FiberNetworkNode' -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName 'FiberNetworkNode' -Confirm:$false
        Write-Ok "Auto-start task removed."
    }

    if (Get-ScheduledTask -TaskName 'FiberNodeUpdate' -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName 'FiberNodeUpdate' -Confirm:$false
        Write-Ok "Auto-update task removed."
    }

    # Remove firewall rules
    netsh advfirewall firewall delete rule name="Fiber p2p"    | Out-Null
    netsh advfirewall firewall delete rule name="Fiber RPC block" | Out-Null
    Write-Ok "Firewall rules removed."

    # Delete the installation directory
    Write-Info "Deleting $InstallDir..."
    Set-Location $env:USERPROFILE
    Remove-Item $InstallDir -Recurse -Force -ErrorAction Stop
    Write-Ok "Installation directory removed."

    Write-Host "`nFiber Network Node has been uninstalled." -ForegroundColor Green
    exit 0
}

function Test-NodeStartup {
    Write-Info "Starting node briefly to verify it works (up to 15 seconds)..."
    $prevLocation = Get-Location
    Set-Location $InstallDir
    $env:FIBER_SECRET_KEY_PASSWORD = $script:NodePassword
    $env:RUST_LOG = 'error'

    $healthLog = "$InstallDir\fnn-healthcheck.log"
    $proc = Start-Process -FilePath "$InstallDir\fnn.exe" `
        -ArgumentList "--config config.yml -d `"$InstallDir`"" `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $healthLog `
        -RedirectStandardError  "$InstallDir\fnn-healthcheck-err.log"

    $alive = $false
    $peerId = ''
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        if ($proc.HasExited) {
            # Merge stderr into the main health log so there's one file to look at
            if (Test-Path "$InstallDir\fnn-healthcheck-err.log") {
                Get-Content "$InstallDir\fnn-healthcheck-err.log" | Add-Content $healthLog
            }
            Write-Warn "Node exited unexpectedly during health check."
            Write-Warn "Last log lines:"
            if (Test-Path $healthLog) {
                Get-Content $healthLog -Tail 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            }
            break
        }
        try {
            $rpc = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8227' `
                -ContentType 'application/json' `
                -Body '{"jsonrpc":"2.0","id":1,"method":"node_info","params":[]}' `
                -TimeoutSec 2 -ErrorAction Stop
            if ($rpc.result) {
                $peerId = $rpc.result.node_id
                $alive = $true
                break
            }
        } catch {}
    }

    if (-not $proc.HasExited) {
        $proc.Kill()
        $proc.WaitForExit(5000) | Out-Null
    }
    Remove-Item "$InstallDir\fnn-healthcheck-err.log" -ErrorAction SilentlyContinue
    Remove-Item $healthLog -ErrorAction SilentlyContinue
    $env:FIBER_SECRET_KEY_PASSWORD = $null
    $env:RUST_LOG = $null
    Set-Location $prevLocation

    if ($alive) {
        Write-Ok "Node health check passed!"
        Write-Ok "Peer ID: $peerId"
    } else {
        Write-Warn "Node did not respond to RPC within 15 seconds."
        Write-Warn "This may be normal on the very first run while the key is being encrypted."
        Write-Warn "Run .\start.ps1 and check fnn.log if the node fails to start."
    }
}

function Register-AutoStart {
    $resp = Read-Host "`nRegister Fiber node as a Windows Service (runs without login, starts on boot)? [Y/n]"
    if ($resp -match '^[Nn]') {
        Write-Info "Skipping auto-start setup. Run start.ps1 manually to launch the node."
        return
    }

    # Try NSSM - installs fnn as a proper Windows Service that starts on boot,
    # even without a user logged in (unlike Task Scheduler AtLogOn triggers).
    $nssmExe = "$InstallDir\nssm.exe"
    $nssmOk  = $false

    if (-not (Test-Path $nssmExe)) {
        Write-Info "Downloading NSSM (Non-Sucking Service Manager)..."
        New-Item -ItemType Directory -Force -Path "$InstallDir\temp" | Out-Null
        $nssmZip = "$InstallDir\temp\nssm.zip"
        try {
            Invoke-Download -Uri $NssmUrl -OutFile $nssmZip -Label "NSSM"
            Expand-Archive -Path $nssmZip -DestinationPath "$InstallDir\temp\nssm" -Force
            # Prefer win64 build; fall back to any nssm.exe in the archive
            $nssmBin = Get-ChildItem -Path "$InstallDir\temp\nssm" -Recurse -Filter 'nssm.exe' |
                Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
            if (-not $nssmBin) {
                $nssmBin = Get-ChildItem -Path "$InstallDir\temp\nssm" -Recurse -Filter 'nssm.exe' |
                    Select-Object -First 1
            }
            if ($nssmBin) {
                Copy-Item $nssmBin.FullName -Destination $nssmExe -Force
                Remove-Item "$InstallDir\temp\nssm" -Recurse -Force -ErrorAction SilentlyContinue
                Write-Ok "NSSM downloaded to $nssmExe"
                $nssmOk = $true
            } else {
                Write-Warn "Could not find nssm.exe in the downloaded archive."
            }
        } catch {
            Write-Warn "Could not download NSSM: $_"
            # nssm.cc is sometimes unavailable — try winget as a fallback
            if (Get-Command winget -ErrorAction SilentlyContinue) {
                Write-Info "Trying winget as fallback for NSSM..."
                try {
                    winget install --id NSSM.NSSM --accept-package-agreements --accept-source-agreements -e | Out-Null
                    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                                [System.Environment]::GetEnvironmentVariable('PATH', 'User')
                    $wingetNssm = Get-Command nssm -ErrorAction SilentlyContinue
                    if ($wingetNssm) {
                        Copy-Item $wingetNssm.Source -Destination $nssmExe -Force
                        Write-Ok "NSSM installed via winget."
                        $nssmOk = $true
                    }
                } catch {
                    Write-Warn "winget fallback also failed: $_"
                }
            }
        }
    } else {
        Write-Ok "NSSM already present at $nssmExe"
        $nssmOk = $true
    }

    if ($nssmOk) {
        # Remove stale scheduled task if upgrading from an old install
        if (Get-ScheduledTask -TaskName 'FiberNetworkNode' -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName 'FiberNetworkNode' -Confirm:$false
            Write-Info "Removed old scheduled task."
        }
        # Stop and remove any previous NSSM service instance
        & $nssmExe stop   'FiberNetworkNode' 2>$null
        & $nssmExe remove 'FiberNetworkNode' confirm 2>$null

        # Install the service
        & $nssmExe install 'FiberNetworkNode' "$InstallDir\fnn.exe" | Out-Null
        & $nssmExe set 'FiberNetworkNode' AppParameters    "--config `"$InstallDir\config.yml`" -d `"$InstallDir`"" | Out-Null
        & $nssmExe set 'FiberNetworkNode' AppDirectory     "$InstallDir" | Out-Null
        & $nssmExe set 'FiberNetworkNode' AppEnvironmentExtra `
            "FIBER_SECRET_KEY_PASSWORD=$($script:NodePassword)" "RUST_LOG=info" | Out-Null
        & $nssmExe set 'FiberNetworkNode' Start            SERVICE_AUTO_START | Out-Null
        & $nssmExe set 'FiberNetworkNode' AppStdout        "$InstallDir\fnn.log" | Out-Null
        & $nssmExe set 'FiberNetworkNode' AppStderr        "$InstallDir\fnn-err.log" | Out-Null
        & $nssmExe set 'FiberNetworkNode' AppRotateFiles   1 | Out-Null
        & $nssmExe set 'FiberNetworkNode' AppRotateBytes   10485760 | Out-Null  # 10 MB

        Start-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue
        $svc = Get-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq 'Running') {
            Write-Ok "Fiber node installed as Windows Service (FiberNetworkNode) - starts on boot, no login required."
        } else {
            Write-Warn "Service installed but may not be running yet."
            Write-Info "Check with: Get-Service FiberNetworkNode"
            Write-Info "Logs: $InstallDir\fnn.log and fnn-err.log"
        }
        Write-Info "Manage with: nssm start/stop/restart FiberNetworkNode  (or sc.exe / Services snap-in)"

        # Also register the dashboard as an NSSM service if installed
        if ($script:DashboardInstalled) {
            $dashApp = "$InstallDir\dashboard\fiber-dashboard"
            $tsxPath = "$dashApp\node_modules\.bin\tsx.cmd"
            if (Test-Path $tsxPath) {
                if (Get-ScheduledTask -TaskName 'FiberDashboard' -ErrorAction SilentlyContinue) {
                    Unregister-ScheduledTask -TaskName 'FiberDashboard' -Confirm:$false | Out-Null
                }
                & $nssmExe stop   'FiberDashboard' 2>$null
                & $nssmExe remove 'FiberDashboard' confirm 2>$null
                & $nssmExe install 'FiberDashboard' "${PS}.exe" | Out-Null
                & $nssmExe set 'FiberDashboard' AppParameters "-ExecutionPolicy Bypass -File `"$InstallDir\start-dashboard.ps1`"" | Out-Null
                & $nssmExe set 'FiberDashboard' AppDirectory  "$InstallDir" | Out-Null
                & $nssmExe set 'FiberDashboard' Start         SERVICE_AUTO_START | Out-Null
                & $nssmExe set 'FiberDashboard' AppStdout     "$InstallDir\dashboard.log" | Out-Null
                & $nssmExe set 'FiberDashboard' AppStderr     "$InstallDir\dashboard-err.log" | Out-Null
                Write-Ok "Dashboard registered as Windows Service (FiberDashboard) - starts on boot."
            }
        }
    } else {
        # Fallback: Task Scheduler (requires user to be logged in)
        Write-Warn "NSSM unavailable - falling back to Task Scheduler (node starts only when you log in)."
        try {
            $action = New-ScheduledTaskAction `
                -Execute "${PS}.exe" `
                -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\start.ps1`""
            $trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
            $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
                -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
            $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest
            Register-ScheduledTask -TaskName 'FiberNetworkNode' `
                -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
            Write-Ok "Auto-start registered via Task Scheduler."
        } catch {
            Write-Warn "Could not register auto-start task: $_"
            Write-Info "You can start the node manually: cd $InstallDir && .\start.ps1"
        }
    }
}

function Install-Dashboard {
    # Dashboard source: prefer a fiber-dashboard\ folder next to this installer.
    # If not present, download it automatically from GitHub.
    $dashboardOuter = "$PSScriptRoot\fiber-dashboard"
    $dashboardInner = "$dashboardOuter\fiber-dashboard"

    if (-not (Test-Path "$dashboardInner\package.json")) {
        Write-Info "Dashboard source not found locally — downloading from GitHub..."
        $zipUrl  = "https://github.com/tecmeup123/fiber-node-installer/archive/refs/heads/master.zip"
        $zipTemp = "$env:TEMP\fiber-installer-master.zip"
        $extTemp = "$env:TEMP\fiber-installer-master"
        try {
            Invoke-WebRequest -Uri $zipUrl -OutFile $zipTemp -UseBasicParsing
            if (Test-Path $extTemp) { Remove-Item $extTemp -Recurse -Force }
            Expand-Archive -Path $zipTemp -DestinationPath $extTemp -Force
            $dashboardOuter = "$extTemp\fiber-node-installer-master\fiber-dashboard"
            $dashboardInner = "$dashboardOuter\fiber-dashboard"
            if (-not (Test-Path "$dashboardInner\package.json")) {
                Write-Warn "Downloaded archive did not contain expected dashboard files. Skipping dashboard."
                return
            }
            Write-Ok "Dashboard source downloaded."
        } catch {
            Write-Warn "Could not download dashboard source: $_"
            return
        }
    }

    $resp = Read-Host "`nInstall the Fiber Dashboard web UI? [Y/n]"
    if ($resp -match '^[Nn]') {
        Write-Info "Dashboard skipped. Re-run the installer to add it later."
        return
    }

    # Check for Node.js
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Info "Node.js not found. Attempting to install via winget..."
        try {
            winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements -e | Out-Null
            # Refresh PATH so node is immediately available
            $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                        [System.Environment]::GetEnvironmentVariable('PATH', 'User')
            Write-Ok "Node.js installed: $(node --version)"
        } catch {
            Write-Warn "Could not install Node.js automatically: $_"
            Write-Warn "Install Node.js LTS from https://nodejs.org then re-run the installer."
            return
        }
    } else {
        Write-Ok "Node.js: $(node --version)"
    }

    $dashDest = "$InstallDir\dashboard"

    if (Test-Path $dashDest) {
        Write-Warn "Dashboard already installed at $dashDest"
        if ((Read-Host "Reinstall it? [Y/n]") -match '^[Nn]') {
            Write-Info "Keeping existing dashboard."
        } else {
            Remove-Item $dashDest -Recurse -Force
        }
    }

    if (-not (Test-Path $dashDest)) {
        Write-Info "Copying dashboard files to $dashDest..."
        Copy-Item -Recurse -Path $dashboardOuter -Destination $dashDest
        Write-Ok "Dashboard files copied."
    }

    $dashApp = "$dashDest\fiber-dashboard"
    $prevLoc = Get-Location
    Set-Location $dashApp

    Write-Info "Installing npm dependencies (this may take a minute)..."
    $env:npm_config_loglevel  = 'silent'
    $env:npm_config_progress  = 'false'
    npm install 2>&1 | Out-Null
    Write-Ok "npm dependencies installed."

    Write-Info "Building dashboard frontend..."
    npm run build 2>&1 | Out-Null
    Write-Ok "Dashboard frontend built."
    Remove-Item Env:npm_config_loglevel -ErrorAction SilentlyContinue
    Remove-Item Env:npm_config_progress -ErrorAction SilentlyContinue

    Set-Location $prevLoc

    # tsx.cmd is installed as a devDependency in node_modules\.bin
    $tsxPath = "$dashApp\node_modules\.bin\tsx.cmd"

    # Block the dashboard port at the firewall - dashboard has no authentication.
    # Port 3333 is used because port 3001 is commonly reserved by Windows (WSL2/Hyper-V).
    netsh advfirewall firewall delete rule name="Fiber Dashboard block" | Out-Null
    netsh advfirewall firewall add rule name="Fiber Dashboard block" dir=in action=block protocol=TCP localport=3333 | Out-Null
    Write-Ok "Firewall: port 3333 blocked from external access."

    # Write start-dashboard.ps1
    # BIND_HOST=0.0.0.0 is required on Windows - 127.0.0.1 binding causes EACCES
    # on ports that Windows reserves for Hyper-V/WSL2. The firewall rule above blocks
    # external access, so 0.0.0.0 is safe here.
    @"
`$env:FIBER_RPC_URL = 'http://localhost:8227'
`$env:PORT         = '3333'
`$env:BIND_HOST    = '0.0.0.0'
`$env:NODE_ENV     = 'production'
`$env:CKB_CLI_PATH = '$InstallDir\ckb-cli.exe'
Set-Location '$dashApp'
& '$tsxPath' server/index.ts
"@ | Out-File -Encoding utf8 "$InstallDir\start-dashboard.ps1" -Force
    Write-Ok "start-dashboard.ps1 written to $InstallDir\start-dashboard.ps1"

    # Register scheduled task for auto-start
    $autoResp = Read-Host "Start the dashboard automatically when Windows logs in? [Y/n]"
    if ($autoResp -notmatch '^[Nn]') {
        try {
            $action = New-ScheduledTaskAction `
                -Execute "${PS}.exe" `
                -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\start-dashboard.ps1`""
            $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
            $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable
            $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest
            Register-ScheduledTask -TaskName 'FiberDashboard' `
                -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
            Write-Ok "Dashboard auto-start registered."
        } catch {
            Write-Warn "Could not register dashboard auto-start: $_"
        }
    }

    $script:DashboardInstalled = $true
    Write-Host ""
    Write-Ok "Dashboard installed!"
    Write-Host "  Access:   http://localhost:3333" -ForegroundColor Cyan
    Write-Host "  Start:    cd $InstallDir" -ForegroundColor Cyan
    Write-Host "            .\start-dashboard.ps1" -ForegroundColor Cyan
    Write-Host ""
    Write-Warn "The dashboard has NO login protection. Port 3333 is blocked by the firewall."
}

function Install-AutoUpdater {
    $resp = Read-Host "`nEnable weekly auto-update for fnn? (the node restarts briefly when a new release is found) [Y/n]"
    if ($resp -match '^[Nn]') {
        Write-Info "Auto-update skipped. Run .\update.ps1 manually, or re-run the installer to enable it."
        return
    }

    # Write update.ps1 to the install directory.
    # Dollar signs for the update script are escaped with backtick so they survive the
    # installer's here-string unexpanded; $InstallDir is intentionally expanded so the
    # real install path is baked into the generated script.
    @"
# Fiber Network Node auto-updater
# Generated by install-fiber.ps1 - do not edit manually.

`$InstallDir = '$InstallDir'
`$LogFile    = "`$InstallDir\update.log"

function Log {
    param(`$msg)
    `$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path `$LogFile -Value "[`$ts] `$msg"
    Write-Host "  `$msg"
}

Log "Checking for fnn update..."

try {
    `$release = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/nervosnetwork/fiber/releases/latest' -TimeoutSec 15
    `$latest  = `$release.tag_name
} catch {
    Log "ERROR: Could not fetch release info: `$_"
    exit 1
}

`$verOut  = (& "`$InstallDir\fnn.exe" --version 2>&1) | Out-String
`$current = if (`$verOut -match '(v\d+\.\d+\.\d+)') { `$matches[1] } else { 'unknown' }

Log "Current: `$current  |  Latest: `$latest"

if (`$current -eq `$latest) {
    Log "Already up to date - nothing to do."
    exit 0
}

Log "New version available: `$current -> `$latest"

`$tmpDir  = "`$InstallDir\update-tmp"
`$archive = "`$tmpDir\fnn.tar.gz"
New-Item -ItemType Directory -Force -Path `$tmpDir | Out-Null

`$url = "https://github.com/nervosnetwork/fiber/releases/download/`${latest}/fnn_`${latest}-x86_64-windows.tar.gz"
Log "Downloading `$url ..."

try {
    Invoke-WebRequest -UseBasicParsing -Uri `$url -OutFile `$archive -TimeoutSec 300
} catch {
    Log "ERROR: Download failed: `$_"
    Remove-Item `$tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# Stop the service before swapping the binary
`$svc = Get-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue
if (`$svc) {
    Log "Stopping FiberNetworkNode service..."
    Stop-Service 'FiberNetworkNode' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
} else {
    `$proc = Get-Process -Name fnn -ErrorAction SilentlyContinue
    if (`$proc) { `$proc | Stop-Process -Force; Start-Sleep -Seconds 3 }
}

# Extract and replace the binary
tar -xzf `$archive -C `$tmpDir 2>`$null
`$newBin = Get-ChildItem -Path `$tmpDir -Recurse -Filter fnn.exe | Select-Object -First 1
if (-not `$newBin) {
    Log "ERROR: fnn.exe not found in the downloaded archive."
    Remove-Item `$tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    if (`$svc) { Start-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue }
    exit 1
}

Copy-Item `$newBin.FullName -Destination "`$InstallDir\fnn.exe" -Force
Remove-Item `$tmpDir -Recurse -Force
Log "Binary replaced with `$latest"

# Restart the service
if (`$svc) {
    Start-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
    `$svc = Get-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue
    `$svcStatus = `$svc.Status
    if (`$svcStatus -eq 'Running') {
        Log "Service restarted OK."
    } else {
        Log "WARNING: Service is `$svcStatus - check fnn.log and fnn-err.log."
    }
} else {
    Log "No Windows Service found - start fnn manually via start.ps1."
}

Log "Done: fnn updated to `$latest"
"@ | Out-File -Encoding utf8 "$InstallDir\update.ps1" -Force
    Write-Ok "update.ps1 written to $InstallDir\update.ps1"

    # Register a weekly Task Scheduler job
    try {
        $action    = New-ScheduledTaskAction `
            -Execute "${PS}.exe" `
            -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$InstallDir\update.ps1`""
        $trigger   = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At '03:00AM'
        $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest
        Register-ScheduledTask -TaskName 'FiberNodeUpdate' `
            -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
        Write-Ok "Auto-update scheduled - runs every Sunday at 3:00 AM."
        Write-Info "To update manually: $PS -ExecutionPolicy Bypass -File `"$InstallDir\update.ps1`""
        Write-Info "Update log: $InstallDir\update.log"
    } catch {
        Write-Warn "Could not register auto-update task: $_"
        Write-Info "update.ps1 written - run it manually to update fnn."
    }
}

# main flow
Invoke-ElevationCheck
if ($Uninstall) { Uninstall-Node }

Show-Step 'Pre-flight checks';   Preflight
Show-Step 'Network selection';   Select-Network
Show-Step 'Node configuration';  Get-NodeConfig
Show-Step 'Firewall setup';      Setup-Firewall
Show-Step 'Installing ckb-cli';  Install-CkbCli
Show-Step 'Installing fnn';      Install-Fnn
Show-Step 'Writing config';      Write-Config
Show-Step 'Generating wallet';   Generate-Wallet

Set-Location $InstallDir

# Generate start.ps1 - use single-quoted PS string for password so $, `, ", \ are all safe.
# Only single quotes need escaping in single-quoted PS strings (doubled: '').
$escapedPw = $script:NodePassword.Replace("'", "''")
@"
Set-Location "$InstallDir"
`$env:FIBER_SECRET_KEY_PASSWORD = '$escapedPw'
`$env:RUST_LOG = "info"
.\fnn.exe --config config.yml -d $InstallDir 2>&1 | Tee-Object -FilePath fnn.log
"@ | Out-File -Encoding utf8 "$InstallDir\start.ps1" -Force
Write-Ok "start.ps1 written to $InstallDir\start.ps1"

# Generate self-contained uninstall.ps1 (does not depend on installer being present)
@"
`$InstallDir = '$InstallDir'

# Auto-elevate if not already running as Administrator
`$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not `$isAdmin) {
    Start-Process $PS -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File ``"`$PSCommandPath``""
    exit
}

# If running from inside the install dir, the process holds a lock on the folder.
# Copy self to TEMP and re-launch from there so the folder can be deleted.
if (`$PSCommandPath -like "`$InstallDir*") {
    `$tmp = "`$env:TEMP\uninstall-fiber.ps1"
    Copy-Item `$PSCommandPath `$tmp -Force
    Start-Process $PS -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File ``"`$tmp``""
    exit
}

Write-Host "`n==== Fiber Network Node Uninstaller ====" -ForegroundColor Red
Write-Host ""
Write-Host "This will permanently delete your node at: `$InstallDir" -ForegroundColor Yellow
Write-Host ""
Write-Host "IMPORTANT: If your wallet has CKB, transfer it out BEFORE uninstalling." -ForegroundColor Red
Write-Host "           Private key: `$InstallDir\ckb\key" -ForegroundColor Red
Write-Host ""
`$confirm = Read-Host "Type UNINSTALL to confirm, or press Enter to cancel"
if (`$confirm -ne 'UNINSTALL') { Write-Host "Cancelled."; exit 0 }

foreach (`$svcName in @('FiberNetworkNode', 'FiberDashboard')) {
    `$svc = Get-Service `$svcName -ErrorAction SilentlyContinue
    if (`$svc) {
        Stop-Service `$svcName -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
        sc.exe delete `$svcName | Out-Null
        Write-Host "Windows Service (`$svcName) removed."
    }
}

`$procs = Get-Process -Name fnn -ErrorAction SilentlyContinue
if (`$procs) { Write-Host "Stopping fnn..."; `$procs | Stop-Process -Force; Start-Sleep 2 }

Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    try { `$_.MainModule.FileName -like '*fiber-node*' } catch { `$false }
} | Stop-Process -Force -ErrorAction SilentlyContinue

foreach (`$task in @('FiberNetworkNode', 'FiberDashboard', 'FiberNodeUpdate')) {
    if (Get-ScheduledTask -TaskName `$task -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName `$task -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName `$task -Confirm:`$false
        Write-Host "Scheduled task (`$task) removed."
    }
}

netsh advfirewall firewall delete rule name="Fiber p2p"           | Out-Null
netsh advfirewall firewall delete rule name="Fiber RPC block"     | Out-Null
netsh advfirewall firewall delete rule name="Fiber Dashboard block" | Out-Null
Write-Host "Firewall rules removed."

Set-Location `$env:USERPROFILE
Remove-Item `$InstallDir -Recurse -Force -ErrorAction Stop
Write-Host "`nFiber Network Node uninstalled." -ForegroundColor Green
"@ | Out-File -Encoding utf8 "$InstallDir\uninstall.ps1" -Force
Write-Ok "uninstall.ps1 written to $InstallDir\uninstall.ps1"

Show-Step 'Node health check';   Test-NodeStartup
Show-Step 'Dashboard (optional)'; Install-Dashboard

Register-AutoStart
Install-AutoUpdater

Write-Host "`nInstallation complete!" -ForegroundColor Green
Write-Host ""
if ($script:FundingAddress) {
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  Remember to fund your CKB address:" -ForegroundColor Green
    Write-Host "  $script:FundingAddress" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
}
Write-Host "  Terminal 1 — start the node:" -ForegroundColor Yellow
Write-Host "    cd $InstallDir" -ForegroundColor Cyan
Write-Host "    .\start.ps1" -ForegroundColor Cyan
Write-Host ""
if ($script:DashboardInstalled -or (Test-Path "$InstallDir\start-dashboard.ps1")) {
    Write-Host "  Terminal 2 — start the dashboard:" -ForegroundColor Yellow
    Write-Host "    cd $InstallDir" -ForegroundColor Cyan
    Write-Host "    .\start-dashboard.ps1" -ForegroundColor Cyan
    Write-Host "    Then open http://localhost:3333 in your browser." -ForegroundColor Cyan
    Write-Host ""
}
Write-Warn "start.ps1 contains your password - keep it private and do not share it."
