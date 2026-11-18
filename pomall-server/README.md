# SEKI POmall 회사 서버 설치 설명서 (윈도우)

구글(Apps Script + 구글 시트 + 드라이브)이 하던 일을 **회사 윈도우 컴퓨터 한 대**가 하도록 만든 프로그램입니다.
발주, 거래처, 상태 기록, 찾기 요청, 첨부 발주서를 모두 그 컴퓨터의 `data` 폴더에 저장하고, 주문 화면도 함께 보여 줍니다.

- `https://회사주소/` : 견적 모델판 (`pomall-new`)
- `https://회사주소/old/` : 예전 화면 (`pomall`)

지금 구글 버전에 있는 기능은 모두 똑같이 됩니다: 거래처 로그인과 단가, 견적 모델, 발주서 첨부, 주문관리, 거래처 관리,
비밀번호 보기, 메일로 코드·비밀번호 찾기, 찾기 요청, 보안 강화(5번 틀리면 15분 잠금, 관리 열쇠 15분에 20번 틀리면 잠금,
6시간 입장권, 새 비밀번호 6자 이상).

---

## 준비물 (설치 전에 챙길 것)

| 준비물 | 어디서 | 메모 |
|---|---|---|
| 서버로 쓸 윈도우 PC | 회사 | 24시간 켜 둘 수 있는 PC. 절전 모드는 꺼 둡니다 |
| 관리자·영업팀·조회 전용 열쇠 | 지금 Apps Script > 프로젝트 설정 > 스크립트 속성 | 그대로 써도 되고 새로 정해도 됩니다 |
| Apps Script 주소 | 지금 화면의 `settings.json` 의 `orderUrl` | `https://script.google.com/macros/s/AKfycbxo5iLV…/exec` |
| 메일 보내기 정보(선택) | 회사 메일 관리자 또는 Gmail | "메일로 비밀번호 찾기"에 필요. 없으면 찾기 요청만 받습니다 |
| 회사 도메인(밖에서 쓸 때) | 회사 도메인 관리 업체 | 예: `pomall.회사도메인.co.kr` |

---

## 1단계. 파일 받기

1. https://github.com/ljh0283ljh0283ljh0283-blip/anything-shop 을 엽니다.
2. 초록색 **Code** 버튼 > **Download ZIP** 을 누릅니다.
3. 받은 ZIP을 오른쪽 클릭 > **압축 풀기** 로 `C:\POmall` 에 풉니다.
   그 안에 `pomall-new`, `pomall`, `pomall-server` 폴더가 나란히 있어야 합니다.

## 2단계. Node.js 설치

https://nodejs.org 에서 **LTS** 를 내려받아 설치합니다. 설치 화면은 모두 "다음"을 누르면 됩니다.

## 3단계. 설정 (`1-setup.bat`)

`C:\POmall\pomall-server\windows\1-setup.bat` 을 더블클릭합니다. 메모장으로 `config.json` 이 열리면 아래를 적고 저장합니다.

```json
  "adminKey": "관리자 열쇠 (8글자 이상)",
  "salesKey": "영업팀 열쇠",
  "viewKey": "조회 전용 열쇠",
```

- 열쇠에는 `%` 와 `"` 를 쓰지 마세요.
- `config.json` 은 GitHub에 올라가지 않습니다. 메신저나 이메일로 보내지 마세요.
- 파란 "Windows의 PC 보호" 창이 뜨면 **추가 정보 > 실행** 을 누르세요.

### 메일 보내기 (선택, "메일로 비밀번호 찾기"용)

같은 `config.json` 의 `mail` 칸을 채웁니다.

**Gmail로 보낼 때** (가장 쉬움)
1. 보낼 Gmail 계정에서 2단계 인증을 켭니다.
2. https://myaccount.google.com/apppasswords 에서 앱 비밀번호(16글자)를 만듭니다.
3. 아래처럼 적습니다.
```json
  "mail": { "host": "smtp.gmail.com", "port": 465, "user": "보낼주소@gmail.com", "pass": "앱비밀번호16글자", "from": "보낼주소@gmail.com", "name": "SEKI POmall" }
```

**회사 메일로 보낼 때**: 메일 관리자에게 "SMTP 서버 주소와 포트(465 또는 587)"를 물어 `host`, `port` 에 적고, 보낼 계정 아이디·비밀번호를 `user`, `pass` 에 적습니다.

비워 두면 서버는 그대로 돌아가고, 거래처의 "메일로 찾기"만 "준비되지 않았어요"라고 나옵니다(찾기 요청은 그대로 받습니다).

## 4단계. 구글 자료 옮기기 (`2-import.bat`)

1. **먼저** 지금 Apps Script(SEKI POmall)에 최신 `pomall-new/pomall-script.gs` 가 배포돼 있는지 확인합니다.
   (아니면 붙여 넣고 **배포 > 배포 관리 > 연필 > 새 버전 > 배포**. 주소는 그대로입니다.)
2. `2-import.bat` 을 더블클릭하고, Apps Script 주소와 관리자 열쇠를 붙여 넣습니다.
3. "옮기기 끝: 발주 ○건, 거래처 ○곳…" 이 나오면 성공입니다.

- 거래처는 **쓰던 비밀번호 그대로** 로그인합니다. 거래처 메일, 비밀번호(보기)도 함께 옮겨집니다.
- 지난 발주서 첨부는 구글 드라이브 링크를 그대로 씁니다. 새로 올리는 발주서부터 회사 PC에 저장됩니다.
- 옮긴 내용은 `export.json` 으로도 저장됩니다. 구글 자료의 백업본이니 보관하세요.
- 시험 삼아 옮긴 뒤 실제로 옮길 때 다시 하려면: 명령 프롬프트에서 `pomall-server` 폴더로 가서
  `node import.js --file export.json --force` 처럼 `--force` 를 붙이면 지우고 새로 옮깁니다.

## 5단계. 켜서 확인 (`3-start.bat`)

`3-start.bat` 을 더블클릭하고, 인터넷 창에서 `http://localhost:8080` 을 엽니다.

확인할 것:
- [ ] 거래처 코드·비밀번호로 로그인되고 단가가 보인다
- [ ] 관리 화면이 열쇠로 열리고 주문이 보인다
- [ ] 거래처 관리에서 비밀번호(보기)가 보인다
- [ ] `http://localhost:8080/old/` 예전 화면도 열린다
- [ ] (메일을 설정했다면) 로그인 화면 "코드·비밀번호 찾기"로 메일이 온다

확인했으면 창을 닫습니다.

## 6단계. 자동 실행 (`4-autostart-on.bat`)

`4-autostart-on.bat` 을 **오른쪽 클릭 > 관리자 권한으로 실행** 합니다.
이제 PC가 켜질 때마다 서버가 저절로 켜집니다(윈도우에 로그인하지 않아도 됩니다). 사무실 방화벽도 열어 둡니다.

- 자동 실행을 켠 뒤에는 `3-start.bat` 을 쓰지 않습니다(겹칩니다).
- 그만두려면 `autostart-off.bat` 을 관리자 권한으로 실행합니다.
- `config.json` 을 고친 뒤에는 `autostart-off.bat` → `4-autostart-on.bat` 으로 다시 켭니다.
- 사무실 다른 PC에서는 `http://서버PC의IP:8080` 으로 들어옵니다(IP는 명령 프롬프트에서 `ipconfig`).

## 7단계. 회사 밖(거래처)에서 들어오게 하기: 도메인 + HTTPS

비밀번호가 오가므로 **HTTPS(주소창 자물쇠) 없이 밖에 열면 안 됩니다.**
추천: **Cloudflare Tunnel (무료)**. 공유기 포트를 열 필요가 없고 HTTPS 인증서가 저절로 붙고 갱신됩니다.

1. https://dash.cloudflare.com 에 가입하고 회사 도메인을 추가합니다.
   (도메인 관리 업체에서 네임서버를 Cloudflare가 알려 주는 두 개로 바꿉니다. 회사 홈페이지·메일이 같은 도메인이면 IT 담당자와 먼저 상의하세요.)
2. Cloudflare **Zero Trust > Networks > Tunnels > Create a tunnel** > Cloudflared > 이름 `pomall`.
3. **Windows** 를 고르고 나오는 설치 명령을 복사해, 서버 PC에서 **관리자 권한 명령 프롬프트**에 붙여 넣고 실행합니다.
   (이 명령이 터널을 윈도우 서비스로 등록해 PC를 켜면 저절로 이어집니다.)
4. **Public Hostname** 에서 Subdomain `pomall`, Domain 회사 도메인, Service `HTTP` / `localhost:8080` 으로 저장합니다.
5. `config.json` 의 `"publicUrl"` 에 `"https://pomall.회사도메인"` 을 적고 서버를 다시 켭니다(6단계 맨 아래).
6. 휴대폰 데이터(회사 와이파이 끄고)로 `https://pomall.회사도메인` 이 열리는지 확인합니다.

다른 방법: 회사에 이미 웹서버(IIS, Nginx)와 인증서가 있다면 그 서버에서 `https://pomall.회사도메인` 을
`http://서버PC:8080` 으로 넘겨도(리버스 프록시) 됩니다. 이때 `X-Forwarded-Proto` 머리글을 넘겨 주세요.

## 8단계. 거래처에 새 주소 알리기 (구글에서 갈아타기)

1. 갈아탈 날을 정하고 그날 아침 4단계를 `--force` 로 한 번 더 해서 최신 자료로 옮깁니다.
2. 거래처에 새 주소 `https://pomall.회사도메인` 을 알립니다.
3. 지금 GitHub 주소로 들어오는 거래처도 있으므로, `pomall-new/settings.json` 과 `pomall/settings.json` 의
   `orderUrl` 을 `https://pomall.회사도메인/api` 로 바꿉니다(Claude에게 "지금 버전 orderUrl을 회사 서버로 바꿔 줘"라고 하면 됩니다).
4. 구글 시트와 Apps Script는 지우지 말고 한 달쯤 그대로 두었다가(혹시 몰라 되돌릴 수 있게) 정리합니다.

---

## 백업

서버가 **하루 한 번 저절로** 백업합니다.

- `backup\pomall-날짜.db` : 그날의 발주, 거래처, 상태 기록, 찾기 요청 (30일치 보관)
- `backup\files\` : 거래처가 올린 발주서

PC가 고장 나도 안전하려면 `config.json` 의 `backupDir` 을 다른 디스크, NAS, OneDrive 폴더로 바꿉니다.
예: `"backupDir": "D:/POmall백업"` (경로의 `\` 대신 `/` 를 씁니다)

되살릴 때는 서버를 끄고(`autostart-off.bat`) 백업한 `pomall-날짜.db` 를 `data\pomall.db` 로 복사한 뒤 다시 켭니다.

서버 PC를 바꿀 때는 관리 열쇠로 `export` 를 받아(`node import.js` 와 같은 방법) 새 PC에서 `--file` 로 넣거나,
`data` 폴더와 `config.json` 을 통째로 복사하면 됩니다.

## 문제가 생기면

- 서버 메시지는 `data\server.log` 에 남습니다. (메일이 안 가면 여기에 까닭이 적힙니다)
- 작업 스케줄러에서 **SEKI POmall** 작업을 찾아 켜고 끌 수 있습니다.
- 서버를 다시 켜도 로그인은 6시간 동안 유지됩니다. 틀린 횟수 잠금은 서버를 다시 켜면 풀립니다.

## 바뀌지 않는 것

- 주문 화면, 관리 화면, 열쇠, 상태 규칙, 발주번호 모양은 구글 때와 똑같습니다.
- 사양 코드와 가격 규칙은 `pomall-new/products.json` 을 그대로 읽습니다.

## (참고) 윈도우가 아닌 컴퓨터

Node.js 22.13 이상을 설치하고 `pomall-server` 폴더에서 `config.json` 을 만든 뒤
`npm run import -- --url "Apps Script 주소" --key "관리자 열쇠" --save export.json`, `npm start` 를 차례로 실행합니다.
