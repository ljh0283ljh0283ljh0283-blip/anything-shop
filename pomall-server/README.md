# SEKI POmall 회사 서버 (윈도우 설치 안내)

구글(Apps Script + 구글 시트 + 드라이브)이 하던 일을 회사 윈도우 컴퓨터 한 대가 하도록 만든 프로그램입니다.
발주, 거래처, 상태 기록, 첨부 발주서를 모두 그 컴퓨터의 `data` 폴더에 저장하고, 주문 화면도 함께 보여 줍니다.

설치는 `windows` 폴더의 파일을 **번호 순서대로 더블클릭**하면 됩니다.

## 0. 파일 받기

1. https://github.com/ljh0283ljh0283ljh0283-blip/anything-shop 을 엽니다.
2. 초록색 **Code** 버튼 > **Download ZIP** 을 누릅니다.
3. 받은 ZIP을 오른쪽 클릭 > **압축 풀기** 로 `C:\POmall` 처럼 짧은 곳에 풉니다.
   그 안에 `pomall` 폴더와 `pomall-server` 폴더가 나란히 있어야 합니다.

## 1. Node.js 설치

https://nodejs.org 에서 **LTS** 를 내려받아 설치합니다. 설치 화면은 모두 "다음"을 누르면 됩니다.

## 2. 순서대로 더블클릭 (`pomall-server\windows` 폴더)

| 순서 | 파일 | 하는 일 |
|---|---|---|
| 1 | `1-setup.bat` | Node.js를 확인하고 `config.json` 을 만들어 메모장으로 엽니다. 세 열쇠를 적고 저장하세요. |
| 2 | `2-import.bat` | 구글 시트의 자료를 옮깁니다(처음 한 번만). Apps Script 주소와 관리자 열쇠를 물어봅니다. |
| 3 | `3-start.bat` | 서버를 켜서 확인합니다. 인터넷 창에서 `http://localhost:8080` 을 열어 보세요. 확인했으면 창을 닫습니다. |
| 4 | `4-autostart-on.bat` | **오른쪽 클릭 > 관리자 권한으로 실행.** 컴퓨터가 켜질 때마다 서버가 저절로 켜집니다. 로그인하지 않아도 됩니다. |

그만두고 싶을 때는 `autostart-off.bat` 을 관리자 권한으로 실행합니다.

- 파란 "Windows의 PC 보호" 창이 뜨면 **추가 정보 > 실행** 을 누르세요.
- 자동 실행을 켠 뒤에는 `3-start.bat` 을 쓰지 않습니다. (이미 켜져 있어서 겹칩니다.)

### 열쇠 적는 법 (`config.json`)

- `adminKey`: 관리자 열쇠 (8글자 이상이어야 서버가 켜집니다)
- `salesKey`: 영업팀 열쇠
- `viewKey`: 조회 전용 열쇠

지금 쓰는 열쇠를 그대로 써도 되고 새로 정해도 됩니다. 열쇠에는 `%` 와 `"` 를 쓰지 마세요.
`config.json` 은 GitHub에 올라가지 않습니다. 열쇠를 메신저나 이메일로 보내지 마세요.

### 자료 옮기기 전에 할 일

`2-import.bat` 을 하기 전에, 최신 `pomall/pomall-script.gs` 를 Apps Script(SEKI POmall)에 붙여 넣고
**배포 관리 > 연필 > 새 버전 > 배포** 를 해 주세요. 자료를 내보내는 기능이 이 버전에 들어 있습니다.

- 거래처는 쓰던 비밀번호 그대로 로그인합니다.
- 지난 발주서 첨부 파일은 구글 드라이브 링크를 그대로 씁니다. 새로 올리는 발주서부터 회사 컴퓨터에 저장됩니다.
- 옮긴 내용은 `export.json` 으로도 저장됩니다. 구글 자료의 백업본이니 보관하세요.

## 3. 사무실 안에서 쓰기

`4-autostart-on.bat` 이 방화벽도 열어 둡니다. 같은 사무실의 다른 컴퓨터에서
`http://서버컴퓨터IP:8080` 으로 들어올 수 있습니다. (서버 컴퓨터 IP는 명령 프롬프트에서 `ipconfig` 로 봅니다.)

## 4. 회사 밖(거래처)에서 들어오게 하기

거래처가 밖에서 주문하려면 **회사 주소(도메인)** 와 **HTTPS(자물쇠 표시)** 가 필요합니다. 비밀번호가 오가므로 HTTPS 없이 밖에 열면 안 됩니다.

추천하는 방법은 **Cloudflare Tunnel(무료)** 입니다. 공유기 포트를 열 필요가 없고 HTTPS가 저절로 붙습니다.

1. 도메인을 하나 준비하고 Cloudflare(https://dash.cloudflare.com)에 등록합니다.
2. Cloudflare의 **Zero Trust > Networks > Tunnels > Create a tunnel** 에서 Windows용 설치 명령을 복사해 서버 컴퓨터에서 실행합니다.
3. **Public Hostname** 에 `pomall.회사도메인` 을 적고 Service 를 `http://localhost:8080` 으로 정합니다.
4. `config.json` 의 `publicUrl` 에 `https://pomall.회사도메인` 을 적고, `autostart-off.bat` → `4-autostart-on.bat` 으로 서버를 다시 켭니다.

이제 거래처는 `https://pomall.회사도메인` 으로 들어와 주문합니다.
지금의 GitHub 주소를 계속 쓰고 싶다면 `pomall/settings.json` 의 `orderUrl` 을 `https://pomall.회사도메인/api` 로 바꾸면 됩니다.

## 5. 백업

서버가 **하루 한 번 저절로** 백업합니다.

- `backup\pomall-날짜.db`: 그날의 발주, 거래처, 상태 기록 (30일치 보관)
- `backup\files\`: 거래처가 올린 발주서

컴퓨터가 고장 나도 안전하려면 `config.json` 의 `backupDir` 을 다른 디스크나 OneDrive 폴더로 바꿉니다.
예: `"backupDir": "D:/POmall백업"` (경로의 `\` 대신 `/` 를 씁니다)

되살릴 때는 서버를 끄고(`autostart-off.bat`) 백업한 `pomall-날짜.db` 를 `data\pomall.db` 로 복사한 뒤 다시 켭니다.

## 6. 문제가 생기면

- 서버 메시지는 `data\server.log` 에 남습니다.
- 작업 스케줄러에서 **SEKI POmall** 작업을 찾아 켜고 끌 수도 있습니다.

## 바뀌지 않는 것

- 주문 화면, 관리 화면, 열쇠, 상태 규칙, 발주번호 모양은 구글 때와 똑같습니다.
- 사양 코드와 가격은 `pomall/products.json` 을 그대로 읽습니다.

## (참고) 윈도우가 아닌 컴퓨터

Node.js 22.13 이상을 설치하고 `pomall-server` 폴더에서 `config.json` 을 만든 뒤
`npm run import -- --url "Apps Script 주소" --key "관리자 열쇠" --save export.json`, `npm start` 를 차례로 실행합니다.
