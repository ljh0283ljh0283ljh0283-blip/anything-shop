// SEKI POmall 발주: 거래처 발주를 구글 시트에 쌓는 Apps Script
// 발주 한 건의 품목마다 한 줄씩 쌓입니다(같은 발주번호). 생산 현장에서 줄 단위로 보기 쉽게 하려는 것입니다.
// 스크립트 속성(프로젝트 설정 > 스크립트 속성)
//   ADMIN_KEY     관리자 열쇠. 접수 관리 화면에서 발주를 보고 상태를 바꿀 때 씁니다.
//   PRODUCTS_URL  products.json 주소. 저장소를 옮기면 이 값만 바꾸면 됩니다.
// 금액은 손님 브라우저가 보낸 값을 믿지 않고 products.json으로 다시 계산합니다.

var DEFAULT_PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/pomall/products.json';
var HEADER = ['발주번호', '접수 시각', '거래처', '담당자', '연락처', '거래처 PO', '납품 주소', '요청 사항', '희망 출하일', '최단 출하일',
  '줄', '사양 코드', '모델', '와이어(mm)', '온도(°C)', '수량', '단가', '금액', '품목 메모', '발주 합계(VAT 포함)', '상태', '바뀐 시각'];
var COL = {}; HEADER.forEach(function (h, i) { COL[h] = i; });
var STATUSES = ['접수 대기', '생산 확정', '생산 중', '출하 완료', '취소'];

function doGet(e) {
  var q = (e && e.parameter) || {};
  try {
    if (q.action === 'mine') return reply(mine(q.company, q.phone));
    if (q.action === 'list') {
      if (!isAdmin(q.key)) return reply({ ok: false, error: '관리자 열쇠가 맞지 않아요.' });
      return reply({ ok: true, orders: orders() });
    }
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: '발주 목록을 읽지 못했어요.' });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === 'status') return reply(setStatus(d));
    if (d.action === 'order') return reply(placeOrder(d.order || {}));
    return reply({ ok: false, error: '알 수 없는 요청이에요.' });
  } catch (err) {
    return reply({ ok: false, error: '발주를 저장하지 못했어요.' });
  } finally {
    lock.releaseLock();
  }
}

function placeOrder(o) {
  var company = clip(o.company, 40), contact = clip(o.contact, 20), phone = clip(o.phone, 20), address = clip(o.address, 120);
  if (!company || !contact || !address || digits(phone).length < 8) return { ok: false, error: '거래처명, 담당자, 연락처, 납품 주소가 필요해요.' };
  var items = (o.items || []).slice(0, 50);
  if (!items.length) return { ok: false, error: '담긴 품목이 없어요.' };

  var C = catalog(), lines = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i], p = findProduct(C, it.model);
    var len = Math.floor(Number(it.len)), temp = Math.floor(Number(it.temp)), qty = Math.floor(Number(it.qty));
    if (!p) return { ok: false, error: '없는 모델이에요: ' + clip(it.model, 20) };
    if (!(len >= C.length.min && len <= C.length.max && len % C.length.step === 0)) return { ok: false, error: p.id + ' 와이어 길이가 범위를 벗어났어요.' };
    if (!(temp >= p.temp[0] && temp <= p.temp[1] && temp % C.tempStep === 0)) return { ok: false, error: p.id + ' 동작온도가 범위를 벗어났어요.' };
    if (!(qty >= C.qty.min && qty % C.qty.step === 0)) return { ok: false, error: '수량은 ' + C.qty.min + 'EA 이상 ' + C.qty.step + 'EA 단위예요.' };
    var unit = unitPrice(C, p, len, temp, qty);
    lines.push({ code: specCode(p.id, len, temp), model: p.id, len: len, temp: temp, qty: qty, unit: unit, amount: unit * qty, memo: clip(it.memo, 100) });
  }
  var net = lines.reduce(function (s, l) { return s + l.amount; }, 0);
  var total = Math.round(net * (1 + C.price.vat));
  var big = lines.some(function (l) { return l.qty >= C.lead.bigQty; });
  var eta = addBizDays(big ? C.lead.bigDays : C.lead.days);
  var wanted = /^\d{4}-\d{2}-\d{2}$/.test(o.requestedDate || '') && o.requestedDate >= eta ? o.requestedDate : eta;

  var s = sheet(), now = new Date();
  var no = 'PO-' + Utilities.formatDate(now, 'Asia/Seoul', 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
  lines.forEach(function (l, k) {
    // 손님이 적은 칸은 수식으로 해석되지 않도록 글자로 저장한다
    s.appendRow([no, now, text(company), text(contact), "'" + phone, text(clip(o.customerPo, 40)), text(address), text(clip(o.memo, 200)),
      "'" + wanted, "'" + eta, k + 1, l.code, l.model, l.len, l.temp, l.qty, l.unit, l.amount, text(l.memo), total, STATUSES[0], now]);
  });
  return { ok: true, order: { no: no, total: total, eta: eta, requestedDate: wanted } };
}

function mine(company, phone) {
  company = clip(company, 40); phone = digits(phone);
  if (!company || phone.length < 8) return { ok: false, error: '거래처명과 연락처를 적어 주세요.' };
  var list = orders().filter(function (o) { return o.company === company && digits(o.phone) === phone; });
  return { ok: true, orders: list };
}

function setStatus(d) {
  if (!isAdmin(d.key)) return { ok: false, error: '관리자 열쇠가 맞지 않아요.' };
  if (STATUSES.indexOf(d.status) < 0) return { ok: false, error: '알 수 없는 상태예요.' };
  var s = sheet(), all = rows(), n = 0, now = new Date();
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][COL['발주번호']]) !== String(d.no)) continue;
    s.getRange(i + 2, COL['상태'] + 1).setValue(d.status);
    s.getRange(i + 2, COL['바뀐 시각'] + 1).setValue(now);
    n++;
  }
  return n ? { ok: true, status: d.status } : { ok: false, error: '없는 발주예요.' };
}

// 시트의 줄을 발주번호별로 묶어 최신 발주가 먼저 오게 돌려준다
function orders() {
  var map = {}, keys = [];
  rows().forEach(function (r) {
    var no = String(r[COL['발주번호']]);
    if (!no) return;
    if (!map[no]) {
      keys.push(no);
      map[no] = {
        no: no, createdAt: r[COL['접수 시각']] instanceof Date ? r[COL['접수 시각']].toISOString() : String(r[COL['접수 시각']]),
        company: String(r[COL['거래처']]), contact: String(r[COL['담당자']]), phone: String(r[COL['연락처']]),
        customerPo: String(r[COL['거래처 PO']]), address: String(r[COL['납품 주소']]), memo: String(r[COL['요청 사항']]),
        requestedDate: day(r[COL['희망 출하일']]), eta: day(r[COL['최단 출하일']]),
        total: Number(r[COL['발주 합계(VAT 포함)']]) || 0, status: String(r[COL['상태']] || STATUSES[0]), items: []
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
function unitPrice(C, p, len, temp, qty) {
  var r = C.price, u = p.base + Math.max(0, (len - r.wireBaseMm) / 10) * r.wirePer10mm;
  if (temp > r.highTempOver) u *= 1 + r.highTempRate;
  for (var i = 0; i < r.volume.length; i++) if (qty >= r.volume[i].min) { u *= 1 - r.volume[i].off; break; }
  return Math.round(u * 10) / 10;
}
function addBizDays(n) {
  var d = new Date(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd') + 'T00:00:00'), k = 0;
  while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) k++; }
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

// ----- 시트 -----
function sheet() {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (s.getLastRow() === 0) { s.appendRow(HEADER); s.setFrozenRows(1); }
  return s;
}
function rows() {
  var s = sheet(), n = s.getLastRow();
  return n < 2 ? [] : s.getRange(2, 1, n - 1, HEADER.length).getValues();
}
function day(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v || ''); }
function isAdmin(key) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!real && String(key || '') === real;
}
function digits(v) { return String(v || '').replace(/\D/g, ''); }
function clip(v, n) { return String(v || '').trim().slice(0, n); }
function text(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
