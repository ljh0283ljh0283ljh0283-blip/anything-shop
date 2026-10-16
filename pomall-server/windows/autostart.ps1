# SEKI POmall 서버를 윈도우가 켜질 때 저절로 켜지게 하거나(on) 그만두게(off) 합니다.
# 4-autostart-on.bat / autostart-off.bat 에서 관리자 권한으로 부릅니다.
param([string]$mode = 'on')
$ErrorActionPreference = 'Stop'
$task = 'SEKI POmall'
$dir = Split-Path -Parent $PSScriptRoot

if ($mode -eq 'off') {
  if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $task -Confirm:$false
  }
  Get-NetFirewallRule -DisplayName $task -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Write-Host '자동 실행을 껐어요. 서버도 멈췄어요.'
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host 'Node.js를 찾지 못했어요. 1-setup.bat 을 먼저 해 주세요.'; exit 1 }
if (-not (Test-Path (Join-Path $dir 'config.json'))) { Write-Host 'config.json 이 없어요. 1-setup.bat 을 먼저 해 주세요.'; exit 1 }
$port = 8080
try { $c = Get-Content (Join-Path $dir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json; if ($c.port) { $port = [int]$c.port } } catch { }

# 서버 메시지는 data\server.log 에 남긴다
New-Item -ItemType Directory -Force -Path (Join-Path $dir 'data') | Out-Null
$log = Join-Path $dir 'data\server.log'
$cmd = '/c ""' + $node + '" --disable-warning=ExperimentalWarning "' + (Join-Path $dir 'server.js') + '" >> "' + $log + '" 2>&1"'

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmd -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $task

# 같은 사무실의 다른 컴퓨터에서도 들어올 수 있게 방화벽을 연다
Get-NetFirewallRule -DisplayName $task -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $task -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null

Start-Sleep -Seconds 3
try {
  $r = Invoke-RestMethod -Uri "http://localhost:$port/api" -TimeoutSec 5
  Write-Host "서버가 켜졌어요. 이제 컴퓨터를 다시 켜도 저절로 켜집니다. http://localhost:$port"
} catch {
  Write-Host "자동 실행은 등록했지만 서버가 아직 대답하지 않아요. $log 파일을 열어 메시지를 확인해 주세요."
}
