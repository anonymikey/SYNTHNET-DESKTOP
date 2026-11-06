# Controls the native Windows Mobile Hotspot via the WinRT NetworkOperatorTetheringManager API.
# Must run under Windows PowerShell 5.1 (powershell.exe), NOT pwsh 7.
param(
  [ValidateSet('status','apply','start','stop')][string]$Action = 'status',
  [string]$Ssid = 'SYNTHNET_VOUCHER_HOTSPOT',
  [string]$Password = '12345678'
)
$ErrorActionPreference = 'Stop'

function Emit($ok, $msg, $tm) {
  $state = $null; $name = $null; $clients = $null
  if ($tm) {
    $state = $tm.TetheringOperationalState.ToString()
    $name = $tm.GetCurrentAccessPointConfiguration().Ssid
    $clients = $tm.ClientCount
  }
  [pscustomobject]@{ ok = $ok; message = $msg; state = $state; ssid = $name; clients = $clients } | ConvertTo-Json -Compress
}

$tm = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
  [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
  [void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]

  $ext = [System.WindowsRuntimeSystemExtensions].GetMethods()
  $asTaskOp  = ($ext | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $asTaskAct = ($ext | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
  $resultType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]

  function AwaitOp($op) { $t = $asTaskOp.MakeGenericMethod($resultType).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
  function AwaitAct($act) { $t = $asTaskAct.Invoke($null, @($act)); $t.Wait(-1) | Out-Null }

  $conn = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if (-not $conn) { throw 'No internet connection found. Is the Airtel ODU connected and online?' }
  $tm = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($conn)

  switch ($Action) {
    'status' { Emit $true 'ok' $tm; break }
    'stop' {
      if ($tm.TetheringOperationalState -eq 'On') { $r = AwaitOp ($tm.StopTetheringAsync()); if ($r.Status -ne 'Success') { throw "Stop failed: $($r.Status) $($r.AdditionalErrorMessage)" } }
      Emit $true 'Hotspot stopped.' $tm; break
    }
    'start' {
      if ($tm.TetheringOperationalState -ne 'On') { $r = AwaitOp ($tm.StartTetheringAsync()); if ($r.Status -ne 'Success') { throw "Start failed: $($r.Status) $($r.AdditionalErrorMessage)" } }
      Emit $true 'Hotspot running.' $tm; break
    }
    'apply' {
      if ($Ssid.Length -lt 1 -or $Ssid.Length -gt 32) { throw 'SSID must be 1-32 characters.' }
      if ($Password.Length -lt 8 -or $Password.Length -gt 63) { throw 'Password must be 8-63 characters (WPA2 minimum is 8).' }
      if ($tm.TetheringOperationalState -eq 'On') { [void](AwaitOp ($tm.StopTetheringAsync())) }
      $cfg = $tm.GetCurrentAccessPointConfiguration()
      $cfg.Ssid = $Ssid
      $cfg.Passphrase = $Password
      AwaitAct ($tm.ConfigureAccessPointAsync($cfg))
      $r = AwaitOp ($tm.StartTetheringAsync())
      if ($r.Status -ne 'Success') { throw "Configured, but start failed: $($r.Status) $($r.AdditionalErrorMessage)" }
      Emit $true "Hotspot renamed to '$Ssid' and started." $tm; break
    }
  }
} catch {
  Emit $false $_.Exception.Message $null
  exit 1
}
