// 무엇이든 상점 주문·판매자 (구글 시트용 Apps Script)
// - 손님이 주문하면 첫 번째 탭에 한 줄씩 쌓입니다.
// - 판매자 신청은 "판매자 신청" 탭에 쌓이고, 신청하면 바로 판매자 열쇠가 나옵니다.
// - 판매자가 올린 상품은 "판매자 상품" 탭에 쌓이고, 상태가 "게시"인 것만 상점에 보입니다.
//   문제 있는 상품은 상태를 "내림"으로, 판매자는 "판매자 신청" 탭의 상태를 "정지"로 바꾸면 상점에서 사라집니다.
// 가격은 손님 브라우저가 보낸 값이 아니라 저장소의 products.json과 "판매자 상품" 탭으로 다시 계산합니다.

var PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/products.json';
var HEADER = ['주문번호', '주문 시각', '이름', '연락처', '받는 곳', '남긴 말', '입금자', '상품', '판매자', '금액', '상태'];

var SELLER_TAB = '판매자 신청';
var SELLER_HEADER = ['신청 시각', '상점', '판매자 이름', '실명', '연락처', '이메일', '구분', '사업자등록번호', '팔고 싶은 것', '은행', '계좌번호', '예금주', '상태', '판매자 열쇠'];
var S = { nick: 2, bank: 9, acct: 10, holder: 11, status: 12, key: 13 };
var STOPPED = '정지';

var ITEM_TAB = '판매자 상품';
var ITEM_HEADER = ['상품ID', '올린 시각', '판매자', '분류', '상품', '가격', '단위', '설명', '상태', '바뀐 시각'];
var I = { id: 0, at: 1, seller: 2, cat: 3, name: 4, price: 5, unit: 6, desc: 7, status: 8, changed: 9 };
var SHOWN = '게시', HIDDEN = '내림';

// 읽기: 상점에 보일 판매자 상품 목록(누구나)
function doGet(e) {
  try {
    return reply({ ok: true, products: publicItems() });
  } catch (err) {
    return reply({ ok: false, error: '판매자 상품을 읽지 못했어요.' });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.type === 'seller') return reply(sellerSignup(d));
    if (d.action === 'sellerLogin') return reply(sellerLogin(d.key));
    if (d.action === 'sellerSave') return reply(sellerSave(d));
    if (d.action === 'sellerRemove') return reply(sellerRemove(d));
    return reply(placeOrder(d));
  } catch (err) {
    return reply({ ok: false, error: '저장하지 못했어요.' });
  } finally {
    lock.releaseLock();
  }
}

// ---------- 주문 ----------
function placeOrder(d) {
  var name = clip(d.name, 20), phone = clip(d.phone, 20);
  if (!name || !phone) return { ok: false, error: '이름과 연락처가 필요해요.' };

  var byId = {};
  var list = JSON.parse(UrlFetchApp.fetch(PRODUCTS_URL + '?t=' + Date.now()).getContentText()).products || [];
  list.forEach(function (p) { if (!p.sample) byId[p.id] = p; });   // 샘플 상품은 주문을 받지 않는다
  publicItems().forEach(function (p) { byId[p.id] = p; });

  var total = 0, lines = [], sellers = [];
  (d.items || []).forEach(function (it) {
    var p = byId[it.id];
    var qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 0)));
    if (!p) return;
    total += Number(p.price) * qty;
    lines.push(p.name + ' × ' + qty + ' (' + Number(p.price).toLocaleString() + '원)');
    if (p.seller && sellers.indexOf(p.seller) < 0) sellers.push(p.seller);
  });
  if (!lines.length) return { ok: false, error: '주문할 상품이 없어요.' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADER);
  var orderNo = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
  // 수식으로 해석되지 않도록 손님이 적은 칸은 글자로 저장한다
  sheet.appendRow([orderNo, new Date(), text(name), "'" + phone, text(clip(d.place, 100)), text(clip(d.memo, 200)),
    text(clip(d.payer, 20) || name), lines.join('\n'), sellers.join(', '), total, '입금 대기']);

  // 판매자가 직접 등록한 계좌는 주문한 손님에게만 알려 준다
  var accounts = {};
  sellerRows().forEach(function (r) {
    var nick = String(r.row[S.nick]);
    if (sellers.indexOf(nick) >= 0 && r.row[S.acct]) accounts[nick] = { name: String(r.row[S.bank]), account: String(r.row[S.acct]), holder: String(r.row[S.holder]) };
  });
  return { ok: true, orderNo: orderNo, total: total, accounts: accounts };
}

// ---------- 판매자 ----------
function sellerSignup(d) {
  var nick = clip(d.nick, 20), realName = clip(d.realName, 20), tel = clip(d.tel, 20);
  if (!nick || !realName || !tel) return { ok: false, error: '이름과 연락처가 필요해요.' };
  if (!clip(d.bank, 15) || !clip(d.acct, 30) || !clip(d.holder, 20)) return { ok: false, error: '입금받을 계좌가 필요해요.' };
  var taken = sellerRows().some(function (r) { return String(r.row[S.nick]).toLowerCase() === nick.toLowerCase(); });
  if (taken || nick === '무엇이든 상점') return { ok: false, error: '이미 쓰고 있는 판매자 이름이에요. 다른 이름을 적어 주세요.' };

  var key = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  sellerSheet().appendRow([new Date(), text(clip(d.shop, 20)), text(nick), text(realName), "'" + tel, text(clip(d.email, 60)),
    text(clip(d.kind, 5)), "'" + clip(d.biz, 12), text(clip(d.what, 400)), text(clip(d.bank, 15)), "'" + clip(d.acct, 30),
    text(clip(d.holder, 20)), '활동', key]);
  return { ok: true, seller: true, nick: nick, key: key };
}

function sellerLogin(key) {
  var s = sellerByKey(key);
  if (!s) return { ok: false, error: '판매자 열쇠가 맞지 않아요.' };
  return { ok: true, nick: s.nick, products: itemRows().filter(function (r) {
    return String(r.row[I.seller]) === s.nick && r.row[I.status] !== HIDDEN;
  }).map(function (r) { return toItem(r.row); }) };
}

function sellerSave(d) {
  var s = sellerByKey(d.key);
  if (!s) return { ok: false, error: '판매자 열쇠가 맞지 않아요.' };
  var p = d.product || {};
  var name = clip(p.name, 40), cat = clip(p.cat, 12), price = Math.round(Number(p.price));
  if (!name || !cat) return { ok: false, error: '상품 이름과 분류를 적어 주세요.' };
  if (!(price >= 0 && price <= 100000000)) return { ok: false, error: '가격은 0원부터 1억 원까지 적을 수 있어요.' };
  var values = [text(s.nick), text(cat), text(name), price, text(clip(p.unit, 20)), text(clip(p.desc, 200))];

  var sheet = itemSheet();
  if (d.id) {
    var r = findItem(d.id);
    if (!r || String(r.row[I.seller]) !== s.nick) return { ok: false, error: '내 상품이 아니에요.' };
    sheet.getRange(r.index, I.seller + 1, 1, values.length).setValues([values]);
    sheet.getRange(r.index, I.changed + 1).setValue(new Date());
    return { ok: true, id: String(d.id) };
  }
  var id = 's' + Date.now().toString(36);
  sheet.appendRow([id, new Date()].concat(values, [SHOWN, new Date()]));
  return { ok: true, id: id };
}

function sellerRemove(d) {
  var s = sellerByKey(d.key);
  if (!s) return { ok: false, error: '판매자 열쇠가 맞지 않아요.' };
  var r = findItem(d.id);
  if (!r || String(r.row[I.seller]) !== s.nick) return { ok: false, error: '내 상품이 아니에요.' };
  itemSheet().getRange(r.index, I.status + 1).setValue(HIDDEN);
  itemSheet().getRange(r.index, I.changed + 1).setValue(new Date());
  return { ok: true };
}

// 정지되지 않은 판매자의 "게시" 상품만 상점에 보인다
function publicItems() {
  var active = {};
  sellerRows().forEach(function (r) { if (r.row[S.status] !== STOPPED) active[String(r.row[S.nick])] = true; });
  return itemRows().filter(function (r) {
    return r.row[I.status] === SHOWN && active[String(r.row[I.seller])];
  }).map(function (r) { return toItem(r.row); });
}

function toItem(row) {
  return { id: String(row[I.id]), seller: String(row[I.seller]), cat: String(row[I.cat]), name: String(row[I.name]),
    price: Number(row[I.price]) || 0, unit: String(row[I.unit]), desc: String(row[I.desc]) };
}

function sellerByKey(key) {
  key = String(key || '');
  if (key.length < 8) return null;
  var found = null;
  sellerRows().forEach(function (r) {
    if (String(r.row[S.key]) === key && r.row[S.status] !== STOPPED) found = { nick: String(r.row[S.nick]) };
  });
  return found;
}

// ---------- 탭 읽기 ----------
function tab(name, header) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  // 제목 줄은 항상 최신 칸 이름으로 맞춘다
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  return sheet;
}
function sellerSheet() { return tab(SELLER_TAB, SELLER_HEADER); }
function itemSheet() { return tab(ITEM_TAB, ITEM_HEADER); }
function readRows(sheet, width) {
  var n = sheet.getLastRow();
  if (n < 2) return [];
  return sheet.getRange(2, 1, n - 1, width).getValues().map(function (row, i) { return { index: i + 2, row: row }; });
}
function sellerRows() { return readRows(sellerSheet(), SELLER_HEADER.length); }
function itemRows() { return readRows(itemSheet(), ITEM_HEADER.length); }
function findItem(id) {
  id = String(id || '');
  var hit = null;
  itemRows().forEach(function (r) { if (String(r.row[I.id]) === id) hit = r; });
  return hit;
}

function clip(v, n) { return String(v || '').trim().slice(0, n); }
function text(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
