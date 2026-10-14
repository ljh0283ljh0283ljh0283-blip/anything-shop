// 무엇이든 상점 주문·판매자 (구글 시트용 Apps Script)
// - 손님이 주문하면 첫 번째 탭에 한 줄씩 쌓입니다.
// - 판매자 되기(회원가입)는 "판매자 신청" 탭에 쌓입니다. 판매자는 아이디와 비밀번호로 로그인합니다.
//   비밀번호는 그대로 적지 않고 알아볼 수 없게 바꿔(해시) 저장합니다.
// - 사이트 관리자는 GitHub 열쇠(anything-shop 저장소 쓰기 권한)로 들어와 모든 판매자 상품과 판매자를 관리합니다.
// - 판매자가 올린 상품은 "판매자 상품" 탭에 쌓이고, 상태가 "게시"인 것만 상점에 보입니다.
//   문제 있는 상품은 상태를 "내림"으로, 판매자는 "판매자 신청" 탭의 상태를 "정지"로 바꾸면 상점에서 사라집니다.
// 가격은 손님 브라우저가 보낸 값이 아니라 저장소의 products.json과 "판매자 상품" 탭으로 다시 계산합니다.

var PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/products.json';
var HEADER = ['주문번호', '주문 시각', '이름', '연락처', '받는 곳', '남긴 말', '입금자', '상품', '판매자', '금액', '상태'];

var SELLER_TAB = '판매자 신청';
var SELLER_HEADER = ['신청 시각', '상점', '판매자 이름', '실명', '연락처', '이메일', '구분', '사업자등록번호', '팔고 싶은 것', '은행', '계좌번호', '예금주', '상태', '로그인 열쇠', '아이디', '비밀번호'];
var S = { at: 0, nick: 2, realName: 3, tel: 4, email: 5, kind: 6, biz: 7, what: 8, bank: 9, acct: 10, holder: 11, status: 12, key: 13, loginId: 14, pw: 15 };
var ACTIVE = '활동', STOPPED = '정지';
var REPO_API = 'https://api.github.com/repos/ljh0283ljh0283ljh0283-blip/anything-shop';

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
    if (d.action === 'sellerLogin') return reply(sellerLogin(d));
    if (d.action === 'sellerMe') return reply(sellerMe(d.key));
    if (String(d.action || '').indexOf('admin') === 0) return reply(admin(d));
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
  var loginId = clip(d.loginId, 20).toLowerCase(), password = String(d.password || '');
  if (!/^[a-z0-9_]{4,20}$/.test(loginId)) return { ok: false, error: '아이디는 영어 소문자와 숫자로 4~20자로 적어 주세요.' };
  if (password.length < 6 || password.length > 64) return { ok: false, error: '비밀번호는 6자 이상으로 적어 주세요.' };
  if (!nick || !realName || !tel) return { ok: false, error: '이름과 연락처가 필요해요.' };
  if (!clip(d.bank, 15) || !clip(d.acct, 30) || !clip(d.holder, 20)) return { ok: false, error: '입금받을 계좌가 필요해요.' };
  var rows = sellerRows();
  if (rows.some(function (r) { return String(r.row[S.loginId]).toLowerCase() === loginId; })) return { ok: false, error: '이미 쓰고 있는 아이디예요. 다른 아이디를 적어 주세요.' };
  var nickTaken = rows.some(function (r) { return String(r.row[S.nick]).toLowerCase() === nick.toLowerCase(); });
  if (nickTaken || nick === '무엇이든 상점') return { ok: false, error: '이미 쓰고 있는 판매자 이름이에요. 다른 이름을 적어 주세요.' };

  var key = newKey();
  sellerSheet().appendRow([new Date(), text(clip(d.shop, 20)), text(nick), text(realName), "'" + tel, text(clip(d.email, 60)),
    text(clip(d.kind, 5)), "'" + clip(d.biz, 12), text(clip(d.what, 400)), text(clip(d.bank, 15)), "'" + clip(d.acct, 30),
    text(clip(d.holder, 20)), ACTIVE, key, "'" + loginId, hashPassword(password)]);
  return { ok: true, seller: true, nick: nick, key: key };
}

// 아이디·비밀번호가 맞으면 새 로그인 열쇠를 만들어 준다(전에 쓰던 열쇠는 더 이상 쓸 수 없다)
function sellerLogin(d) {
  var loginId = clip(d.loginId, 20).toLowerCase(), password = String(d.password || '');
  var hit = null;
  sellerRows().forEach(function (r) { if (String(r.row[S.loginId]).toLowerCase() === loginId) hit = r; });
  if (!hit || !checkPassword(password, String(hit.row[S.pw]))) return { ok: false, error: '아이디나 비밀번호가 맞지 않아요.' };
  if (hit.row[S.status] === STOPPED) return { ok: false, error: '이용이 정지된 판매자예요. 운영자에게 문의해 주세요.' };
  var key = newKey();
  sellerSheet().getRange(hit.index, S.key + 1).setValue(key);
  return { ok: true, nick: String(hit.row[S.nick]), key: key };
}

function sellerMe(key) {
  var s = sellerByKey(key);
  if (!s) return { ok: false, error: '다시 로그인해 주세요.' };
  return { ok: true, nick: s.nick };
}

function sellerSave(d) {
  var s = sellerByKey(d.key);
  if (!s) return { ok: false, error: '다시 로그인해 주세요.' };
  var values = itemValues(s.nick, d.product);
  if (values.error) return values;

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
  if (!s) return { ok: false, error: '다시 로그인해 주세요.' };
  var r = findItem(d.id);
  if (!r || String(r.row[I.seller]) !== s.nick) return { ok: false, error: '내 상품이 아니에요.' };
  itemSheet().getRange(r.index, I.status + 1).setValue(HIDDEN);
  itemSheet().getRange(r.index, I.changed + 1).setValue(new Date());
  return { ok: true };
}

function itemValues(nick, p) {
  p = p || {};
  var name = clip(p.name, 40), cat = clip(p.cat, 12), price = Math.round(Number(p.price));
  if (!name || !cat) return { ok: false, error: '상품 이름과 분류를 적어 주세요.' };
  if (!(price >= 0 && price <= 100000000)) return { ok: false, error: '가격은 0원부터 1억 원까지 적을 수 있어요.' };
  return [text(nick), text(cat), text(name), price, text(clip(p.unit, 20)), text(clip(p.desc, 200))];
}

// ---------- 사이트 관리자 ----------
// GitHub 열쇠로 anything-shop 저장소에 쓸 수 있는 사람만 관리자로 본다. 확인 결과는 10분 동안 기억한다.
function isAdmin(token) {
  token = String(token || '');
  if (token.length < 20) return false;
  var cache = CacheService.getScriptCache();
  var id = 'admin-' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  if (cache.get(id) === 'yes') return true;
  var res = UrlFetchApp.fetch(REPO_API, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return false;
  var ok = !!(JSON.parse(res.getContentText()).permissions || {}).push;
  if (ok) cache.put(id, 'yes', 600);
  return ok;
}

function admin(d) {
  if (!isAdmin(d.token)) return { ok: false, error: '관리자 열쇠(GitHub 토큰)가 맞지 않아요.' };
  if (d.action === 'adminList') {
    return { ok: true,
      items: itemRows().map(function (r) { var it = toItem(r.row); it.status = String(r.row[I.status]); it.at = stamp(r.row[I.at]); return it; }).reverse(),
      sellers: sellerRows().map(function (r) {
        return { nick: String(r.row[S.nick]), loginId: String(r.row[S.loginId]), realName: String(r.row[S.realName]), tel: String(r.row[S.tel]),
          email: String(r.row[S.email]), kind: String(r.row[S.kind]), status: String(r.row[S.status] || ACTIVE), at: stamp(r.row[S.at]) };
      }).reverse() };
  }
  if (d.action === 'adminSave') {
    var r = findItem(d.id);
    if (!r) return { ok: false, error: '없는 상품이에요.' };
    var values = itemValues(String(r.row[I.seller]), d.product);
    if (values.error) return values;
    itemSheet().getRange(r.index, I.seller + 1, 1, values.length).setValues([values]);
    itemSheet().getRange(r.index, I.changed + 1).setValue(new Date());
    return { ok: true };
  }
  if (d.action === 'adminItemStatus') {
    var r2 = findItem(d.id);
    if (!r2 || [SHOWN, HIDDEN].indexOf(d.status) < 0) return { ok: false, error: '바꿀 수 없어요.' };
    itemSheet().getRange(r2.index, I.status + 1).setValue(d.status);
    itemSheet().getRange(r2.index, I.changed + 1).setValue(new Date());
    return { ok: true };
  }
  if (d.action === 'adminItemDelete') {
    var r3 = findItem(d.id);
    if (!r3) return { ok: false, error: '없는 상품이에요.' };
    itemSheet().deleteRow(r3.index);
    return { ok: true };
  }
  if (d.action === 'adminSellerStatus') {
    if ([ACTIVE, STOPPED].indexOf(d.status) < 0) return { ok: false, error: '바꿀 수 없어요.' };
    var hit = null;
    sellerRows().forEach(function (r) { if (String(r.row[S.nick]) === String(d.nick)) hit = r; });
    if (!hit) return { ok: false, error: '없는 판매자예요.' };
    sellerSheet().getRange(hit.index, S.status + 1).setValue(d.status);
    return { ok: true };
  }
  return { ok: false, error: '알 수 없는 요청이에요.' };
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

function newKey() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }
function hashPassword(pw) {
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return salt + '$' + digest(salt + pw);
}
function checkPassword(pw, stored) {
  var parts = stored.split('$');
  return parts.length === 2 && digest(parts[0] + pw) === parts[1];
}
function digest(v) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8)); }
function stamp(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : String(v || ''); }

function clip(v, n) { return String(v || '').trim().slice(0, n); }
function text(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
