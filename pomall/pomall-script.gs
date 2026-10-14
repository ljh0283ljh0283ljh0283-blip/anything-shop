// SEKI POmall 발주: 거래처 로그인, 거래처별 단가, 발주를 구글 시트에 두는 Apps Script
// 시트 탭 세 개를 씁니다. 없으면 처음 쓸 때 만들어집니다.
//   발주    발주 한 건의 품목마다 한 줄 (같은 발주번호). 생산 현장에서 줄 단위로 보기 쉽게 하려는 것입니다.
//   상태 기록  상태를 바꿀 때마다 한 줄: 누가, 언제, 무엇에서 무엇으로, 왜(취소나 되돌리기).
//   거래처  거래처 코드, 비밀번호(암호화), 사용 여부, 할인율(%), 모델마다 한 칸씩 단가(원/EA, 부가세 별도). 빈 칸은 "단가 문의".
//           최종 단가 = 모델 단가 × (1 - 할인율/100). 할인율이 비어 있으면 적은 단가 그대로입니다.
//           단가는 사이트의 관리 > 거래처 단가에서 고치는 것이 기본이지만, 이 시트에서 직접 고쳐도 됩니다.
// 스크립트 속성(프로젝트 설정 > 스크립트 속성)
//   ADMIN_KEY     관리자 열쇠. 모든 일을 합니다: 거래처 단가, 상태 되돌리기, 취소된 발주 살리기.
//   SALES_KEY     영업팀 열쇠. 발주를 보고 상태를 앞으로만 바꿉니다(접수 대기 → 생산 확정 → 생산 중 → 출하 완료). 취소는 사유를 적어야 합니다.
//   VIEW_KEY      조회 전용 열쇠(선택). 생산, 물류 같은 다른 팀이 발주와 상태를 보기만 합니다.
//   열쇠를 아는 사람이 팀을 떠나면 그 열쇠 값만 바꾸면 됩니다.
//   PRODUCTS_URL  products.json 주소. 저장소를 옮기면 이 값만 바꾸면 됩니다.
// 금액은 거래처 브라우저가 보낸 값을 믿지 않고 시트의 거래처 단가와 할인율로 다시 계산합니다.

var DEFAULT_PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/pomall/products.json';
var ORDER_SHEET = '발주', CUSTOMER_SHEET = '거래처', LOG_SHEET = '상태 기록';
var LOG_HEADER = ['시각', '발주번호', '거래처', '이전 상태', '바뀐 상태', '변경자', '권한', '사유'];
var ROLES = { admin: '관리자', sales: '영업팀', view: '조회 전용' };
var HEADER = ['발주번호', '접수 시각', '거래처 코드', '거래처', '담당자', '연락처', '거래처 PO', '납품 주소', '요청 사항', '희망 출하일', '최단 출하일',
  '줄', '사양 코드', '모델', '와이어(mm)', '온도(°C)', '수량', '단가', '금액', '품목 메모', '발주 합계(VAT 포함)', '상태', '바뀐 시각'];
var COL = {}; HEADER.forEach(function (h, i) { COL[h] = i; });
var CUST_BASE = ['거래처 코드', '거래처명', '담당자', '연락처', '기본 납품 주소', '비밀번호', '사용', '할인율(%)', '바뀐 시각'];
var STATUSES = ['접수 대기', '생산 확정', '생산 중', '출하 완료', '취소'];

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
      case 'staff': return reply(staff(d.key, ['admin', 'sales', 'view'], function (role) { return { ok: true, role: role }; }));
      case 'list': return reply(staff(d.key, ['admin', 'sales', 'view'], function () { return { ok: true, orders: orders(true) }; }));
      case 'status': return reply(staff(d.key, ['admin', 'sales'], function (role) { return setStatus(d, role); }));
      case 'customers': return reply(staff(d.key, ['admin'], function () { return { ok: true, customers: customerList() }; }));
      case 'saveCustomer': return reply(staff(d.key, ['admin'], function () { return saveCustomer(d.customer || {}); }));
      case 'deleteCustomer': return reply(staff(d.key, ['admin'], function () { return deleteCustomer(d.code); }));
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
  return { ok: true, customer: publicCustomer(c), prices: c.prices, discount: c.discount };
}
function authCustomer(code, pw) {
  code = clip(code, 20).toUpperCase();
  if (!code || !pw) return null;
  var c = findCustomer(code);
  return c && c.hash && c.hash === hash(code, pw) ? c : null;
}
function customerList() { return customers().map(publicCustomer); }
function publicCustomer(c) {
  return { code: c.code, name: c.name, contact: c.contact, phone: c.phone, address: c.address, active: c.active, prices: c.prices, discount: c.discount, hasPassword: !!c.hash };
}
// oldCode가 있으면 그 거래처를 고친다. 코드를 바꾸면 비밀번호가 코드와 묶여 있어 새 비밀번호가 필요하고, 지난 발주의 거래처 코드도 함께 바꾼다.
function saveCustomer(c) {
  var code = clip(c.code, 20).toUpperCase(), oldCode = clip(c.oldCode, 20).toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return { ok: false, error: '거래처 코드는 영문 대문자, 숫자, -, _ 로 2~20자예요.' };
  var name = clip(c.name, 40);
  if (!name) return { ok: false, error: '거래처명이 필요해요.' };
  var pw = String(c.pw || '');
  var ex = findCustomer(oldCode || code), renamed = !!(oldCode && oldCode !== code);
  if (oldCode && !ex) return { ok: false, error: '고치려는 거래처가 없어요. 새로고침해 주세요.' };
  if (renamed && findCustomer(code)) return { ok: false, error: '이미 있는 거래처 코드예요.' };
  if (renamed && pw.length < 4) return { ok: false, error: '거래처 코드를 바꾸면 비밀번호도 새로 정해야 해요 (4자 이상).' };
  if (!ex && pw.length < 4) return { ok: false, error: '새 거래처는 비밀번호를 4자 이상 정해 주세요.' };
  if (pw && pw.length < 4) return { ok: false, error: '비밀번호는 4자 이상이에요.' };
  var discount = Number(c.discount) || 0;
  if (discount < 0 || discount >= 100) return { ok: false, error: '할인율은 0 이상 100 미만이에요.' };

  var s = customerSheet(), head = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var row = ex ? s.getRange(ex.index, 1, 1, head.length).getValues()[0] : head.map(function () { return ''; });
  var set = function (h, v) { var i = head.indexOf(h); if (i >= 0) row[i] = v; };
  set('거래처 코드', code); set('거래처명', text(name)); set('담당자', text(clip(c.contact, 20)));
  set('연락처', c.phone ? "'" + clip(c.phone, 20) : ''); set('기본 납품 주소', text(clip(c.address, 120)));
  set('사용', c.active === false ? '중지' : '사용'); set('할인율(%)', discount ? Math.round(discount * 10) / 10 : ''); set('바뀐 시각', new Date());
  if (pw) set('비밀번호', hash(code, pw));
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
  return { ok: true, code: code };
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
    return { index: k + 2, code: String(at(r, '거래처 코드')).trim().toUpperCase(), name: String(at(r, '거래처명')), contact: String(at(r, '담당자')),
      phone: String(at(r, '연락처')), address: String(at(r, '기본 납품 주소')), hash: String(at(r, '비밀번호')),
      active: String(at(r, '사용')) !== '중지', discount: Number(at(r, '할인율(%)')) || 0, prices: prices };
  }).filter(function (c) { return c.code; });
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
    var it = items[i], p = findProduct(C, it.model);
    var len = Math.floor(Number(it.len)), temp = Math.floor(Number(it.temp)), qty = Math.floor(Number(it.qty));
    if (!p) return { ok: false, error: '없는 모델이에요: ' + clip(it.model, 20) };
    if (!(cust.prices[p.id] > 0)) return { ok: false, error: p.id + '는 단가가 정해지지 않아 주문할 수 없어요.' };
    if (!(len >= C.length.min && len <= C.length.max && len % C.length.step === 0)) return { ok: false, error: p.id + ' 와이어 길이가 범위를 벗어났어요.' };
    if (!(temp >= p.temp[0] && temp <= p.temp[1] && temp % C.tempStep === 0)) return { ok: false, error: p.id + ' 동작온도가 범위를 벗어났어요.' };
    if (!(qty >= C.qty.min && qty % C.qty.step === 0)) return { ok: false, error: '수량은 ' + C.qty.min + 'EA 이상 ' + C.qty.step + 'EA 단위예요.' };
    var unit = unitPrice(cust.prices[p.id], cust.discount);
    lines.push({ code: specCode(p.id, len, temp), model: p.id, len: len, temp: temp, qty: qty, unit: unit, amount: unit * qty, memo: clip(it.memo, 100) });
  }
  var net = lines.reduce(function (s, l) { return s + l.amount; }, 0);
  var total = Math.round(net * (1 + C.price.vat));
  var big = lines.some(function (l) { return l.qty >= C.lead.bigQty; });
  var eta = addBizDays(big ? C.lead.bigDays : C.lead.days);
  var wanted = /^\d{4}-\d{2}-\d{2}$/.test(o.requestedDate || '') && o.requestedDate >= eta ? o.requestedDate : eta;

  var s = orderSheet(), now = new Date();
  var no = 'PO-' + Utilities.formatDate(now, 'Asia/Seoul', 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
  lines.forEach(function (l, k) {
    // 거래처가 적은 칸은 수식으로 해석되지 않도록 글자로 저장한다
    s.appendRow([no, now, cust.code, text(cust.name), text(contact), "'" + phone, text(clip(o.customerPo, 40)), text(address), text(clip(o.memo, 200)),
      "'" + wanted, "'" + eta, k + 1, l.code, l.model, l.len, l.temp, l.qty, l.unit, l.amount, text(l.memo), total, STATUSES[0], now]);
  });
  return { ok: true, order: { no: no, total: total, eta: eta, requestedDate: wanted } };
}

function mine(d) {
  var cust = authCustomer(d.code, d.pw);
  if (!cust) return { ok: false, error: '다시 로그인해 주세요.' };
  return { ok: true, orders: orders().filter(function (o) { return o.code === cust.code; }) };
}

// 상태 규칙 (pomall/app.js의 canMove, needsReason과 같다)
//   영업팀: 앞으로만. 출하 완료나 취소가 된 발주는 못 바꾼다. 취소는 사유가 있어야 한다.
//   관리자: 아무 상태로나. 되돌리거나 취소된 발주를 살릴 때도 사유가 있어야 한다.
function canMove(role, from, to) {
  if (role === 'admin') return true;
  if (role !== 'sales' || from === '출하 완료' || from === '취소') return false;
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
  var from = String(all[hit[0]][COL['상태']] || STATUSES[0]);
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
        total: Number(r[COL['발주 합계(VAT 포함)']]) || 0, status: String(r[COL['상태']] || STATUSES[0]), items: [], log: log[no] || []
      };
    }
    map[no].items.push({ code: String(r[COL['사양 코드']]), model: String(r[COL['모델']]), len: Number(r[COL['와이어(mm)']]),
      temp: Number(r[COL['온도(°C)']]), qty: Number(r[COL['수량']]), unit: Number(r[COL['단가']]), memo: String(r[COL['품목 메모']]) });
  });
  return keys.reverse().map(function (k) { return map[k]; });
}

// ----- 가격 계산 (pomall/app.js와 같은 규칙) -----
function catalog() {
  var url = PropertiesService.getScriptProperties().getProperty('PRODUCTS_URL') || DEFAULT_PRODUCTS_URL;
  return JSON.parse(UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now()).getContentText());
}
function findProduct(C, id) { for (var i = 0; i < C.products.length; i++) if (C.products[i].id === id) return C.products[i]; return null; }
function specCode(model, len, temp) { return model + '-L' + ('00' + len).slice(-3) + '-T' + ('00' + temp).slice(-3); }
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
function orderSheet() {
  var s = tab(ORDER_SHEET);
  if (s.getLastRow() === 0) { s.appendRow(HEADER); s.setFrozenRows(1); }
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
