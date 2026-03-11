Import-Module 'C:\Users\tesilva\Documents\WindowsPowerShell\Modules\Pester\5.7.1\Pester.psd1' -Force
$cfg = New-PesterConfiguration
$cfg.Run.Path = "$PSScriptRoot\install-fiber.Tests.ps1"
$cfg.Output.Verbosity = 'None'
$cfg.Run.PassThru = $true
$r = Invoke-Pester -Configuration $cfg

Write-Host ""
if ($r.FailedCount -gt 0) {
    Write-Host "=== FAILURES ===" -ForegroundColor Red
    $r.Failed | ForEach-Object {
        Write-Host "  FAIL: $($_.Name)" -ForegroundColor Red
        $msg = ($_.ErrorRecord.Exception.Message -split "`n")[0].Trim()
        Write-Host "        $msg" -ForegroundColor DarkRed
    }
    Write-Host ""
}
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "Passed: $($r.PassedCount)  Failed: $($r.FailedCount)  Total: $($r.TotalCount)"
if ($r.FailedCount -eq 0) {
    Write-Host "All tests passed!" -ForegroundColor Green
}
