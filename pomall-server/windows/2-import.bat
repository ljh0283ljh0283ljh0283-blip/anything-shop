@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 구글 시트의 발주, 거래처, 상태 기록을 회사 서버로 옮깁니다. (처음 한 번만)
echo Apps Script에 최신 pomall-script.gs 를 새 버전으로 배포한 뒤에 하세요.
echo.
set /p URL=Apps Script 주소(https://script.google.com/... /exec)를 붙여 넣고 Enter: 
set /p KEY=관리자 열쇠를 입력하고 Enter: 
node --disable-warning=ExperimentalWarning import.js --url "%URL%" --key "%KEY%" --save export.json
set KEY=
echo.
echo export.json 은 구글 자료의 백업본이에요. 안전한 곳에 함께 보관하세요.
echo 다음 순서: 3-start.bat 으로 서버를 켜서 확인하세요.
pause
