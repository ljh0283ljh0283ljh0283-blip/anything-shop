@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 서버를 켭니다. 이 창을 닫으면 서버가 꺼져요. (확인용)
echo 인터넷 창에서 http://localhost:8080 을 열어 보세요.
echo.
node --disable-warning=ExperimentalWarning server.js
pause
