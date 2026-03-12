@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\ToddGilmore\Analytics\scripts\backup\verify-latest-backup.ps1" -BackupRoot "C:\Backups\Analytics" >> "C:\Backups\Analytics\task-logs\verify-task.log" 2>&1

