$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeExe = (Get-Command node.exe).Source
$launcher = Join-Path $repo '.tmp\job-closeout-worker.vbs'
New-Item -ItemType Directory -Force -Path (Split-Path $launcher) | Out-Null
$worker = Join-Path $repo 'scripts\jobCloseout.mjs'
$command = ('"{0}" "{1}" --work' -f $nodeExe, $worker).Replace('"','""')
Set-Content -LiteralPath $launcher -Encoding Unicode -Value @(
  'Set shell = CreateObject("WScript.Shell")',
  ('WScript.Quit shell.Run("{0}", 0, True)' -f $command)
)
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') -Argument ('//B //Nologo "{0}"' -f $launcher) -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 55)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'PMC Analytics Job Closeout' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Select-Object TaskName,State
