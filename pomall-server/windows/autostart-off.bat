@echo off
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  echo 이 파일을 마우스 오른쪽 버튼으로 눌러 "관리자 권한으로 실행"을 골라 주세요.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" off
pause
