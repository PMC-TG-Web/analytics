@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\ToddGilmore\Analytics\scripts\backup\backup-site.ps1" -ProjectRoot "C:\Users\ToddGilmore\Analytics" -BackupRoot "C:\Backups\Analytics" -KeepDays 30 >> "C:\Backups\Analytics\task-logs\backup-task.log" 2>&1

