// 값매김 상점: 가격 제안 받기 (구글 시트용 Apps Script)
// 손님이 상품에 가격을 제안하면 이 시트에 한 줄씩 쌓이고, 판매자가 수락하거나 거절합니다.
// 판매자 열쇠는 Apps Script > 프로젝트 설정 > 스크립트 속성에 ADMIN_KEY로 넣어 둡니다.
// 상품이 있는지, 제안을 받는 중인지는 손님 브라우저가 아니라 저장소의 offer/products.json으로 다시 확인합니다.

var PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/offer/products.json';
var HEADER = ['제안번호', '제안 시각', '상품ID', '상품', '판매자', '수량', '제안 단가', '합계', '이름', '연락처', '받는 곳', '남긴 말', '상태', '바뀐 시각'];
var COL = { no: 0, at: 1, pid: 2, product: 3, seller: 4, qty: 5, price: 6, total: 7, name: 8, phone: 9, place: 10, memo: 11, status: 12, changed: 13 };
var WAIT = '검토 중', YES = '수락', NO = '거절', CANCEL = '취소';
var MIN_PRICE = 100, MAX_PRICE = 100000000;

// 읽기: 상품별 요약(누구나), 내 제안 확인(제안번호+연락처), 받은 제안 전체(판매자 열쇠)
function doGet(e) {
  var q = (e && e.parameter) || {};
  try {
    if (q.action === 'mine') return reply(mine(q.no, q.phone));
    if (q.action === 'list') {
      if (!isAdmin(q.key)) return reply({ ok: false, error: '판매자 열쇠가 맞지 않아요.' });
      return reply({ ok: true, offers: rows().map(toOffer).reverse() });
    }
    return reply({ ok: true, items: summary() });
  } catch (err) {
    return reply({ ok: false, error: '제안 목록을 읽지 못했어요.' });
  }
}

// 쓰기: 제안하기(누구나), 제안 취소(제안번호+연락처), 수락/거절(판매자 열쇠)
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === 'decide') return reply(decide(d));
    if (d.action === 'cancel') return reply(cancel(d.no, d.phone));
    return reply(offer(d));
  } catch (err) {
    return reply({ ok: false, error: '제안을 저장하지 못했어요.' });
  } finally {
    lock.releaseLock();
  }
}

function offer(d) {
  var name = clip(d.name, 20), phone = clip(d.phone, 20);
  if (!name || digits(phone).length < 8) return { ok: false, error: '이름과 연락처가 필요해요.' };
  var price = Math.floor(Number(d.price) || 0);
  if (price < MIN_PRICE || price > MAX_PRICE) return { ok: false, error: '제안 가격은 100원부터 1억 원까지 적을 수 있어요.' };
  var qty = Math.max(1, Math.min(99, Math.floor(Number(d.qty) || 1)));

  var list = JSON.parse(UrlFetchApp.fetch(PRODUCTS_URL + '?t=' + Date.now()).getContentText()).products || [];
  var p = null;
  list.forEach(function (it) { if (it.id === d.id) p = it; });
  if (!p) return { ok: false, error: '없는 상품이에요.' };
  if (p.closed) return { ok: false, error: '이 상품은 제안을 마감했어요.' };

  var s = sheet();
  var no = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
  // 수식으로 해석되지 않도록 손님이 적은 칸은 글자로 저장한다
  s.appendRow([no, new Date(), p.id, text(p.name), text(p.seller || ''), qty, price, price * qty, text(name), "'" + phone,
    text(clip(d.place, 100)), text(clip(d.memo, 200)), WAIT, new Date()]);
  return { ok: true, no: no, price: price, qty: qty, total: price * qty };
}

function mine(no, phone) {
  var r = find(no);
  if (!r || digits(r.row[COL.phone]) !== digits(phone) || !digits(phone)) return { ok: false, error: '제안번호와 연락처가 맞는 제안이 없어요.' };
  var o = toOffer(r.row);
  return { ok: true, offer: { no: o.no, at: o.at, product: o.product, qty: o.qty, price: o.price, total: o.total, status: o.status } };
}

function cancel(no, phone) {
  var r = find(no);
  if (!r || digits(r.row[COL.phone]) !== digits(phone) || !digits(phone)) return { ok: false, error: '제안번호와 연락처가 맞는 제안이 없어요.' };
  if (r.row[COL.status] !== WAIT) return { ok: false, error: '판매자가 이미 답한 제안은 취소할 수 없어요.' };
  setStatus(r.index, CANCEL);
  return { ok: true, status: CANCEL };
}

function decide(d) {
  if (!isAdmin(d.key)) return { ok: false, error: '판매자 열쇠가 맞지 않아요.' };
  if ([YES, NO, WAIT].indexOf(d.status) < 0) return { ok: false, error: '알 수 없는 결정이에요.' };
  var r = find(d.no);
  if (!r) return { ok: false, error: '없는 제안이에요.' };
  if (r.row[COL.status] === CANCEL) return { ok: false, error: '손님이 취소한 제안이에요.' };
  setStatus(r.index, d.status);
  return { ok: true, status: d.status };
}

// 상품별로 살아 있는 제안(검토 중, 수락) 수와 가장 높은 단가, 수락한 수
function summary() {
  var out = {};
  rows().forEach(function (row) {
    var st = row[COL.status], pid = String(row[COL.pid]);
    if (st !== WAIT && st !== YES) return;
    var s = out[pid] || (out[pid] = { count: 0, top: 0, accepted: 0 });
    s.count++;
    s.top = Math.max(s.top, Number(row[COL.price]) || 0);
    if (st === YES) s.accepted++;
  });
  return out;
}

function sheet() {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (s.getLastRow() === 0) s.appendRow(HEADER);
  return s;
}
function rows() {
  var s = sheet(), n = s.getLastRow();
  return n < 2 ? [] : s.getRange(2, 1, n - 1, HEADER.length).getValues();
}
function find(no) {
  no = String(no || '');
  if (!no) return null;
  var all = rows();
  for (var i = 0; i < all.length; i++) if (String(all[i][COL.no]) === no) return { index: i + 2, row: all[i] };
  return null;
}
function setStatus(rowIndex, status) {
  var s = sheet();
  s.getRange(rowIndex, COL.status + 1).setValue(status);
  s.getRange(rowIndex, COL.changed + 1).setValue(new Date());
}
function toOffer(row) {
  return {
    no: String(row[COL.no]), at: row[COL.at] instanceof Date ? row[COL.at].toISOString() : String(row[COL.at]),
    pid: String(row[COL.pid]), product: String(row[COL.product]), seller: String(row[COL.seller]),
    qty: Number(row[COL.qty]) || 1, price: Number(row[COL.price]) || 0, total: Number(row[COL.total]) || 0,
    name: String(row[COL.name]), phone: String(row[COL.phone]), place: String(row[COL.place]), memo: String(row[COL.memo]),
    status: String(row[COL.status] || WAIT)
  };
}

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
