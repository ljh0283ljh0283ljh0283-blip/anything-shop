// 어떻게든 팔거야: 가격 제안 받기 (구글 시트용 Apps Script)
// 손님이 상품에 가격을 제안하면 이 시트에 한 줄씩 쌓이고, 판매자가 수락하거나 거절합니다.
// 판매자 열쇠는 Apps Script > 프로젝트 설정 > 스크립트 속성에 ADMIN_KEY로 넣어 둡니다.
// 상품이 있는지, 제안을 받는 중인지는 손님 브라우저가 아니라 저장소의 offer/products.json과 "판매자 상품" 탭으로 다시 확인합니다.
// 판매자는 무엇이든 상점과 같은 판매자 계정을 쓴다. 로그인 열쇠는 무엇이든 상점 시트 스크립트(MAIN_URL)에 물어 확인한다.

var PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/offer/products.json';
var MAIN_URL = 'https://script.google.com/macros/s/AKfycbzn-AQEKTQA87p5i88l7l1CbsdAUQCfHBwUkeHVwSKVG7O-S8Pf5a6ZHZI0XIBREojoWw/exec';
var OWN_SELLER = '빨간도령';   // 판매자 칸이 빈 상품(운영자가 올린 상품)의 판매자
var HEADER = ['제안번호', '제안 시각', '상품ID', '상품', '판매자', '수량', '제안 단가', '합계', '이름', '연락처', '받는 곳', '남긴 말', '상태', '바뀐 시각', '입금 계좌'];
var COL = { no: 0, at: 1, pid: 2, product: 3, seller: 4, qty: 5, price: 6, total: 7, name: 8, phone: 9, place: 10, memo: 11, status: 12, changed: 13, bank: 14 };
// 판매자가 직접 올린 상품("판매자 상품" 탭)
var ITEM_SHEET = '판매자 상품';
var ITEM_HEADER = ['상품ID', '올린 시각', '판매자', '분류', '상품', '단위', '설명', '상태', '마감', '바뀐 시각'];
var I = { id: 0, at: 1, seller: 2, cat: 3, name: 4, unit: 5, desc: 6, status: 7, closed: 8, changed: 9 };
var SHOWN = '게시', HIDDEN = '내림';
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
    return reply({ ok: true, items: summary(), products: publicItems() });
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
    if (d.action === 'adminSales') return reply(isAdmin(d.key) ? { ok: true, sales: salesRows() } : { ok: false, error: '관리자 열쇠가 맞지 않아요.' });
    if (/^seller/.test(d.action || '')) return reply(sellerAction(d));
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

  var list = (JSON.parse(UrlFetchApp.fetch(PRODUCTS_URL + '?t=' + Date.now()).getContentText()).products || []).concat(publicItems());
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
  return { ok: true, offer: { no: o.no, at: o.at, product: o.product, qty: o.qty, price: o.price, total: o.total, status: o.status, bank: o.status === YES ? o.bank : null } };
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
  else if (!s.getRange(1, HEADER.length).getValue()) s.getRange(1, HEADER.length).setValue(HEADER[HEADER.length - 1]);
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

// ---------- 판매자 (무엇이든 상점 판매자 계정) ----------
// 로그인 열쇠를 무엇이든 상점 시트에 물어 판매자 이름과 계좌를 받는다. 10분 동안 기억한다.
function sellerOf(key) {
  key = String(key || '');
  if (key.length < 8) return null;
  var cache = CacheService.getScriptCache();
  var ck = 'me:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key));
  var got = cache.get(ck);
  if (got) return JSON.parse(got);
  var res = JSON.parse(UrlFetchApp.fetch(MAIN_URL, { method: 'post', contentType: 'text/plain', payload: JSON.stringify({ action: 'sellerMe', key: key }), muteHttpExceptions: true }).getContentText());
  if (!res || !res.ok || !res.nick) return null;
  var me = { nick: String(res.nick), bank: res.bank || null };
  cache.put(ck, JSON.stringify(me), 600);
  return me;
}

function sellerAction(d) {
  var me = sellerOf(d.key);
  if (!me) return { ok: false, error: '다시 로그인해 주세요.' };
  var mineRows = function () { return rows().filter(function (row) { return String(row[COL.seller]) === me.nick; }); };
  if (d.action === 'sellerMe') return { ok: true, nick: me.nick };
  if (d.action === 'sellerOffers') return { ok: true, offers: mineRows().map(toOffer).reverse() };
  if (d.action === 'sellerSales') return { ok: true, sales: salesRows().filter(function (r) { return r.seller === me.nick; }) };
  if (d.action === 'sellerItems') return { ok: true, items: itemRows().filter(function (r) { return String(r.row[I.seller]) === me.nick; }).map(function (r) { return toItem(r.row, true); }) };
  if (d.action === 'sellerDecide') {
    if ([YES, NO, WAIT].indexOf(d.status) < 0) return { ok: false, error: '알 수 없는 결정이에요.' };
    var r = find(d.no);
    if (!r || String(r.row[COL.seller]) !== me.nick) return { ok: false, error: '내 상품에 온 제안이 아니에요.' };
    if (r.row[COL.status] === CANCEL) return { ok: false, error: '손님이 취소한 제안이에요.' };
    setStatus(r.index, d.status);
    // 수락하면 손님이 내 제안에서 볼 입금 계좌를 붙여 둔다
    if (d.status === YES) sheet().getRange(r.index, COL.bank + 1).setValue(me.bank ? JSON.stringify(me.bank) : '');
    return { ok: true, status: d.status };
  }
  if (d.action === 'sellerSave') {
    var p = d.item || {};
    var name = clip(p.name, 40), cat = clip(p.cat, 12);
    if (!name || !cat) return { ok: false, error: '상품 이름과 분류를 적어 주세요.' };
    var values = [text(cat), text(name), text(clip(p.unit, 20)), text(clip(p.desc, 400))];
    var is = itemSheet();
    if (d.id) {
      var it = findItem(d.id);
      if (!it || String(it.row[I.seller]) !== me.nick) return { ok: false, error: '내 상품이 아니에요.' };
      is.getRange(it.index, I.cat + 1, 1, 4).setValues([values]);
      is.getRange(it.index, I.closed + 1).setValue(p.closed ? '마감' : '');
      is.getRange(it.index, I.changed + 1).setValue(new Date());
      return { ok: true, id: d.id };
    }
    var id = 'o' + Date.now().toString(36);
    is.appendRow([id, new Date(), text(me.nick)].concat(values, [SHOWN, p.closed ? '마감' : '', new Date()]));
    return { ok: true, id: id };
  }
  if (d.action === 'sellerRemove') {
    var x = findItem(d.id);
    if (!x || String(x.row[I.seller]) !== me.nick) return { ok: false, error: '내 상품이 아니에요.' };
    itemSheet().getRange(x.index, I.status + 1).setValue(HIDDEN);
    itemSheet().getRange(x.index, I.changed + 1).setValue(new Date());
    return { ok: true };
  }
  return { ok: false, error: '알 수 없는 요청이에요.' };
}

// 판매 = 판매자가 수락한 제안. 판매자 칸이 빈 상품은 운영자(OWN_SELLER) 판매로 센다.
function salesRows() {
  return rows().filter(function (row) { return row[COL.status] === YES; }).map(function (row) {
    var at = row[COL.at];
    return {
      day: at instanceof Date ? Utilities.formatDate(at, 'Asia/Seoul', 'yyyy-MM-dd') : String(at).slice(0, 10),
      seller: String(row[COL.seller] || '') || OWN_SELLER, amount: Number(row[COL.total]) || 0,
      orderNo: String(row[COL.no]), status: String(row[COL.status]), items: String(row[COL.product]) + ' × ' + (Number(row[COL.qty]) || 1)
    };
  });
}

function itemSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), s = ss.getSheetByName(ITEM_SHEET);
  if (!s) { s = ss.insertSheet(ITEM_SHEET, ss.getNumSheets()); s.appendRow(ITEM_HEADER); }
  return s;
}
function itemRows() {
  var s = itemSheet(), n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, ITEM_HEADER.length).getValues().map(function (row, i) { return { index: i + 2, row: row }; });
}
function findItem(id) {
  id = String(id || '');
  var hit = null;
  if (id) itemRows().forEach(function (r) { if (String(r.row[I.id]) === id) hit = r; });
  return hit;
}
function toItem(row, full) {
  var it = { id: String(row[I.id]), seller: String(row[I.seller]), cat: String(row[I.cat]), name: String(row[I.name]),
    unit: String(row[I.unit]), desc: String(row[I.desc]), closed: !!row[I.closed], order: 100000 };
  if (full) {
    var at = row[I.at];
    it.at = at instanceof Date ? Utilities.formatDate(at, 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : String(at || '');
    it.status = String(row[I.status] || SHOWN);
  }
  return it;
}
// 상점에 보이는 판매자 상품("게시")
function publicItems() {
  return itemRows().filter(function (r) { return r.row[I.status] === SHOWN; }).map(function (r) { return toItem(r.row); });
}
function toOffer(row) {
  return {
    no: String(row[COL.no]), at: row[COL.at] instanceof Date ? row[COL.at].toISOString() : String(row[COL.at]),
    pid: String(row[COL.pid]), product: String(row[COL.product]), seller: String(row[COL.seller]),
    qty: Number(row[COL.qty]) || 1, price: Number(row[COL.price]) || 0, total: Number(row[COL.total]) || 0,
    name: String(row[COL.name]), phone: String(row[COL.phone]), place: String(row[COL.place]), memo: String(row[COL.memo]),
    status: String(row[COL.status] || WAIT), bank: parseBank(row[COL.bank])
  };
}

function parseBank(v) { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }
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
