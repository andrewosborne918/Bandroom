param([Parameter(Mandatory=$true)][string]$InstallerDirectory)
$ErrorActionPreference = 'Stop'
$installers = @(Get-ChildItem -LiteralPath $InstallerDirectory -Filter '*.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows installer' }
$signature = Get-AuthenticodeSignature -LiteralPath $installers[0].FullName
Write-Host "Windows installer Authenticode status: $($signature.Status)"
# This beta is intentionally unsigned. A present but invalid signature fails.
if ($signature.Status -notin @('NotSigned', 'Valid')) { throw "Invalid installer signature: $($signature.Status)" }
$installRoot = Join-Path $env:RUNNER_TEMP 'BndrmInstallCheck'
$installer = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru
if ($installer.ExitCode -ne 0) { throw "Installer failed: $($installer.ExitCode)" }
try {
    $controller = Join-Path $installRoot 'bndrm-desktop.exe'
    if (!(Test-Path -LiteralPath $controller)) { throw 'Installed controller is missing' }
    $processor = @(Get-ChildItem -LiteralPath $installRoot -Filter 'bndrm-processor.exe' -File -Recurse)
    if ($processor.Count -ne 1) { throw 'Expected exactly one installed audio processor' }
    $processorPath = $processor[0].FullName
    & $processorPath --self-test
    if ($LASTEXITCODE -ne 0) { throw 'Installed processor self-test failed' }
    & python desktop/scripts/smoke_test.py $processorPath
    if ($LASTEXITCODE -ne 0) { throw 'Installed audio inference failed' }
    $app = Start-Process -FilePath $controller -PassThru
    try {
        Start-Sleep -Seconds 8
        if ($app.HasExited) { throw "Installed controller exited early: $($app.ExitCode)" }
    } finally {
        if (!$app.HasExited) { Stop-Process -Id $app.Id -Force }
    }
    Write-Host 'Installed Windows app: processor inference and controller startup passed.'
    Write-Host 'Publisher trust: unsigned beta; SmartScreen approval is NOT claimed.'
} finally {
    $uninstaller = Get-ChildItem -LiteralPath $installRoot -Filter '*uninstall*.exe' -File | Select-Object -First 1
    if ($uninstaller) { Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait }
}
