// SEKI POmall 발주: 거래처 로그인, 거래처별 단가, 발주를 구글 시트에 두는 Apps Script
// 거래처 '메일' 칸으로 코드·비밀번호를 메일 인증번호로 찾고, 메일이 없으면 '찾기 요청' 탭에 요청을 남깁니다.
// 메일을 보내므로 이 버전을 배포할 때 구글이 "메일 보내기" 권한을 다시 묻습니다. 허용해 주세요.
// 견적 모델판(pomall-new/): 거래처별 주문모델·견적단가와 견적 모델 주문. 기존 몰(pomall/)도 이 스크립트로 그대로 돌아가요.
//
// 시트 탭 세 개를 씁니다. 없으면 처음 쓸 때 만들어집니다.
//   발주    발주 한 건의 품목마다 한 줄 (같은 발주번호). 생산 현장에서 줄 단위로 보기 쉽게 하려는 것입니다.
//   상태 기록  상태를 바꿀 때마다 한 줄: 누가, 언제, 무엇에서 무엇으로, 왜(취소나 되돌리기).
//   거래처  거래처 코드, 비밀번호(암호화), 비밀번호(보기: 관리 화면에서 만든 비밀번호, 관리자만 봄), 사용 여부, 할인율(%), 모델마다 한 칸씩 단가(원/EA, 부가세 별도). 빈 칸은 "단가 문의".
//           최종 단가 = 모델 단가 × (1 - 할인율/100). 할인율이 비어 있으면 적은 단가 그대로입니다.
//           단가는 사이트의 관리 > 거래처 단가에서 고치는 것이 기본이지만, 이 시트에서 직접 고쳐도 됩니다.
// 스크립트 속성(프로젝트 설정 > 스크립트 속성)
//   ADMIN_KEY     관리자 열쇠. 모든 일을 합니다: 거래처 단가, 상태 되돌리기, 취소된 발주 살리기.
//   SALES_KEY     영업팀 열쇠. 발주를 보고 상태를 앞으로만 바꿉니다(접수 대기 → 생산 지시 → 생산 중 → 입고 완료 → 출하). 취소는 사유를 적어야 합니다.
//   VIEW_KEY      조회 전용 열쇠(선택). 생산, 물류 같은 다른 팀이 발주와 상태를 보기만 합니다.
//   열쇠를 아는 사람이 팀을 떠나면 그 열쇠 값만 바꾸면 됩니다.
//   LEAD          생산 소요일. 관리 화면에서 바꾸면 여기에 저장됩니다. 직접 만들 필요는 없습니다.
//   PRODUCTS_URL  products.json 주소. 저장소를 옮기면 이 값만 바꾸면 됩니다.
//   ATTACH_FOLDER 거래처가 첨부한 발주서를 넣는 구글 드라이브 폴더 ID. 처음 첨부가 오면 "SEKI POmall 발주서" 폴더를 만들고 여기에 적습니다.
// 발주서 파일은 드라이브 폴더에 저장되고, 발주 탭의 "발주서" 칸에 링크가 남습니다. 링크를 아는 사람만 볼 수 있습니다.
// 금액은 거래처 브라우저가 보낸 값을 믿지 않고 시트의 거래처 단가와 할인율로 다시 계산합니다.

var DEFAULT_PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/pomall/products.json';
var ORDER_SHEET = '발주', CUSTOMER_SHEET = '거래처', LOG_SHEET = '상태 기록', HELP_SHEET = '찾기 요청';
var HELP_HEADER = ['ID', '요청 시각', '회사명', '담당자', '연락처', '잊은 것', '남길 말', '처리 시각', '처리자'];
var LOG_HEADER = ['시각', '발주번호', '거래처', '이전 상태', '바뀐 상태', '변경자', '권한', '사유'];
var ROLES = { admin: '관리자', sales: '영업팀', view: '조회 전용' };
var HEADER = ['발주번호', '접수 시각', '거래처 코드', '거래처', '담당자', '연락처', '거래처 PO', '납품 주소', '요청 사항', '희망 출하일', '최단 출하일',
  '줄', '사양 코드', '모델', '와이어(mm)', '온도(°C)', '수량', '단가', '금액', '품목 메모', '발주 합계(VAT 포함)', '상태', '바뀐 시각', '확정 출하일', '발주서', '와이어2(mm)', '마감', '탈피(mm)', '탈피2(mm)', '핀 길이(mm)', '전류감응속도', '터미널방향', '터미널', '복귀온도(°C)', '견적 모델', '품목 희망납기일', '담당자 메모', '메모 수정'];
var COL = {}; HEADER.forEach(function (h, i) { COL[h] = i; });
var CUST_BASE = ['번호', '거래처 코드', '거래처명', '담당자', '연락처', '기본 납품 주소', '비밀번호', '사용', '할인율(%)', '바뀐 시각', '메일', '견적 모델', '비밀번호(보기)'];
var STATUSES = ['접수 대기', '생산 지시', '생산 중', '입고 완료', '출하', '취소'];
// 예전 상태 이름으로 남은 발주는 새 이름으로 읽는다
var OLD_STATUS = { '생산 확정': '생산 지시', '출하 완료': '출하' };
function statusOf(v) { v = String(v || STATUSES[0]); return OLD_STATUS[v] || v; }

function doGet() { return reply({ ok: true }); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse(e.postData.contents);
    switch (d.action) {
      case 'login': return reply(login(d.code, d.pw));
      case 'order': return reply(placeOrder(d));
      case 'mine': return reply(mine(d));
      case 'config': return reply({ ok: true, lead: lead() });
      case 'saveLead': return reply(staff(d.key, ['admin', 'sales'], function (role) { return saveLead(d, role); }));
      case 'staffMemo': return reply(staff(d.key, ['admin', 'sales'], function () { return setStaffMemo(d); }));
      case 'shipDate': return reply(staff(d.key, ['admin', 'sales'], function (role) { return setShipDate(d, role); }));
      case 'staff': return reply(staff(d.key, ['admin', 'sales', 'view'], function (role) { return { ok: true, role: role }; }));
      case 'list': return reply(staff(d.key, ['admin', 'sales', 'view'], function () { return { ok: true, orders: orders(true) }; }));
      case 'status': return reply(staff(d.key, ['admin', 'sales'], function (role) { return setStatus(d, role); }));
      case 'customers': return reply(staff(d.key, ['admin', 'sales'], function (role) { return { ok: true, customers: customerList(role) }; }));
      case 'saveCustomer': return reply(staff(d.key, ['admin', 'sales'], function () { return saveCustomer(d.customer || {}); }));
      case 'deleteCustomer': return reply(staff(d.key, ['admin', 'sales'], function () { return deleteCustomer(d.code); }));
      case 'export': return reply(staff(d.key, ['admin'], exportAll));
      case 'resetStart': return reply(resetStart(d));
      case 'resetFinish': return reply(resetFinish(d));
      case 'help': return reply(addHelp(d));
      case 'helpList': return reply(staff(d.key, ['admin', 'sales'], function () { return { ok: true, requests: helpList() }; }));
      case 'helpDone': return reply(staff(d.key, ['admin', 'sales'], function () { return helpDone(d); }));
    }
    return reply({ ok: false, error: '알 수 없는 요청이에요.' });
  } catch (err) {
    return reply({ ok: false, error: '요청을 처리하지 못했어요.' });
  } finally {
    lock.releaseLock();
  }
}

// ----- 거래처 -----
function login(code, pw) {
  var c = authCustomer(code, pw);
  if (!c) return { ok: false, error: '거래처 코드나 비밀번호가 맞지 않아요.' };
  if (!c.active) return { ok: false, error: '사용 중지된 거래처예요. 담당 영업에 문의해 주세요.' };
  return { ok: true, customer: publicCustomer(c), prices: c.prices, quotes: c.quotes, discount: c.discount };
}
function authCustomer(code, pw) {
  code = clip(code, 20).toUpperCase();
  if (!code || !pw) return null;
  var c = findCustomer(code);
  return c && c.hash && c.hash === hash(code, pw) ? c : null;
}
// 거래처 고유번호: 등록 순서대로 1, 2, 3… 지운 번호는 다시 쓰지 않는다(스크립트 속성 CUST_SEQ에 마지막 번호를 기억).
// 번호 칸이 생기기 전에 등록된 거래처는 시트 줄 순서대로 번호를 붙인다.
function numberCustomers() {
  var list = customers(), seq = custSeq(list);
  var todo = list.filter(function (c) { return !c.no; });
  if (!todo.length) return list;
  var s = customerSheet(), col = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].indexOf('번호') + 1;
  todo.forEach(function (c) { c.no = ++seq; s.getRange(c.index, col).setValue(c.no); });
  PropertiesService.getScriptProperties().setProperty('CUST_SEQ', String(seq));
  return list;
}
function custSeq(list) {
  var stored = Number(PropertiesService.getScriptProperties().getProperty('CUST_SEQ')) || 0;
  return list.reduce(function (m, c) { return Math.max(m, c.no || 0); }, stored);
}
// 비밀번호(보기): 관리 화면에서 만든 비밀번호를 그대로 적어 두는 칸. 관리자 열쇠에만 돌려준다.
// 거래처가 메일 인증으로 바꾸면 PW_CHANGED로 바뀌어 더는 볼 수 없다.
var PW_CHANGED = '거래처가 바꿈';
function customerList(role) {
  return numberCustomers().sort(function (a, b) { return a.no - b.no; }).map(function (c) {
    var p = publicCustomer(c);
    if (role === 'admin') { p.pwView = c.pwView === PW_CHANGED ? '' : c.pwView; p.pwChanged = c.pwView === PW_CHANGED; }
    return p;
  });
}
function publicCustomer(c) {
  return { no: c.no, code: c.code, name: c.name, contact: c.contact, phone: c.phone, address: c.address, email: c.email, active: c.active, prices: c.prices, quotes: c.quotes, discount: c.discount, hasPassword: !!c.hash };
}
// oldCode가 있으면 그 거래처를 고친다. 코드를 바꾸면 비밀번호가 코드와 묶여 있어 새 비밀번호가 필요하고, 지난 발주의 거래처 코드도 함께 바꾼다.
function saveCustomer(c) {
  var code = clip(c.code, 20).toUpperCase(), oldCode = clip(c.oldCode, 20).toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return { ok: false, error: '거래처 코드는 영문 대문자, 숫자, -, _ 로 2~20자예요.' };
  var name = clip(c.name, 40);
  if (!name) return { ok: false, error: '거래처명이 필요해요.' };
  var pw = String(c.pw || '');
  numberCustomers();
  var ex = findCustomer(oldCode || code), renamed = !!(oldCode && oldCode !== code);
  if (oldCode && !ex) return { ok: false, error: '고치려는 거래처가 없어요. 새로고침해 주세요.' };
  if (renamed && findCustomer(code)) return { ok: false, error: '이미 있는 거래처 코드예요.' };
  if (renamed && pw.length < 4) return { ok: false, error: '거래처 코드를 바꾸면 비밀번호도 새로 정해야 해요 (4자 이상).' };
  if (!ex && pw.length < 4) return { ok: false, error: '새 거래처는 비밀번호를 4자 이상 정해 주세요.' };
  if (pw && pw.length < 4) return { ok: false, error: '비밀번호는 4자 이상이에요.' };
  var email = clip(c.email, 80);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: '메일 주소를 확인해 주세요.' };
  var discount = Number(c.discount) || 0;
  if (discount < 0 || discount >= 100) return { ok: false, error: '할인율은 0 이상 100 미만이에요.' };
  // 견적 모델: 영업 담당이 견적에서 정한 주문모델과 견적단가. 거래처 탭 '견적 모델' 칸에 [{model, price}] 글자로 저장한다
  var quotes = [], qs = Array.isArray(c.quotes) ? c.quotes.slice(0, 200) : [];
  for (var q = 0; q < qs.length; q++) {
    var qm = clip(qs[q] && qs[q].model, 60), qp = Math.round(Number(qs[q] && qs[q].price) * 10) / 10;
    if (!qm) continue;
    if (!(qp > 0)) return { ok: false, error: qm + ' 견적단가를 0보다 크게 적어 주세요.' };
    if (quotes.some(function (x) { return x.model === qm; })) return { ok: false, error: qm + ' 주문모델이 두 번 적혀 있어요.' };
    quotes.push({ model: qm, price: qp });
  }

  var s = customerSheet(), head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var row = ex ? s.getRange(ex.index, 1, 1, head.length).getValues()[0] : head.map(function () { return ''; });
  var set = function (h, v) { var i = head.indexOf(h); if (i >= 0) row[i] = v; };
  set('거래처 코드', code); set('거래처명', text(name)); set('담당자', text(clip(c.contact, 20)));
  set('연락처', c.phone ? "'" + clip(c.phone, 20) : ''); set('기본 납품 주소', text(clip(c.address, 120)));
  set('사용', c.active === false ? '중지' : '사용'); set('할인율(%)', discount ? Math.round(discount * 10) / 10 : ''); set('바뀐 시각', new Date()); set('메일', email); if (Array.isArray(c.quotes) || !ex) set('견적 모델', quotes.length ? JSON.stringify(quotes) : '');  // 견적 모델 칸이 없는 예전 화면(pomall/)이 저장하면 그대로 둔다
  if (pw) { set('비밀번호', hash(code, pw)); set('비밀번호(보기)', "'" + pw); }
  var no = ex ? ex.no : custSeq(customers()) + 1;
  if (!ex) { set('번호', no); PropertiesService.getScriptProperties().setProperty('CUST_SEQ', String(no)); }
  var prices = c.prices || {};
  head.forEach(function (h, i) {
    if (CUST_BASE.indexOf(h) >= 0 || !h) return;
    var v = Number(prices[h]);
    row[i] = v > 0 ? Math.round(v * 10) / 10 : '';
  });
  if (ex) s.getRange(ex.index, 1, 1, head.length).setValues([row]); else s.appendRow(row);
  if (renamed) {
    var os = orderSheet(), all = rows();
    for (var i = 0; i < all.length; i++) if (String(all[i][COL['거래처 코드']]) === oldCode) os.getRange(i + 2, COL['거래처 코드'] + 1).setValue(code);
  }
  return { ok: true, code: code, no: no };
}
// 거래처 탭에서 줄을 지운다. 지난 발주는 발주 탭에 그대로 남는다.
function deleteCustomer(code) {
  var c = findCustomer(clip(code, 20).toUpperCase());
  if (!c) return { ok: false, error: '없는 거래처예요.' };
  customerSheet().deleteRow(c.index);
  return { ok: true };
}
function customers() {
  var s = customerSheet(), n = s.getLastRow(), w = s.getLastColumn();
  if (n < 2) return [];
  var head = s.getRange(1, 1, 1, w).getValues()[0], data = s.getRange(2, 1, n - 1, w).getValues();
  var at = function (r, h) { var i = head.indexOf(h); return i < 0 ? '' : r[i]; };
  return data.map(function (r, k) {
    var prices = {};
    head.forEach(function (h, i) { if (h && CUST_BASE.indexOf(h) < 0 && Number(r[i]) > 0) prices[h] = Number(r[i]); });
    return { index: k + 2, no: Number(at(r, '번호')) || 0, code: String(at(r, '거래처 코드')).trim().toUpperCase(), name: String(at(r, '거래처명')), contact: String(at(r, '담당자')),
      phone: String(at(r, '연락처')), address: String(at(r, '기본 납품 주소')), email: String(at(r, '메일')).trim(), hash: String(at(r, '비밀번호')), pwView: String(at(r, '비밀번호(보기)')).replace(/^'/, ''),
      active: String(at(r, '사용')) !== '중지', discount: Number(at(r, '할인율(%)')) || 0, prices: prices, quotes: quoteList(at(r, '견적 모델')) };
  }).filter(function (c) { return c.code; });
}
function quoteList(v) {
  try { var a = JSON.parse(String(v || '[]')); return Array.isArray(a) ? a.filter(function (q) { return q && q.model && Number(q.price) > 0; }).map(function (q) { return { model: String(q.model), price: Number(q.price) }; }) : []; } catch (e) { return []; }
}
function findCustomer(code) { return customers().filter(function (c) { return c.code === code; })[0] || null; }
function hash(code, pw) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'pomall:' + code + ':' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

// ----- 발주 -----
function placeOrder(d) {
  var cust = authCustomer(d.code, d.pw);
  if (!cust || !cust.active) return { ok: false, error: '다시 로그인해 주세요.' };
  var o = d.order || {};
  var contact = clip(o.contact, 20), phone = clip(o.phone, 20), address = clip(o.address, 120);
  if (!contact || !address || digits(phone).length < 8) return { ok: false, error: '담당자, 연락처, 납품 주소가 필요해요.' };
  var items = (o.items || []).slice(0, 50);
  if (!items.length) return { ok: false, error: '담긴 품목이 없어요.' };

  var C = catalog(), lines = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    // 견적 모델 품목: 거래처에 적힌 주문모델이어야 하고, 단가는 견적단가(할인율 적용 안 함). 수량은 1EA 단위, 품목 희망납기일은 선택
    if (it.quote) {
      var qm = clip(it.model, 60), qt = (cust.quotes || []).filter(function (x) { return x.model === qm; })[0], qq = Number(it.qty), due = String(it.due || '');
      if (!qt) return { ok: false, error: qm + ' 견적 모델이 아니에요. 새로고침해 주세요.' };
      if (!(qq >= 1 && qq === Math.floor(qq))) return { ok: false, error: qm + ' 수량은 1EA 이상이에요.' };
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: qm + ' 희망납기일을 확인해 주세요.' };
      lines.push({ quote: true, code: qm, model: qm, len: 0, len2: 0, strip: 0, strip2: 0, pin: 0, speed: '', terminal: '', term: '', rtemp: '', finish: '', temp: '', qty: qq, unit: qt.price, amount: qt.price * qq, memo: clip(it.memo, 100), due: due });
      continue;
    }
    var p = findProduct(C, it.model);
    // 와이어가 없는 모델(products.json의 wires: 0)은 와이어 길이와 탈피가 없다
    var len = p && p.wires === 0 ? 0 : Math.floor(Number(it.len)), temp = Math.floor(Number(it.temp)), qty = Math.floor(Number(it.qty));
    if (!p) return { ok: false, error: '없는 모델이에요: ' + clip(it.model, 20) };
    if (!(cust.prices[p.id] > 0)) return { ok: false, error: p.id + '는 단가가 정해지지 않아 주문할 수 없어요.' };
    if (p.wires !== 0 && !okLen(C, len)) return { ok: false, error: p.id + ' 와이어 길이가 범위를 벗어났어요.' };
    // 와이어가 두 줄인 모델(products.json의 wires: 2)은 두 번째 길이도 받는다
    var len2 = p.wires === 2 ? Math.floor(Number(it.len2)) : 0;
    if (p.wires === 2 && !okLen(C, len2)) return { ok: false, error: p.id + ' 와이어 길이 2가 범위를 벗어났어요.' };
    // 마감(products.json의 finishes: T Twisted, TD Tin Dipped)은 선택 사항: 비어 있으면 '마감 없음'
    var finishes = (C.finishes || []).map(function (f) { return f.code; }), finish = p.noFinish ? '' : String(it.finish || '');
    if (finish && finishes.indexOf(finish) < 0) return { ok: false, error: p.id + ' 마감을 다시 골라 주세요.' };
    // 탈피 길이는 선택 사항(0이면 없음): 0.1mm 단위, 와이어 길이보다 짧아야 한다
    var strip = p.wires === 0 ? 0 : Number(it.strip) || 0, strip2 = p.wires === 2 ? Number(it.strip2) || 0 : 0;
    if (!okStrip(strip, len) || !okStrip(strip2, len2)) return { ok: false, error: p.id + ' 탈피 길이는 와이어 길이보다 짧게 0.1mm 단위로 적어 주세요.' };
    // 핀 모델(products.json의 pinLength: true)은 핀 길이(0.1mm 단위)가 필요하다
    var PN = C.pin || { min: 0.1, max: 1000 }, pin = p.pinLength ? Number(it.pin) || 0 : 0;
    if (p.pinLength && !(pin >= PN.min && pin <= PN.max && Math.abs(Math.round(pin * 10) - pin * 10) < 1e-9)) return { ok: false, error: p.id + ' 핀 길이는 ' + PN.min + '~' + PN.max + 'mm 사이 0.1mm 단위로 적어 주세요.' };
    // 체크박스 항목(products.json의 choices): 모델에 적힌 항목은 고를 값 중 하나가 꼭 있어야 한다
    var ch = {};
    (C.choices || []).forEach(function (g) {
      if (!(p.choices || []).some(function (k) { return k === g.key; }) || !(g.options || []).length) return;
      var v = String(it[g.key] || '');
      if (g.options.indexOf(v) < 0) ch.error = p.id + ' ' + g.name + ' 항목을 골라 주세요.'; else ch[g.key] = v;
    });
    if (ch.error) return { ok: false, error: ch.error };
    // 복귀온도 모델(products.json의 resetTemp: true)은 동작온도보다 낮은 복귀온도(tempStep 단위)가 필요하다
    var rtemp = p.resetTemp ? Number(it.rtemp) : 0;
    if (p.resetTemp && !(it.rtemp !== '' && it.rtemp != null && rtemp >= 0 && rtemp < temp && rtemp % C.tempStep === 0)) return { ok: false, error: p.id + ' 복귀온도는 동작온도보다 낮게 ' + C.tempStep + '°C 단위로 적어 주세요.' };
    if (!(temp >= p.temp[0] && temp <= p.temp[1] && temp % C.tempStep === 0)) return { ok: false, error: p.id + ' 동작온도가 범위를 벗어났어요.' };
    if (!(qty >= C.qty.min && qty % C.qty.step === 0)) return { ok: false, error: '수량은 ' + C.qty.min + 'EA 이상 ' + C.qty.step + 'EA 단위예요.' };
    var unit = unitPrice(cust.prices[p.id], cust.discount);
    lines.push({ code: specCode(p.id, len, temp, len2, finish), model: p.id, len: len, len2: len2, strip: strip, strip2: strip2, pin: pin, speed: ch.speed || '', terminal: ch.terminal || '', term: ch.term || '', rtemp: p.resetTemp ? rtemp : '', finish: finish, temp: temp, qty: qty, unit: unit, amount: unit * qty, memo: clip(it.memo, 100) });
  }
  var net = lines.reduce(function (s, l) { return s + l.amount; }, 0);
  var total = Math.round(net * (1 + C.price.vat));
  var L = lead(C), big = lines.some(function (l) { return l.qty >= L.bigQty; });
  var eta = addBizDays(big ? L.bigDays : L.days);
  var wanted = /^\d{4}-\d{2}-\d{2}$/.test(o.requestedDate || '') && o.requestedDate >= eta ? o.requestedDate : eta;

  var s = orderSheet(), now = new Date();
  if (!cust.no) cust.no = (numberCustomers().filter(function (c) { return c.code === cust.code; })[0] || {}).no;
  var no = nextOrderNo(now, cust.no);
  var file = saveAttachment(o.attachment, no, cust.name);
  if (file.error) return file;
  lines.forEach(function (l, k) {
    // 거래처가 적은 칸은 수식으로 해석되지 않도록 글자로 저장한다
    s.appendRow([no, now, cust.code, text(cust.name), text(contact), "'" + phone, text(clip(o.customerPo, 40)), text(address), text(clip(o.memo, 200)),
      "'" + wanted, "'" + eta, k + 1, text(l.code), text(l.model), l.len || '', l.temp, l.qty, l.unit, l.amount, text(l.memo), total, STATUSES[0], now, '', file.url || '', l.len2 || '', l.finish, l.strip || '', l.strip2 || '', l.pin || '', l.speed, l.terminal, l.term, l.rtemp, l.quote ? 'Y' : '', l.due ? "'" + l.due : '']);
  });
  return { ok: true, order: { no: no, total: total, eta: eta, requestedDate: wanted, attachment: file.url || '' } };
}

// 발주번호: PO-날짜-그날의 일련번호 (PO-261015-001, PO-261015-002 …). 예전 번호(PO-261015-124600-59)는 그대로 둔다.
// doPost가 잠금을 걸고 부르므로 두 발주가 같은 번호를 받지 않는다.
// 발주번호: PO-날짜-거래처번호-그날 몇 번째 발주 (예: PO-261015-1-002 = 10월 15일, 1번 거래처, 그날 회사 전체 두 번째 발주)
// 일련번호는 거래처와 상관없이 그날 전체로 센다. 거래처 번호가 생기기 전 번호(PO-261015-002)도 함께 센다.
function nextOrderNo(now, custNo) {
  var prefix = 'PO-' + Utilities.formatDate(now, 'Asia/Seoul', 'yyMMdd') + '-', max = 0;
  rows().forEach(function (r) {
    var m = String(r[COL['발주번호']]).match(/^PO-\d{6}-(?:\d+-)?(\d{3,})$/);
    if (m && String(r[COL['발주번호']]).indexOf(prefix) === 0) max = Math.max(max, Number(m[1]));
  });
  var n = String(max + 1);
  return prefix + (custNo ? custNo + '-' : '') + (n.length < 3 ? ('00' + n).slice(-3) : n);
}

// 발주서 첨부: PDF, 사진, 엑셀, 워드, 한글 파일을 10MB까지 받는다
var ATTACH_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  hwp: 'application/x-hwp', hwpx: 'application/hwp+zip' };
var ATTACH_MAX = 10 * 1024 * 1024;
function saveAttachment(a, no, company) {
  if (!a || !a.data) return {};
  var name = String(a.name || '').trim().slice(-80).replace(/[\\/:*?"<>|]/g, '_'), ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
  var type = ext && ATTACH_TYPES[ext.toLowerCase()];
  if (!type) return { ok: false, error: '발주서는 PDF, 사진, 엑셀, 워드, 한글 파일만 첨부할 수 있어요.' };
  var bytes = Utilities.base64Decode(String(a.data));
  if (bytes.length > ATTACH_MAX) return { ok: false, error: '발주서 파일은 10MB까지 첨부할 수 있어요.' };
  var f = attachFolder().createFile(Utilities.newBlob(bytes, type, no + ' ' + company + ' ' + name));
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { url: f.getUrl() };
}
function attachFolder() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('ATTACH_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder('SEKI POmall 발주서');
  p.setProperty('ATTACH_FOLDER', folder.getId());
  return folder;
}

function mine(d) {
  var cust = authCustomer(d.code, d.pw);
  if (!cust) return { ok: false, error: '다시 로그인해 주세요.' };
  // 담당자 메모는 회사 안에서만 보므로 거래처에는 보내지 않는다
  return { ok: true, orders: orders().filter(function (o) { return o.code === cust.code; }).map(function (o) { delete o.staffMemo; delete o.staffMemoBy; return o; }) };
}

// 상태 규칙 (pomall/app.js의 canMove, needsReason과 같다)
//   영업팀: 앞으로만. 출하나 취소가 된 발주는 못 바꾼다. 취소는 사유가 있어야 한다.
//   관리자: 아무 상태로나. 되돌리거나 취소된 발주를 살릴 때도 사유가 있어야 한다.
function canMove(role, from, to) {
  if (role === 'admin') return true;
  if (role !== 'sales' || from === '출하' || from === '취소') return false;
  return to === '취소' || STATUSES.indexOf(to) > STATUSES.indexOf(from);
}
function needsReason(from, to) { return to === '취소' || from === '취소' || STATUSES.indexOf(to) < STATUSES.indexOf(from); }

function setStatus(d, role) {
  var to = String(d.status || ''), by = clip(d.by, 20), reason = clip(d.reason, 200);
  if (STATUSES.indexOf(to) < 0) return { ok: false, error: '알 수 없는 상태예요.' };
  if (!by) return { ok: false, error: '바꾸는 사람 이름이 필요해요.' };
  var s = orderSheet(), all = rows(), hit = [];
  for (var i = 0; i < all.length; i++) if (String(all[i][COL['발주번호']]) === String(d.no)) hit.push(i);
  if (!hit.length) return { ok: false, error: '없는 발주예요.' };
  var from = statusOf(all[hit[0]][COL['상태']]);
  if (from === to) return { ok: false, error: '이미 ' + to + ' 상태예요. 새로고침해 주세요.' };
  if (!canMove(role, from, to)) return { ok: false, error: from + '에서 ' + to + '(으)로는 관리자만 바꿀 수 있어요.' };
  if (needsReason(from, to) && reason.length < 2) return { ok: false, error: '사유를 적어 주세요.' };
  var now = new Date();
  hit.forEach(function (i) {
    s.getRange(i + 2, COL['상태'] + 1).setValue(to);
    s.getRange(i + 2, COL['바뀐 시각'] + 1).setValue(now);
  });
  logSheet().appendRow([now, String(d.no), text(String(all[hit[0]][COL['거래처']])), from, to, text(by), ROLES[role], text(reason)]);
  return { ok: true, status: to };
}

// 담당자가 생산 일정에 맞춰 정하는 확정 출하일. 빈 값이면 지운다. 상태 기록에 남는다.
// 담당자 메모: 발주별로 회사 담당자끼리 남기는 메모(500자). 발주의 모든 줄에 같은 값을 적고, 누가 언제 고쳤는지 '메모 수정' 칸에 남긴다.
function setStaffMemo(d) {
  var by = clip(d.by, 20), memo = clip(d.memo, 500);
  if (!by) return { ok: false, error: '바꾸는 사람 이름이 필요해요.' };
  var s = orderSheet(), all = rows(), hit = [];
  for (var i = 0; i < all.length; i++) if (String(all[i][COL['발주번호']]) === String(d.no)) hit.push(i);
  if (!hit.length) return { ok: false, error: '없는 발주예요.' };
  var stampText = by + ' · ' + new Date().toISOString();
  hit.forEach(function (i) {
    s.getRange(i + 2, COL['담당자 메모'] + 1).setValue(text(memo));
    s.getRange(i + 2, COL['메모 수정'] + 1).setValue(text(stampText));
  });
  return { ok: true, by: stampText };
}
function setShipDate(d, role) {
  var date = String(d.date || ''), by = clip(d.by, 20);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '날짜 형식이 맞지 않아요.' };
  if (!by) return { ok: false, error: '바꾸는 사람 이름이 필요해요.' };
  var s = orderSheet(), all = rows(), hit = [];
  for (var i = 0; i < all.length; i++) if (String(all[i][COL['발주번호']]) === String(d.no)) hit.push(i);
  if (!hit.length) return { ok: false, error: '없는 발주예요.' };
  var before = day(all[hit[0]][COL['확정 출하일']]);
  if (before === date) return { ok: true, date: date };
  hit.forEach(function (i) { s.getRange(i + 2, COL['확정 출하일'] + 1).setValue(date ? "'" + date : ''); });
  logSheet().appendRow([new Date(), String(d.no), text(String(all[hit[0]][COL['거래처']])), '출하일 ' + (before || '미정'), '출하일 ' + (date || '미정'), text(by), ROLES[role], text(clip(d.reason, 200))]);
  return { ok: true, date: date };
}

// 생산 소요일: 관리 화면에서 바꾼 값(스크립트 속성 LEAD)이 있으면 그것을, 없으면 products.json 값을 쓴다
function lead(C) {
  var v = PropertiesService.getScriptProperties().getProperty('LEAD');
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  return (C || catalog()).lead;
}
function saveLead(d, role) {
  var L = { days: Math.floor(Number(d.days)), bigQty: Math.floor(Number(d.bigQty)), bigDays: Math.floor(Number(d.bigDays)) };
  if (!(L.days >= 1 && L.days <= 120 && L.bigDays >= 1 && L.bigDays <= 120)) return { ok: false, error: '영업일은 1~120 사이로 적어 주세요.' };
  if (!(L.bigQty >= 1)) return { ok: false, error: '대량 기준 수량을 적어 주세요.' };
  var by = clip(d.by, 20); if (!by) return { ok: false, error: '바꾸는 사람 이름이 필요해요.' };
  var old = lead();
  PropertiesService.getScriptProperties().setProperty('LEAD', JSON.stringify(L));
  var say = function (x) { return '생산 소요 ' + x.days + '영업일, ' + x.bigQty + 'EA 이상 ' + x.bigDays + '영업일'; };
  logSheet().appendRow([new Date(), '설정', '', say(old), say(L), text(by), ROLES[role], '']);
  return { ok: true, lead: L };
}

// 상태 기록을 발주번호별로 모은다 (오래된 것부터)
function statusLog() {
  var s = logSheet(), n = s.getLastRow(), map = {};
  if (n < 2) return map;
  s.getRange(2, 1, n - 1, LOG_HEADER.length).getValues().forEach(function (r) {
    var no = String(r[1]); if (!no) return;
    (map[no] = map[no] || []).push({ at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), from: String(r[3]), to: String(r[4]),
      by: String(r[5]), role: String(r[6]), reason: String(r[7]) });
  });
  return map;
}

// 시트의 줄을 발주번호별로 묶어 최신 발주가 먼저 오게 돌려준다
function orders(withLog) {
  var map = {}, keys = [], log = withLog ? statusLog() : {};
  rows().forEach(function (r) {
    var no = String(r[COL['발주번호']]);
    if (!no) return;
    if (!map[no]) {
      keys.push(no);
      map[no] = {
        no: no, createdAt: r[COL['접수 시각']] instanceof Date ? r[COL['접수 시각']].toISOString() : String(r[COL['접수 시각']]),
        code: String(r[COL['거래처 코드']]), company: String(r[COL['거래처']]), contact: String(r[COL['담당자']]), phone: String(r[COL['연락처']]),
        customerPo: String(r[COL['거래처 PO']]), address: String(r[COL['납품 주소']]), memo: String(r[COL['요청 사항']]),
        requestedDate: day(r[COL['희망 출하일']]), eta: day(r[COL['최단 출하일']]),
        total: Number(r[COL['발주 합계(VAT 포함)']]) || 0, shipDate: day(r[COL['확정 출하일']]), attachment: String(r[COL['발주서']] || ''), status: statusOf(r[COL['상태']]), items: [], log: log[no] || [],
        staffMemo: String(r[COL['담당자 메모']] || ''), staffMemoBy: String(r[COL['메모 수정']] || '')
      };
    }
    map[no].items.push({ code: String(r[COL['사양 코드']]), model: String(r[COL['모델']]), len: Number(r[COL['와이어(mm)']]), len2: Number(r[COL['와이어2(mm)']]) || 0, finish: String(r[COL['마감']] || ''),
      strip: Number(r[COL['탈피(mm)']]) || 0, strip2: Number(r[COL['탈피2(mm)']]) || 0, pin: Number(r[COL['핀 길이(mm)']]) || 0, speed: String(r[COL['전류감응속도']] || ''), terminal: String(r[COL['터미널방향']] || ''), term: String(r[COL['터미널']] || ''), rtemp: r[COL['복귀온도(°C)']] === '' || r[COL['복귀온도(°C)']] == null ? '' : Number(r[COL['복귀온도(°C)']]),
      temp: Number(r[COL['온도(°C)']]), qty: Number(r[COL['수량']]), unit: Number(r[COL['단가']]), memo: String(r[COL['품목 메모']]),
      quote: String(r[COL['견적 모델']] || '') === 'Y', due: day(r[COL['품목 희망납기일']]) });
  });
  return keys.reverse().map(function (k) { return map[k]; });
}

// 회사 서버(pomall-server)로 옮길 때 쓰는 내보내기. 관리자 열쇠로만 된다.
// 발주 줄, 거래처(암호화된 비밀번호 포함), 상태 기록, 생산 소요일, 마지막 거래처 번호를 그대로 돌려준다.
function exportAll() {
  var iso = function (v) { return v instanceof Date ? v.toISOString() : String(v || ''); };
  var orderRows = rows().filter(function (r) { return String(r[COL['발주번호']]); }).map(function (r) {
    var o = {}; HEADER.forEach(function (h, i) { o[h] = r[i] instanceof Date ? (h === '접수 시각' || h === '바뀐 시각' ? iso(r[i]) : day(r[i])) : r[i]; }); return o;
  });
  var custs = numberCustomers().map(function (c) {
    return { no: c.no, code: c.code, name: c.name, contact: c.contact, phone: c.phone, address: c.address, email: c.email, hash: c.hash, pwView: c.pwView === PW_CHANGED ? '' : c.pwView, active: c.active, discount: c.discount, prices: c.prices, quotes: c.quotes };
  });
  var s = logSheet(), n = s.getLastRow();
  var log = n < 2 ? [] : s.getRange(2, 1, n - 1, LOG_HEADER.length).getValues().map(function (r) {
    return { at: iso(r[0]), no: String(r[1]), company: String(r[2]), from: String(r[3]), to: String(r[4]), by: String(r[5]), role: String(r[6]), reason: String(r[7]) };
  });
  return { ok: true, exportedAt: new Date().toISOString(), orders: orderRows, customers: custs, log: log, lead: lead(), custSeq: custSeq(custs) };
}

// ----- 코드·비밀번호 찾기 -----
// 1단계: 등록된 메일이면 거래처 코드와 인증번호 6자리를 메일로 보낸다. 메일이 등록돼 있는지는 대답하지 않는다.
// 같은 메일로는 10분에 3번까지만 보낸다. 인증번호는 10분 동안, 5번 틀리면 못 쓴다.
function resetStart(d) {
  var email = clip(d.email, 80).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: '메일 주소를 확인해 주세요.' };
  var cache = CacheService.getScriptCache(), countKey = 'resetCount:' + email, n = Number(cache.get(countKey)) || 0;
  if (n >= 3) return { ok: true };
  cache.put(countKey, String(n + 1), 600);
  var mine = customers().filter(function (c) { return c.active && c.email.toLowerCase() === email; });
  if (!mine.length) return { ok: true };
  var otp = String(100000 + parseInt(Utilities.getUuid().replace(/\D/g, '').slice(0, 9), 10) % 900000);
  cache.put('reset:' + email, JSON.stringify({ otp: otp, tries: 0 }), 600);
  var codes = mine.map(function (c) { return c.code; }).join(', ');
  var en = d.lang === 'en';
  MailApp.sendEmail({
    to: email,
    subject: en ? '[SEKI POmall] Your customer code and verification number' : '[SEKI POmall] 거래처 코드와 인증번호',
    body: en
      ? 'Customer code: ' + codes + '\nVerification number: ' + otp + '\n\nEnter them on the SEKI POmall sign-in page within 10 minutes to set a new password.\nIf you did not ask for this, you can ignore this email.'
      : '거래처 코드: ' + codes + '\n인증번호: ' + otp + '\n\nSEKI POmall 로그인 화면에 10분 안에 넣고 새 비밀번호를 정하세요.\n요청하지 않으셨다면 이 메일은 무시하셔도 돼요.'
  });
  return { ok: true };
}
// 2단계: 인증번호가 맞으면 그 거래처의 비밀번호를 바꾼다
function resetFinish(d) {
  var email = clip(d.email, 80).toLowerCase(), cache = CacheService.getScriptCache(), key = 'reset:' + email;
  var rec = JSON.parse(cache.get(key) || 'null');
  if (!rec) return { ok: false, error: '인증번호 시간이 지났어요. 다시 받아 주세요.' };
  if (rec.tries >= 5) return { ok: false, error: '여러 번 틀렸어요. 인증번호를 다시 받아 주세요.' };
  if (String(d.otp) !== rec.otp) { rec.tries++; cache.put(key, JSON.stringify(rec), 600); return { ok: false, error: '인증번호가 맞지 않아요.' }; }
  var code = clip(d.code, 20).toUpperCase(), pw = String(d.pw || '');
  var c = customers().filter(function (x) { return x.code === code && x.active && x.email.toLowerCase() === email; })[0];
  if (!c) return { ok: false, error: '이 메일에 등록된 거래처 코드가 아니에요.' };
  if (pw.length < 4) return { ok: false, error: '비밀번호는 4자 이상이에요.' };
  var s = customerSheet(), head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  s.getRange(c.index, head.indexOf('비밀번호') + 1).setValue(hash(code, pw));
  if (head.indexOf('비밀번호(보기)') >= 0) s.getRange(c.index, head.indexOf('비밀번호(보기)') + 1).setValue(PW_CHANGED);
  s.getRange(c.index, head.indexOf('바뀐 시각') + 1).setValue(new Date());
  cache.remove(key);
  return { ok: true };
}
// 메일이 없는 거래처: 회사에 찾기 요청을 남긴다(한 시간에 30건까지)
function helpSheet() {
  var s = tab(HELP_SHEET);
  if (s.getLastRow() === 0) { s.appendRow(HELP_HEADER); s.setFrozenRows(1); }
  return s;
}
function addHelp(d) {
  var company = clip(d.company, 40), contact = clip(d.contact, 20), phone = clip(d.phone, 20);
  if (!company || !contact || digits(phone).length < 8) return { ok: false, error: '회사명, 담당자, 연락처를 모두 적어 주세요.' };
  var cache = CacheService.getScriptCache(), n = Number(cache.get('helpCount')) || 0;
  if (n >= 30) return { ok: false, error: '요청이 많아 잠시 받을 수 없어요. 담당 영업에 직접 연락해 주세요.' };
  cache.put('helpCount', String(n + 1), 3600);
  var what = { pw: 'pw', code: 'code', both: 'both' }[d.what] || 'pw';
  helpSheet().appendRow([Utilities.getUuid(), new Date(), text(company), text(contact), "'" + phone, what, text(clip(d.memo, 200)), '', '']);
  return { ok: true };
}
function helpList() {
  var s = helpSheet(), n = s.getLastRow();
  if (n < 2) return [];
  var iso = function (v) { return v instanceof Date ? v.toISOString() : String(v || ''); };
  return s.getRange(2, 1, n - 1, HELP_HEADER.length).getValues().map(function (r) {
    return { id: String(r[0]), at: iso(r[1]), company: String(r[2]), contact: String(r[3]), phone: String(r[4]).replace(/^'/, ''), what: String(r[5]), memo: String(r[6]), done: iso(r[7]), doneBy: String(r[8]) };
  }).reverse();
}
function helpDone(d) {
  var s = helpSheet(), n = s.getLastRow();
  if (n < 2) return { ok: false, error: '없는 요청이에요.' };
  var ids = s.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(d.id)) { s.getRange(i + 2, 8, 1, 2).setValues([[new Date(), text(clip(d.by, 20))]]); return { ok: true }; }
  }
  return { ok: false, error: '없는 요청이에요.' };
}

// ----- 가격 계산 (pomall/app.js와 같은 규칙) -----
function catalog() {
  var url = PropertiesService.getScriptProperties().getProperty('PRODUCTS_URL') || DEFAULT_PRODUCTS_URL;
  return JSON.parse(UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now()).getContentText());
}
function findProduct(C, id) { for (var i = 0; i < C.products.length; i++) if (C.products[i].id === id) return C.products[i]; return null; }
// 와이어가 두 줄이면 길이를 둘 다 적고, 마감은 맨 끝에 붙인다: ST-22W-L070-L100-T100-TD
function pad3(n) { n = String(n); return n.length < 3 ? ('00' + n).slice(-3) : n; }
function specCode(model, len, temp, len2, finish) {
  return model + (len ? '-L' + pad3(len) : '') + (len2 ? '-L' + pad3(len2) : '') + '-T' + pad3(temp) + (finish ? '-' + finish : '');
}
function okStrip(v, len) { return v === 0 || (v > 0 && v < len && Math.abs(Math.round(v * 10) - v * 10) < 1e-9); }
function okLen(C, v) { return v >= C.length.min && v <= C.length.max && v % C.length.step === 0; }
function unitPrice(base, discount) { return Math.round(base * (1 - (discount || 0) / 100) * 10) / 10; }
function addBizDays(n) {
  var d = new Date(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd') + 'T00:00:00'), k = 0;
  while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) k++; }
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

// ----- 시트 -----
function tab(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
// 발주 탭: 칸이 늘면(예: 확정 출하일) 머리글 줄 뒤에 이름을 붙인다
function orderSheet() {
  var s = tab(ORDER_SHEET);
  if (s.getLastRow() === 0) { s.appendRow(HEADER); s.setFrozenRows(1); return s; }
  var w = s.getLastColumn();
  if (w < HEADER.length) s.getRange(1, w + 1, 1, HEADER.length - w).setValues([HEADER.slice(w)]);
  return s;
}
// 거래처 탭: 기본 칸 뒤에 products.json의 모델마다 단가 칸을 둔다. 모델이나 기본 칸이 늘면 뒤에 붙는다.
function customerSheet() {
  var s = tab(CUSTOMER_SHEET);
  if (s.getLastRow() === 0) { s.appendRow(CUST_BASE); s.setFrozenRows(1); }
  var head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var models = catalog().products.map(function (p) { return p.id; });
  var missing = CUST_BASE.concat(models).filter(function (m) { return head.indexOf(m) < 0; });
  if (missing.length) s.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
  return s;
}
function rows() {
  var s = orderSheet(), n = s.getLastRow();
  return n < 2 ? [] : s.getRange(2, 1, n - 1, HEADER.length).getValues();
}
function logSheet() {
  var s = tab(LOG_SHEET);
  if (s.getLastRow() === 0) { s.appendRow(LOG_HEADER); s.setFrozenRows(1); }
  return s;
}
// 열쇠로 권한을 정한다. 같은 값이면 높은 권한이 먼저다.
function roleOf(key) {
  key = String(key || '');
  if (!key) return null;
  var p = PropertiesService.getScriptProperties();
  if (key === p.getProperty('ADMIN_KEY')) return 'admin';
  if (key === p.getProperty('SALES_KEY')) return 'sales';
  if (key === p.getProperty('VIEW_KEY')) return 'view';
  return null;
}
function staff(key, allowed, fn) {
  var role = roleOf(key);
  if (!role) return { ok: false, error: '열쇠가 맞지 않아요.' };
  if (allowed.indexOf(role) < 0) return { ok: false, error: ROLES[role] + ' 열쇠로는 할 수 없어요. ' + (allowed[0] === 'admin' && allowed.length === 1 ? '관리자' : '영업팀') + ' 권한이 필요해요.' };
  return fn(role);
}
function day(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v || ''); }
function digits(v) { return String(v || '').replace(/\D/g, ''); }
function clip(v, n) { return String(v || '').trim().slice(0, n); }
function text(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
