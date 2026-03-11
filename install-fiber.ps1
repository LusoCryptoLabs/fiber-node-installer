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

# constants
$FNN_VERSION       = 'v0.7.1'
$CKB_CLI_VERSION   = 'v1.9.0'

$FnnUrl    = "https://github.com/nervosnetwork/fiber/releases/download/$FNN_VERSION/fnn_${FNN_VERSION}-x86_64-windows.tar.gz"
$CkbCliUrl = "https://github.com/nervosnetwork/ckb-cli/releases/download/$CKB_CLI_VERSION/ckb-cli_${CKB_CLI_VERSION}_x86_64-pc-windows-msvc.zip"
$NssmUrl   = "https://nssm.cc/release/nssm-2.24.zip"

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

$script:StepTotal = 10
$script:StepCurrent = 0
function Show-Step {
    param([string]$Name)
    $script:StepCurrent++
    Write-Progress -Id 1 -Activity 'Fiber Node Setup' `
        -Status "Step $script:StepCurrent of $script:StepTotal  —  $Name" `
        -PercentComplete ([int]($script:StepCurrent / $script:StepTotal * 100))
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
        while (($read = $stream.Read($buf, 0, $buf.Length)) -gt 0) {
            $out.Write($buf, 0, $read)
            $downloaded += $read
            if ($total -gt 0) {
                Write-Progress -Id 2 -ParentId 1 -Activity "Downloading $Label" `
                    -Status "$([math]::Round($downloaded/1MB,1)) MB / $([math]::Round($total/1MB,1)) MB" `
                    -PercentComplete ([int]($downloaded * 100 / $total))
            }
        }
    } finally {
        if ($out)    { $out.Dispose() }
        if ($stream) { $stream.Dispose() }
        $client.Dispose()
    }
    Write-Progress -Id 2 -Activity "Downloading $Label" -Completed
}

function Invoke-ElevationCheck {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "This installer needs Administrator privileges to configure the firewall." -ForegroundColor Yellow
        Write-Host "Re-launching as Administrator..." -ForegroundColor Yellow
        # Build a single quoted argument string so paths with spaces are handled correctly.
        $uninstallFlag = if ($Uninstall) { ' -Uninstall' } else { '' }
        Start-Process PowerShell -Verb RunAs `
            -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`"$uninstallFlag"
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

    # tar is required to extract fnn — present on Windows 10 1803+ by default
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
    $resp = Read-Host "Choose a name for your node (visible on the network) [$NodeAlias]"
    if ($resp) {
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
        Write-Ok "ckb-cli already installed"; return
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
        Write-Ok "fnn already present"; return
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
  node_name: "$Alias"
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
  node_name: "$Alias"
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
            # node_name — replace if present, otherwise insert after the first listening_addr
            if ($raw -match '(?m)^\s+node_name:') {
                $raw = $raw -replace '(?m)(^\s+node_name:\s*).*', "`${1}`"$NodeAlias`""
            } else {
                $raw = $raw -replace '(?m)(^\s+listening_addr:.*)', "`$1`n  node_name: `"$NodeAlias`""
            }
            # announced_addrs — replace whatever value is there with our VPS entry
            $raw = [regex]::Replace($raw,
                '(?s)(\s+announced_addrs:).*?(?=\n\s+\w|\nrpc:)',
                "`$1`n    - `"/ip4/$VpsIp/tcp/8228`"")
            # rpc listening_addr — ensure localhost only
            $raw = [regex]::Replace($raw,
                '(?m)(^rpc:\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+listening_addr:)[ \t]*.*',
                '$1 "127.0.0.1:8227"')

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

    Write-Ok "Config written to $configPath"
}

function Generate-Wallet {
    $keyExists = Test-Path "$InstallDir\ckb\key"

    if (-not $keyExists) {
        $prevLocation = Get-Location
        Set-Location $InstallDir

        # Check whether ckb-cli already has an account (e.g. from a previous install attempt).
        # If so, skip 'account new' — running it again would fail with "Check password failed"
        # because ckb-cli prompts to unlock the existing keystore first.
        $existingList = (& "$InstallDir\ckb-cli.exe" account list 2>&1) | Out-String
        $existingLock = ([regex]::Match($existingList, 'lock_arg:\s*(0x[0-9a-fA-F]+)')).Groups[1].Value

        if ($existingLock) {
            Write-Info "Existing CKB account found in keystore — skipping account creation."
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

        # Export with retry — wrong keystore password is recoverable, don't bail
        $exported = $false
        do {
            Write-Info "Exporting private key — enter your keystore password when prompted..."
            if (Test-Path 'ckb\exported-key') { Remove-Item 'ckb\exported-key' -Force }
            & "$InstallDir\ckb-cli.exe" account export --lock-arg $lock --extended-privkey-path ckb\exported-key
            if (Test-Path 'ckb\exported-key') {
                $exported = $true
            } else {
                Write-Warn "Export failed — wrong keystore password? Please try again."
            }
        } until ($exported)

        # ASCII encoding — fnn reads this as a raw hex string; BOM or UTF-16 would corrupt it
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
        Write-Warn "Key already exists — skipping wallet generation."
    }

    # Always collect the node password (needed to write start.ps1)
    Write-Host ""
    if ($keyExists) {
        Write-Host "Enter your existing node password (needed to update start.ps1)." -ForegroundColor Yellow
        Write-Host "IMPORTANT: use the same password you chose during the original install." -ForegroundColor Red
        Write-Host "           Using a different password will prevent the node from starting." -ForegroundColor Red
        $p1 = Read-Host "  Node password" -AsSecureString
        $script:NodePassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
    } else {
        Write-Host "Choose a password to encrypt your node's secret key." -ForegroundColor Yellow
        Write-Host "You will need this every time the node starts. Store it somewhere safe." -ForegroundColor Yellow
        do {
            $p1 = Read-Host "  Node password" -AsSecureString
            $p2 = Read-Host "  Confirm password" -AsSecureString
            $plain1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
            $plain2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
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

    # Stop and remove NSSM Windows Service if present
    $svc = Get-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue
    if ($svc) {
        Stop-Service 'FiberNetworkNode' -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        sc.exe delete FiberNetworkNode | Out-Null
        Write-Ok "Windows Service (FiberNetworkNode) removed."
    }

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

    # Remove firewall rules
    netsh advfirewall firewall delete rule name="Fiber p2p"    | Out-Null
    netsh advfirewall firewall delete rule name="Fiber RPC block" | Out-Null
    Write-Ok "Firewall rules removed."

    # Delete the installation directory
    Write-Info "Deleting $InstallDir..."
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

    # Try NSSM — installs fnn as a proper Windows Service that starts on boot,
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
            Write-Ok "Fiber node installed as Windows Service (FiberNetworkNode) — starts on boot, no login required."
        } else {
            Write-Warn "Service installed but may not be running yet."
            Write-Info "Check with: Get-Service FiberNetworkNode"
            Write-Info "Logs: $InstallDir\fnn.log and fnn-err.log"
        }
        Write-Info "Manage with: nssm start/stop/restart FiberNetworkNode  (or sc.exe / Services snap-in)"
    } else {
        # Fallback: Task Scheduler (requires user to be logged in)
        Write-Warn "NSSM unavailable — falling back to Task Scheduler (node starts only when you log in)."
        try {
            $action = New-ScheduledTaskAction `
                -Execute 'PowerShell.exe' `
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
    # Dashboard source is expected in a fiber-dashboard\ folder next to this installer.
    # The outer folder contains ckb-fiber\ (RPC client) and fiber-dashboard\ (the app).
    $dashboardOuter = "$PSScriptRoot\fiber-dashboard"
    $dashboardInner = "$dashboardOuter\fiber-dashboard"

    if (-not (Test-Path "$dashboardInner\package.json")) {
        Write-Warn "Dashboard source not found at $dashboardOuter"
        Write-Info "Copy the fiber-dashboard\ folder next to this installer, then re-run."
        return
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
    npm install 2>&1 | Select-Object -Last 5 | ForEach-Object { Write-Host "  $_" }

    Write-Info "Building dashboard frontend..."
    npm run build 2>&1 | Select-Object -Last 5 | ForEach-Object { Write-Host "  $_" }

    Set-Location $prevLoc
    Write-Ok "Dashboard built."

    # tsx.cmd is installed as a devDependency in node_modules\.bin
    $tsxPath = "$dashApp\node_modules\.bin\tsx.cmd"

    # Block the dashboard port at the firewall — dashboard has no authentication.
    # Port 3333 is used because port 3001 is commonly reserved by Windows (WSL2/Hyper-V).
    netsh advfirewall firewall delete rule name="Fiber Dashboard block" | Out-Null
    netsh advfirewall firewall add rule name="Fiber Dashboard block" dir=in action=block protocol=TCP localport=3333 | Out-Null
    Write-Ok "Firewall: port 3333 blocked from external access."

    # Write start-dashboard.ps1
    # BIND_HOST=0.0.0.0 is required on Windows — 127.0.0.1 binding causes EACCES
    # on ports that Windows reserves for Hyper-V/WSL2. The firewall rule above blocks
    # external access, so 0.0.0.0 is safe here.
    @"
`$env:FIBER_RPC_URL = 'http://localhost:8227'
`$env:PORT         = '3333'
`$env:BIND_HOST    = '0.0.0.0'
`$env:NODE_ENV     = 'production'
Set-Location '$dashApp'
& '$tsxPath' server/index.ts
"@ | Out-File -Encoding utf8 "$InstallDir\start-dashboard.ps1" -Force
    Write-Ok "start-dashboard.ps1 written to $InstallDir\start-dashboard.ps1"

    # Register scheduled task for auto-start
    $autoResp = Read-Host "Start the dashboard automatically when Windows logs in? [Y/n]"
    if ($autoResp -notmatch '^[Nn]') {
        try {
            $action = New-ScheduledTaskAction `
                -Execute 'PowerShell.exe' `
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

# Generate start.ps1 — use single-quoted PS string for password so $, `, ", \ are all safe.
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
    Start-Process PowerShell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File ``"`$PSCommandPath``""
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

`$svc = Get-Service 'FiberNetworkNode' -ErrorAction SilentlyContinue
if (`$svc) {
    Stop-Service 'FiberNetworkNode' -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    sc.exe delete FiberNetworkNode | Out-Null
    Write-Host "Windows Service (FiberNetworkNode) removed."
}

`$procs = Get-Process -Name fnn -ErrorAction SilentlyContinue
if (`$procs) { Write-Host "Stopping fnn..."; `$procs | Stop-Process -Force; Start-Sleep 2 }

if (Get-ScheduledTask -TaskName 'FiberNetworkNode' -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName 'FiberNetworkNode' -Confirm:`$false
    Write-Host "Node auto-start task removed."
}

if (Get-ScheduledTask -TaskName 'FiberDashboard' -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName 'FiberDashboard' -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'FiberDashboard' -Confirm:`$false
    Write-Host "Dashboard auto-start task removed."
}

netsh advfirewall firewall delete rule name="Fiber p2p"           | Out-Null
netsh advfirewall firewall delete rule name="Fiber RPC block"     | Out-Null
netsh advfirewall firewall delete rule name="Fiber Dashboard block" | Out-Null
Write-Host "Firewall rules removed."

Remove-Item `$InstallDir -Recurse -Force -ErrorAction Stop
Write-Host "`nFiber Network Node uninstalled." -ForegroundColor Green
"@ | Out-File -Encoding utf8 "$InstallDir\uninstall.ps1" -Force
Write-Ok "uninstall.ps1 written to $InstallDir\uninstall.ps1"

Show-Step 'Node health check';   Test-NodeStartup
Show-Step 'Dashboard (optional)'; Install-Dashboard
Write-Progress -Id 1 -Activity 'Fiber Node Setup' -Completed

Register-AutoStart

Write-Host "`nInstallation complete!" -ForegroundColor Green
Write-Host ""
if ($script:FundingAddress) {
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  Remember to fund your CKB address:" -ForegroundColor Green
    Write-Host "  $script:FundingAddress" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
}
Write-Host "To start your Fiber node:" -ForegroundColor Yellow
Write-Host "  cd $InstallDir" -ForegroundColor Cyan
Write-Host "  .\start.ps1" -ForegroundColor Cyan
Write-Host ""
if ($script:DashboardInstalled) {
    Write-Host "To start the dashboard:" -ForegroundColor Yellow
    Write-Host "  cd $InstallDir" -ForegroundColor Cyan
    Write-Host "  .\start-dashboard.ps1" -ForegroundColor Cyan
    Write-Host "  Then open http://localhost:3333 in your browser." -ForegroundColor Cyan
    Write-Host ""
}
Write-Warn "start.ps1 contains your password — keep it private and do not share it."
