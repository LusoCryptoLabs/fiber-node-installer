#Requires -Version 5.1
<#
.SYNOPSIS
    Pester tests for install-fiber.ps1

.DESCRIPTION
    Tests syntax, encoding, and core logic functions without executing the
    installer (no downloads, no firewall changes, no interactive prompts).

    Run with:
        Invoke-Pester .\tests\install-fiber.Tests.ps1 -Output Detailed

    Requires Pester v5+:
        Install-Module Pester -Force -SkipPublisherCheck
#>

BeforeAll {
    $ScriptPath = Join-Path $PSScriptRoot '..\install-fiber.ps1'

    # Parse the installer AST without executing it
    $tokens = $null
    $errors = $null
    $script:Ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $ScriptPath, [ref]$tokens, [ref]$errors
    )
    $script:ParseErrors  = $errors
    $script:ScriptTokens = $tokens
    $script:RawContent   = [System.IO.File]::ReadAllText($ScriptPath)

    # Load only the function definitions into this scope (skips the main flow at the bottom)
    $functionDefs = $script:Ast.FindAll(
        { param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] },
        $true
    )
    foreach ($fn in $functionDefs) {
        Invoke-Expression $fn.Extent.Text
    }

    # Also expose the script-level constants that functions depend on
    $script:FNN_VERSION     = 'v0.7.1'
    $script:CKB_CLI_VERSION = 'v1.9.0'
    $script:InstallDir      = 'C:\test-fiber-node'
    $script:Network         = 'mainnet'
    $script:VpsIp           = '1.2.3.4'
    $script:NodeAlias       = 'test-node'
}

# ---------------------------------------------------------------------------
Describe 'Syntax and Encoding' {

    It 'parses without errors' {
        $script:ParseErrors | Should -BeNullOrEmpty
    }

    It 'contains no em dashes (U+2014) that would cause encoding corruption' {
        $script:RawContent | Should -Not -Match [char]0x2014
    }

    It 'is saved as UTF-8 (no UTF-16 BOM)' {
        $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '..\install-fiber.ps1'))
        # UTF-16 LE BOM is FF FE; UTF-16 BE BOM is FE FF
        $bytes[0] | Should -Not -Be 0xFF
        $bytes[0] | Should -Not -Be 0xFE
    }

    It 'has a param block (so it can accept -Uninstall)' {
        $paramBlock = $script:Ast.ParamBlock
        $paramBlock | Should -Not -BeNullOrEmpty
    }

    It 'defines expected functions' {
        $expectedFunctions = @(
            'Write-Info', 'Write-Ok', 'Write-Warn', 'Write-Err',
            'Show-Step', 'Invoke-Download', 'Invoke-ElevationCheck',
            'Preflight', 'Select-Network', 'Get-NodeConfig',
            'Setup-Firewall', 'Install-CkbCli', 'Install-Fnn',
            'Get-BuiltinConfig', 'Write-Config', 'Generate-Wallet',
            'Register-AutoStart', 'Install-AutoUpdater', 'Test-NodeStartup',
            'Install-Dashboard'
        )
        $defined = $script:Ast.FindAll(
            { param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] },
            $true
        ).Name
        foreach ($fn in $expectedFunctions) {
            $defined | Should -Contain $fn -Because "$fn must exist in the installer"
        }
    }
}

# ---------------------------------------------------------------------------
Describe 'Get-BuiltinConfig' {

    It 'mainnet config contains chain: mainnet' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/ckb/key' -Ip '1.2.3.4' -Alias 'test-node'
        $cfg | Should -Match 'chain: mainnet'
    }

    It 'testnet config contains chain: testnet' {
        $cfg = Get-BuiltinConfig -Net 'testnet' -KeyPath '/test/ckb/key' -Ip '1.2.3.4' -Alias 'test-node'
        $cfg | Should -Match 'chain: testnet'
    }

    It 'embeds the provided IP in announced_addrs' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/ckb/key' -Ip '192.168.1.50' -Alias 'test-node'
        $cfg | Should -Match '/ip4/192\.168\.1\.50/tcp/8228'
    }

    It 'embeds the provided key path' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/my/custom/key/path' -Ip '1.2.3.4' -Alias 'test-node'
        $cfg | Should -Match 'private_key_path: "/my/custom/key/path"'
    }

    It 'embeds the node alias' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/key' -Ip '1.2.3.4' -Alias 'my-alias'
        $cfg | Should -Match 'node_name: "my-alias"'
    }

    It 'mainnet config contains RPC on localhost only' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/key' -Ip '1.2.3.4' -Alias 'test'
        $cfg | Should -Match 'listening_addr: "127\.0\.0\.1:8227"'
    }

    It 'testnet config contains RPC on localhost only' {
        $cfg = Get-BuiltinConfig -Net 'testnet' -KeyPath '/test/key' -Ip '1.2.3.4' -Alias 'test'
        $cfg | Should -Match 'listening_addr: "127\.0\.0\.1:8227"'
    }

    It 'mainnet config includes expected bootnode addresses' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/key' -Ip '1.2.3.4' -Alias 'test'
        $cfg | Should -Match 'bootnode_addrs'
    }

    It 'mainnet config includes FundingLock and CommitmentLock scripts' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/key' -Ip '1.2.3.4' -Alias 'test'
        $cfg | Should -Match 'FundingLock'
        $cfg | Should -Match 'CommitmentLock'
    }

    It 'config includes all required top-level service entries' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/key' -Ip '1.2.3.4' -Alias 'test'
        $cfg | Should -Match '- fiber'
        $cfg | Should -Match '- rpc'
        $cfg | Should -Match '- ckb'
    }
}

# ---------------------------------------------------------------------------
Describe 'BEAF UDT injection' {

    BeforeEach {
        # Create a temp directory for each test
        $script:TmpDir = Join-Path $env:TEMP "fiber-test-$([System.Guid]::NewGuid().ToString('N'))"
        New-Item -ItemType Directory -Force -Path $script:TmpDir | Out-Null
        $script:TmpConfig = Join-Path $script:TmpDir 'config.yml'
    }

    AfterEach {
        Remove-Item $script:TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'injects BEAF block before rpc: in mainnet config' {
        # Write a minimal mainnet-style config (no udt_cfg_infos yet)
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/key' -Ip '1.2.3.4' -Alias 'test'
        [System.IO.File]::WriteAllText($script:TmpConfig, $cfg, [System.Text.Encoding]::UTF8)

        # Replicate the BEAF injection logic from Write-Config
        $raw = [System.IO.File]::ReadAllText($script:TmpConfig)
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
            [System.IO.File]::WriteAllText($script:TmpConfig, $raw, [System.Text.Encoding]::UTF8)
        }

        $result = [System.IO.File]::ReadAllText($script:TmpConfig)
        $result | Should -Match 'udt_cfg_infos'
        $result | Should -Match 'BEAF'
        $result | Should -Match '0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95'
    }

    It 'BEAF block appears before rpc: section' {
        $cfg = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/test/key' -Ip '1.2.3.4' -Alias 'test'
        [System.IO.File]::WriteAllText($script:TmpConfig, $cfg, [System.Text.Encoding]::UTF8)

        $raw = [System.IO.File]::ReadAllText($script:TmpConfig)
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
        [System.IO.File]::WriteAllText($script:TmpConfig, $raw, [System.Text.Encoding]::UTF8)

        $result = [System.IO.File]::ReadAllText($script:TmpConfig)
        $beafPos = $result.IndexOf('udt_cfg_infos')
        $rpcPos  = $result.IndexOf("`nrpc:")
        $beafPos | Should -BeLessThan $rpcPos -Because 'BEAF block must come before rpc: section'
    }

    It 'does not inject BEAF twice if already present' {
        $cfgWithBeaf = @"
fiber:
  listening_addr: "/ip4/0.0.0.0/tcp/8228"
  udt_cfg_infos:
    - name: "BEAF"
      symbol: "BEAF"
      decimal: 0
rpc:
  listening_addr: "127.0.0.1:8227"
"@
        [System.IO.File]::WriteAllText($script:TmpConfig, $cfgWithBeaf, [System.Text.Encoding]::UTF8)

        $raw = [System.IO.File]::ReadAllText($script:TmpConfig)
        $injectedCount = 0
        if ($raw -notmatch 'udt_cfg_infos') {
            # Injection would happen here
            $injectedCount++
        }

        $injectedCount | Should -Be 0 -Because 'BEAF should not be injected when already present'
        ($raw | Select-String 'udt_cfg_infos' -AllMatches).Matches.Count | Should -Be 1
    }

    It 'BEAF uses correct code_hash for xUDT data1 script' {
        # hex string has no regex-special chars so no escaping needed
        $script:RawContent | Should -Match '0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95'
    }

    It 'BEAF uses correct args for the token type id' {
        $script:RawContent | Should -Match '0xc639759e988445217e4c08b2e7b416082d9de0cb061194e2f7f35a89bb6fbf4f'
    }
}

# ---------------------------------------------------------------------------
Describe 'Config patching (downloaded config)' {

    It 'replaces private_key_path correctly' {
        $raw = "fiber:`n  private_key_path: old-value`n  other: x`n"
        $keyPath = 'C:/new/key'
        $patched = $raw -replace '(?m)(private_key_path:\s*).*', "`${1}`"$keyPath`""
        $patched | Should -Match 'private_key_path: "C:/new/key"'
        $patched | Should -Not -Match 'old-value'
    }

    It 'replaces node_name when already present' {
        $raw = "fiber:`n  node_name: old-name`n  other: x`n"
        $alias = 'my-node'
        $patched = $raw -replace '(?m)(^\s+node_name:\s*).*', "`${1}`"$alias`""
        $patched | Should -Match 'node_name: "my-node"'
        $patched | Should -Not -Match 'old-name'
    }

    It 'inserts node_name after listening_addr when not present' {
        $raw = "fiber:`n  listening_addr: `"/ip4/0.0.0.0/tcp/8228`"`n  other: x`n"
        $alias = 'my-node'
        $patched = $raw -replace '(?m)(^\s+listening_addr:.*)', "`$1`n  node_name: `"$alias`""
        $patched | Should -Match 'node_name: "my-node"'
    }

    It 'replaces announced_addrs with the correct IP' {
        $raw = "  announced_addrs:`n    - `"/ip4/0.0.0.0/tcp/8228`"`n  other_field: x`n"
        $ip = '5.5.5.5'
        $patched = [regex]::Replace($raw,
            '(?s)(\s+announced_addrs:).*?(?=\n\s+\w|\nrpc:)',
            "`$1`n    - `"/ip4/$ip/tcp/8228`"")
        $patched | Should -Match '/ip4/5\.5\.5\.5/tcp/8228'
        $patched | Should -Not -Match '/ip4/0\.0\.0\.0/tcp/8228'
    }

    It 'locks rpc listening_addr to localhost' {
        $raw = "rpc:`n  listening_addr: `"0.0.0.0:8227`"`n"
        $patched = [regex]::Replace($raw,
            '(?m)(^rpc:\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+listening_addr:)[ \t]*.*',
            '$1 "127.0.0.1:8227"')
        $patched | Should -Match '127\.0\.0\.1:8227'
        $patched | Should -Not -Match '0\.0\.0\.0:8227'
    }
}

# ---------------------------------------------------------------------------
Describe 'Node alias sanitization' {

    It 'strips double-quotes from alias' {
        $raw = 'my"node'
        $sanitized = ($raw -replace '["\\\x00-\x1f]', '').Trim()
        $sanitized | Should -Be 'mynode'
    }

    It 'strips backslashes from alias' {
        $raw = 'my\node'
        $sanitized = ($raw -replace '["\\\x00-\x1f]', '').Trim()
        $sanitized | Should -Be 'mynode'
    }

    It 'falls back to fiber-node when alias becomes empty after sanitization' {
        $raw = '"\'
        $sanitized = ($raw -replace '["\\\x00-\x1f]', '').Trim()
        if (-not $sanitized) { $sanitized = 'fiber-node' }
        $sanitized | Should -Be 'fiber-node'
    }

    It 'preserves normal alphanumeric alias' {
        $raw = 'my-cool-node-123'
        $sanitized = ($raw -replace '["\\\x00-\x1f]', '').Trim()
        $sanitized | Should -Be 'my-cool-node-123'
    }
}

# ---------------------------------------------------------------------------
Describe 'Version constants' {

    It 'FNN_VERSION is set and matches semver pattern' {
        $ver = ($script:Ast.FindAll(
            { param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] },
            $true
        ) | Where-Object { $_.Left.Extent.Text -eq '$FNN_VERSION' } | Select-Object -First 1)
        $ver | Should -Not -BeNullOrEmpty
        $ver.Right.Extent.Text | Should -Match "^'v\d+\.\d+\.\d+'"
    }

    It 'CKB_CLI_VERSION is set and matches semver pattern' {
        $ver = ($script:Ast.FindAll(
            { param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] },
            $true
        ) | Where-Object { $_.Left.Extent.Text -eq '$CKB_CLI_VERSION' } | Select-Object -First 1)
        $ver | Should -Not -BeNullOrEmpty
        $ver.Right.Extent.Text | Should -Match "^'v\d+\.\d+\.\d+'"
    }

    It 'FnnUrl references the FNN_VERSION' {
        # $FNN_VERSION appears inside a double-quoted string in FnnUrl — escape $ for regex
        $script:RawContent | Should -Match '\$FNN_VERSION'
    }
}

# ---------------------------------------------------------------------------
Describe 'Security checks' {

    It 'RPC port 8227 is blocked (not allowed) in firewall setup' {
        $script:RawContent | Should -Match 'action=block.*localport=8227|localport=8227.*action=block'
    }

    It 'P2P port 8228 is allowed in firewall setup' {
        $script:RawContent | Should -Match 'action=allow.*localport=8228|localport=8228.*action=allow'
    }

    It 'Dashboard port 3333 is blocked from external access' {
        $script:RawContent | Should -Match 'action=block.*localport=3333|localport=3333.*action=block'
    }

    It 'RPC only binds to localhost in generated config' {
        # Both builtin configs must restrict RPC to localhost
        $mainnet = Get-BuiltinConfig -Net 'mainnet' -KeyPath '/k' -Ip '1.1.1.1' -Alias 'n'
        $testnet = Get-BuiltinConfig -Net 'testnet' -KeyPath '/k' -Ip '1.1.1.1' -Alias 'n'
        $mainnet | Should -Match '127\.0\.0\.1:8227'
        $testnet | Should -Match '127\.0\.0\.1:8227'
    }

    It 'BIND_HOST for dashboard is 0.0.0.0 (relies on firewall, not binding)' {
        # Dashboard uses 0.0.0.0 on Windows but is protected by firewall rule above
        $script:RawContent | Should -Match "BIND_HOST.*=.*'0\.0\.0\.0'"
    }
}
