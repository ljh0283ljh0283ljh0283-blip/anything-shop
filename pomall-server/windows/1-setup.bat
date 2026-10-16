@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo.
echo [1/2] Node.js 확인
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" 2>nul
if errorlevel 1 (
  echo   Node.js 22.13 이상이 필요해요. https://nodejs.org 에서 LTS를 설치한 뒤 이 파일을 다시 실행해 주세요.
  start https://nodejs.org
  pause
  exit /b 1
)
for /f %%v in ('node -v') do echo   Node.js %%v 확인했어요.
echo.
echo [2/2] 설정 파일 config.json
if not exist config.json (
  copy /y config.example.json config.json >nul
  echo   config.json 을 만들었어요. 메모장이 열리면 세 열쇠를 적고 저장해 주세요.
) else (
  echo   config.json 이 이미 있어요. 메모장에서 확인만 해 주세요.
)
notepad config.json
echo.
echo 다음 순서: 2-import.bat 으로 구글 자료를 옮기세요.
pause
