// 무엇이든 상점 주문·판매자 (구글 시트용 Apps Script)
// - 손님이 주문하면 첫 번째 탭에 한 줄씩 쌓입니다.
// - 판매자 되기(회원가입)는 "판매자 신청" 탭에 쌓입니다. 판매자는 아이디와 비밀번호로 로그인합니다.
//   비밀번호는 그대로 적지 않고 알아볼 수 없게 바꿔(해시) 저장합니다.
// - 사이트 관리자는 관리자 비밀번호로 들어옵니다. 비밀번호는 스크립트 속성 ADMIN_KEY에 적어 둡니다.
//   (프로젝트 설정 > 스크립트 속성 > ADMIN_KEY. 바꾸면 모든 관리자 화면에서 새 비밀번호로 다시 들어와야 합니다)
// - 운영자가 직접 파는 상품과 샘플 상품은 "운영 상품" 탭에 있습니다. 처음 관리자로 들어올 때 products.json에서 옮겨 옵니다.
// - 판매자가 올린 상품은 "판매자 상품" 탭에 쌓이고, 상태가 "게시"인 것만 상점에 보입니다.
//   문제 있는 상품은 상태를 "내림"으로, 판매자는 "판매자 신청" 탭의 상태를 "정지"로 바꾸면 상점에서 사라집니다.
// 가격은 손님 브라우저가 보낸 값이 아니라 "운영 상품"·"판매자 상품" 탭으로 다시 계산합니다.

var PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/products.json';
var HEADER = ['주문번호', '주문 시각', '이름', '연락처', '받는 곳', '남긴 말', '입금자', '상품', '판매자', '금액', '상태', '판매자별 금액', '판매자별 상품'];
// 판매자 칸이 비어 있는 상품(운영자가 직접 올린 상품)의 판매자: 판매 기록에 이 이름으로 잡힌다
var OWN_SELLER = '빨간도령';

var SELLER_TAB = '판매자 신청';
var SELLER_HEADER = ['신청 시각', '상점', '판매자 이름', '실명', '연락처', '이메일', '구분', '사업자등록번호', '팔고 싶은 것', '은행', '계좌번호', '예금주', '상태', '로그인 열쇠', '아이디', '비밀번호'];
var S = { at: 0, nick: 2, realName: 3, tel: 4, email: 5, kind: 6, biz: 7, what: 8, bank: 9, acct: 10, holder: 11, status: 12, key: 13, loginId: 14, pw: 15 };
var ACTIVE = '활동', STOPPED = '정지';

var ITEM_TAB = '판매자 상품';
var ITEM_HEADER = ['상품ID', '올린 시각', '판매자', '분류', '상품', '가격', '단위', '설명', '상태', '바뀐 시각'];
var I = { id: 0, at: 1, seller: 2, cat: 3, name: 4, price: 5, unit: 6, desc: 7, status: 8, changed: 9 };
var SHOWN = '게시', HIDDEN = '내림';

var OWN_TAB = '운영 상품';
var OWN_HEADER = ['상품ID', '분류', '상품', '가격', '단위', '설명', '판매자', '샘플', '순서', '바뀐 시각'];
var O = { id: 0, cat: 1, name: 2, price: 3, unit: 4, desc: 5, seller: 6, sample: 7, order: 8, changed: 9 };

// 읽기: 상점에 보일 판매자 상품과 운영 상품 목록(누구나). 운영 상품 탭이 아직 없으면 own은 비워 둔다.
function doGet(e) {
  try {
    return reply({ ok: true, products: publicItems(), own: ownItems() });
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
    if (d.action === 'sellerPassword') return reply(sellerPassword(d));
    if (d.action === 'sellerEmail') return reply(sellerEmail(d));
    if (d.action === 'sellerSales') return reply(sellerSales(d));
    if (d.action === 'sellerFindStart') return reply(sellerFindStart(d));
    if (d.action === 'sellerFindFinish') return reply(sellerFindFinish(d));
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
  var list = ownItems() || seedProducts();
  list.forEach(function (p) { if (!p.sample) byId[p.id] = p; });   // 샘플 상품은 주문을 받지 않는다
  publicItems().forEach(function (p) { byId[p.id] = p; });

  var total = 0, lines = [], sellers = [], bySeller = {}, goodsBySeller = {};
  (d.items || []).forEach(function (it) {
    var p = byId[it.id];
    var qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 0)));
    if (!p) return;
    total += Number(p.price) * qty;
    var who = p.seller || OWN_SELLER;
    bySeller[who] = (bySeller[who] || 0) + Number(p.price) * qty;
    lines.push(p.name + ' × ' + qty + ' (' + Number(p.price).toLocaleString() + '원)');
    (goodsBySeller[who] = goodsBySeller[who] || []).push(p.name + ' × ' + qty);
    if (p.seller && sellers.indexOf(p.seller) < 0) sellers.push(p.seller);
  });
  if (!lines.length) return { ok: false, error: '주문할 상품이 없어요.' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADER);
  else for (var h = 12; h <= HEADER.length; h++) { if (!sheet.getRange(1, h).getValue()) sheet.getRange(1, h).setValue(HEADER[h - 1]); }
  // 주문번호: 날짜(yyMMdd)-시분(HHmm, 한국 시간)-임의의 두 자리-그날 들어온 순서(1부터). 예: 261016-0928-59-3
  var now = new Date(), today = Utilities.formatDate(now, 'Asia/Seoul', 'yyMMdd');
  var seq = 1;
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (String(r[0]).indexOf(today + '-') === 0) seq++;
    });
  }
  var orderNo = today + '-' + Utilities.formatDate(now, 'Asia/Seoul', 'HHmm') + '-' + Math.floor(Math.random() * 90 + 10) + '-' + seq;
  // 수식으로 해석되지 않도록 손님이 적은 칸은 글자로 저장한다
  sheet.appendRow([orderNo, now, text(name), "'" + phone, text(clip(d.place, 100)), text(clip(d.memo, 200)),
    text(clip(d.payer, 20) || name), lines.join('\n'), sellers.join(', '), total, '입금 대기', JSON.stringify(bySeller), JSON.stringify(goodsBySeller)]);

  // 판매자가 직접 등록한 계좌는 주문한 손님에게만 알려 준다
  var accounts = {};
  sellerRows().forEach(function (r) {
    var nick = String(r.row[S.nick]);
    if (sellers.indexOf(nick) >= 0 && r.row[S.acct]) accounts[nick] = { name: String(r.row[S.bank]), account: String(r.row[S.acct]), holder: String(r.row[S.holder]) };
  });
  return { ok: true, orderNo: orderNo, total: total, accounts: accounts };
}

// 판매 기록: 주문 한 건을 판매자별로 나눈 줄 [{ day, seller, amount, orderNo, status }]. 상태에 "취소"가 들어간 주문은 뺀다.
// 예전 주문(판매자별 금액 칸이 없는 것)은 판매자가 하나면 그 판매자 몫으로, 여럿이면 나눌 수 없는 주문으로 센다.
function salesRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, HEADER.length).getValues(), out = [];
  rows.forEach(function (r) {
    var status = String(r[10] || ''), at = r[1];
    if (!r[0] || status.indexOf('취소') >= 0 || !(at instanceof Date)) return;
    var by = null;
    try { by = r[11] ? JSON.parse(r[11]) : null; } catch (e) { by = null; }
    if (!by) {
      var names = String(r[8] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      by = {};
      by[names.length === 1 ? names[0] : names.length ? '(여러 판매자 · 나눔 정보 없음)' : OWN_SELLER] = Number(r[9]) || 0;
    }
    var goods = null;
    try { goods = r[12] ? JSON.parse(r[12]) : null; } catch (e) { goods = null; }
    var day = Utilities.formatDate(at, 'Asia/Seoul', 'yyyy-MM-dd'), keys = Object.keys(by);
    keys.forEach(function (who) {
      // 판매자별 상품 칸이 없는 예전 주문은 판매자가 하나일 때만 상품 칸을 그대로 쓴다
      var items = goods && goods[who] ? goods[who].join(', ') : keys.length === 1 ? String(r[7] || '').replace(/ \([0-9,]+원\)/g, '').split('\n').join(', ') : '';
      out.push({ day: day, seller: who, amount: Number(by[who]) || 0, orderNo: String(r[0]), status: status, items: items });
    });
  });
  return out;
}

// ---------- 판매자 ----------
function sellerSignup(d) {
  var nick = clip(d.nick, 20), realName = clip(d.realName, 20), tel = clip(d.tel, 20);
  var loginId = normId(d.loginId), password = String(d.password || '');
  if (!/^[가-힣a-z0-9_ ]{2,20}$/.test(loginId)) return { ok: false, error: '아이디는 한글, 영어, 숫자, 띄어쓰기로 2~20자로 적어 주세요.' };
  if (password.length < 6 || password.length > 64) return { ok: false, error: '비밀번호는 6자 이상으로 적어 주세요.' };
  if (!nick || !realName || !tel) return { ok: false, error: '이름과 연락처가 필요해요.' };
  if (!isEmail(d.email)) return { ok: false, error: '아이디·비밀번호를 찾을 때 쓸 이메일을 적어 주세요.' };
  if (!clip(d.bank, 15) || !clip(d.acct, 30) || !clip(d.holder, 20)) return { ok: false, error: '입금받을 계좌가 필요해요.' };
  var rows = sellerRows();
  if (rows.some(function (r) { return normId(r.row[S.loginId]) === loginId; })) return { ok: false, error: '이미 쓰고 있는 아이디예요. 다른 아이디를 적어 주세요.' };
  var nickTaken = rows.some(function (r) { return String(r.row[S.nick]).toLowerCase() === nick.toLowerCase(); });
  if (nickTaken || nick === '무엇이든 상점') return { ok: false, error: '이미 쓰고 있는 판매자 이름이에요. 다른 이름을 적어 주세요.' };

  var key = newKey();
  sellerSheet().appendRow([new Date(), text(clip(d.shop, 20)), text(nick), text(realName), "'" + tel, normEmail(d.email),
    text(clip(d.kind, 5)), "'" + clip(d.biz, 12), text(clip(d.what, 400)), text(clip(d.bank, 15)), "'" + clip(d.acct, 30),
    text(clip(d.holder, 20)), ACTIVE, key, "'" + loginId, hashPassword(password)]);
  return { ok: true, seller: true, nick: nick, key: key };
}

// 아이디·비밀번호가 맞으면 새 로그인 열쇠를 만들어 준다(전에 쓰던 열쇠는 더 이상 쓸 수 없다)
function sellerLogin(d) {
  var loginId = normId(d.loginId), password = String(d.password || '');
  var hit = null;
  sellerRows().forEach(function (r) { if (normId(r.row[S.loginId]) === loginId) hit = r; });
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

// 로그인한 판매자가 비밀번호를 바꾼다(관리자가 준 임시 비밀번호를 바꿀 때도 쓴다)
function sellerPassword(d) {
  var hit = sellerRowByKey(d.key);
  if (!hit) return { ok: false, error: '다시 로그인해 주세요.' };
  if (!checkPassword(String(d.oldPassword || ''), String(hit.row[S.pw]))) return { ok: false, error: '지금 비밀번호가 맞지 않아요.' };
  var pw = String(d.newPassword || '');
  if (pw.length < 6 || pw.length > 64) return { ok: false, error: '새 비밀번호는 6자 이상으로 적어 주세요.' };
  sellerSheet().getRange(hit.index, S.pw + 1).setValue(hashPassword(pw));
  return { ok: true };
}

// 로그인한 판매자가 이메일을 등록하거나 바꾼다(전에 이메일 없이 가입한 판매자용)
function sellerEmail(d) {
  var hit = sellerRowByKey(d.key);
  if (!hit) return { ok: false, error: '다시 로그인해 주세요.' };
  if (!isEmail(d.email)) return { ok: false, error: '이메일 주소를 확인해 주세요.' };
  sellerSheet().getRange(hit.index, S.email + 1).setValue(normEmail(d.email));
  return { ok: true };
}

// 로그인한 판매자에게 자기 판매 기록만 돌려준다(손님 이름·연락처는 넣지 않는다)
function sellerSales(d) {
  var me = sellerByKey(d.key);
  if (!me) return { ok: false, error: '다시 로그인해 주세요.' };
  return { ok: true, sales: salesRows().filter(function (r) { return r.seller === me.nick; }) };
}

// ---------- 아이디·비밀번호 찾기 (이메일 인증번호) ----------
// 1) 가입한 이메일을 넣으면 그 메일로 아이디와 6자리 인증번호를 보낸다(10분 동안 유효).
// 2) 인증번호와 새 비밀번호를 넣으면 비밀번호가 바뀌고 바로 로그인된다.
// 가입되지 않은 메일이어도 같은 답을 돌려줘서, 누가 가입했는지 알 수 없게 한다.
function sellerFindStart(d) {
  var email = normEmail(d.email);
  if (!isEmail(email)) return { ok: false, error: '이메일 주소를 확인해 주세요.' };
  var cache = CacheService.getScriptCache(), ck = 'find:' + email;
  if (cache.get(ck + ':wait')) return { ok: false, error: '방금 보냈어요. 1분 뒤에 다시 눌러 주세요.' };
  var ids = sellerRows().filter(function (r) { return normEmail(r.row[S.email]) === email && r.row[S.status] !== STOPPED; })
    .map(function (r) { return String(r.row[S.loginId]); }).filter(Boolean);
  cache.put(ck + ':wait', '1', 60);
  if (!ids.length) return { ok: true };
  var code = String(100000 + Math.floor(Math.random() * 900000));
  cache.put(ck, JSON.stringify({ code: code, tries: 0 }), 600);
  MailApp.sendEmail({
    to: email,
    subject: '[무엇이든 상점] 아이디와 인증번호',
    body: '무엇이든 상점 판매자 아이디: ' + ids.join(', ') + '\n\n' +
      '비밀번호를 새로 정하려면 아래 인증번호를 10분 안에 상점 화면에 넣어 주세요.\n인증번호: ' + code + '\n\n' +
      '직접 요청하지 않았다면 이 메일은 무시해도 돼요.'
  });
  return { ok: true };
}

function sellerFindFinish(d) {
  var email = normEmail(d.email), cache = CacheService.getScriptCache(), ck = 'find:' + email;
  var saved = cache.get(ck);
  if (!saved) return { ok: false, error: '인증번호가 없거나 시간이 지났어요. 인증번호를 다시 받아 주세요.' };
  saved = JSON.parse(saved);
  if (saved.tries >= 5) { cache.remove(ck); return { ok: false, error: '여러 번 틀렸어요. 인증번호를 다시 받아 주세요.' }; }
  if (String(d.code || '').trim() !== saved.code) {
    saved.tries++; cache.put(ck, JSON.stringify(saved), 600);
    return { ok: false, error: '인증번호가 맞지 않아요.' };
  }
  var loginId = normId(d.loginId), pw = String(d.newPassword || ''), hit = null;
  if (pw.length < 6 || pw.length > 64) return { ok: false, error: '새 비밀번호는 6자 이상으로 적어 주세요.' };
  sellerRows().forEach(function (r) {
    if (normEmail(r.row[S.email]) === email && normId(r.row[S.loginId]) === loginId && r.row[S.status] !== STOPPED) hit = r;
  });
  if (!hit) return { ok: false, error: '메일에 적힌 아이디를 적어 주세요.' };
  cache.remove(ck);
  var key = newKey();
  sellerSheet().getRange(hit.index, S.key + 1).setValue(key);
  sellerSheet().getRange(hit.index, S.pw + 1).setValue(hashPassword(pw));
  return { ok: true, nick: String(hit.row[S.nick]), key: key };
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
// 스크립트 속성 ADMIN_KEY와 같은 비밀번호를 보낸 사람만 관리자로 본다. ADMIN_KEY가 없으면 아무도 못 들어온다.
function isAdmin(key) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
  return real.length >= 4 && String(key || '') === real;
}

function admin(d) {
  if (!isAdmin(d.adminKey)) return { ok: false, error: '관리자 비밀번호가 맞지 않아요.' };
  if (d.action === 'adminList') {
    return { ok: true, own: ownList(),
      items: itemRows().map(function (r) { var it = toItem(r.row); it.status = String(r.row[I.status]); it.at = stamp(r.row[I.at]); return it; }).reverse(),
      sellers: sellerRows().map(function (r) {
        return { nick: String(r.row[S.nick]), loginId: String(r.row[S.loginId]), realName: String(r.row[S.realName]), tel: String(r.row[S.tel]),
          email: String(r.row[S.email]), kind: String(r.row[S.kind]), status: String(r.row[S.status] || ACTIVE), at: stamp(r.row[S.at]) };
      }).reverse() };
  }
  if (d.action === 'adminSales') return { ok: true, sales: salesRows() };
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
  // 판매자 삭제: 판매자 신청 줄과 그 판매자가 올린 상품을 모두 지운다(되돌릴 수 없다). 지난 주문 기록은 남는다.
  if (d.action === 'adminSellerDelete') {
    var gone = null;
    sellerRows().forEach(function (r) { if (String(r.row[S.nick]) === String(d.nick)) gone = r; });
    if (!gone) return { ok: false, error: '없는 판매자예요.' };
    var rowsToGo = itemRows().filter(function (r) { return String(r.row[I.seller]) === String(d.nick); })
      .map(function (r) { return r.index; }).sort(function (a, b) { return b - a; });
    rowsToGo.forEach(function (i) { itemSheet().deleteRow(i); });
    sellerSheet().deleteRow(gone.index);
    return { ok: true, items: rowsToGo.length };
  }
  // 비밀번호를 잊은 판매자: 임시 비밀번호를 만들어 돌려준다. 기존 로그인은 모두 풀린다.
  if (d.action === 'adminSellerReset') {
    var who = null;
    sellerRows().forEach(function (r) { if (String(r.row[S.nick]) === String(d.nick)) who = r; });
    if (!who) return { ok: false, error: '없는 판매자예요.' };
    var temp = tempPassword();
    sellerSheet().getRange(who.index, S.key + 1).setValue('');
    sellerSheet().getRange(who.index, S.pw + 1).setValue(hashPassword(temp));
    return { ok: true, loginId: String(who.row[S.loginId]), tempPassword: temp };
  }
  if (d.action === 'adminOwnSave') {
    var p = d.product || {};
    var name = clip(p.name, 40), cat = clip(p.cat, 12), price = Math.round(Number(p.price));
    if (!name || !cat) return { ok: false, error: '상품 이름과 분류를 적어 주세요.' };
    if (!(price >= 0 && price <= 100000000)) return { ok: false, error: '가격은 0원부터 1억 원까지 적을 수 있어요.' };
    var vals = [text(cat), text(name), price, text(clip(p.unit, 20)), text(clip(p.desc, 200)), text(clip(p.seller, 30)),
      p.sample === true ? 'O' : '', Number(p.order) || 0, new Date()];
    var sheet = ownSheet();
    var hit2 = d.id ? findOwn(d.id) : null;
    if (d.id && !hit2) return { ok: false, error: '없는 상품이에요.' };
    if (hit2) sheet.getRange(hit2.index, O.cat + 1, 1, vals.length).setValues([vals]);
    else sheet.appendRow(['p' + Date.now().toString(36)].concat(vals));
    return { ok: true, own: ownList() };
  }
  if (d.action === 'adminOwnDelete') {
    var hit3 = findOwn(d.id);
    if (!hit3) return { ok: false, error: '없는 상품이에요.' };
    ownSheet().deleteRow(hit3.index);
    return { ok: true, own: ownList() };
  }
  return { ok: false, error: '알 수 없는 요청이에요.' };
}

// ---------- 운영 상품(운영자가 직접 파는 상품과 샘플) ----------
// 탭이 없으면 null(아직 옮기기 전). 손님 화면은 그때 products.json을 그대로 쓴다.
function ownItems() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OWN_TAB);
  if (!sheet) return null;
  return readRows(sheet, OWN_HEADER.length).filter(function (r) { return String(r.row[O.id]) && String(r.row[O.name]); })
    .map(function (r) {
      var row = r.row;
      return { id: String(row[O.id]), cat: String(row[O.cat]), name: String(row[O.name]), price: Number(row[O.price]) || 0,
        unit: String(row[O.unit]), desc: String(row[O.desc]), seller: String(row[O.seller]),
        sample: String(row[O.sample]).trim() !== '', order: Number(row[O.order]) || 0 };
    }).sort(function (a, b) { return a.order - b.order; });
}
// 관리자가 처음 들어오면 탭을 만들고 products.json의 상품을 옮겨 둔다
function ownList() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OWN_TAB)) {
    var sheet = ownSheet();
    var rows = seedProducts().map(function (p) {
      return [String(p.id), text(String(p.cat || '기타')), text(String(p.name || '')), Number(p.price) || 0, text(String(p.unit || '')),
        text(String(p.desc || '')), text(String(p.seller || '')), p.sample === true ? 'O' : '', Number(p.order) || 0, new Date()];
    });
    if (rows.length) sheet.getRange(2, 1, rows.length, OWN_HEADER.length).setValues(rows);
  }
  return ownItems();
}
function seedProducts() {
  return JSON.parse(UrlFetchApp.fetch(PRODUCTS_URL + '?t=' + Date.now()).getContentText()).products || [];
}
function ownSheet() { return tab(OWN_TAB, OWN_HEADER); }
function findOwn(id) {
  id = String(id || '');
  var hit = null;
  readRows(ownSheet(), OWN_HEADER.length).forEach(function (r) { if (String(r.row[O.id]) === id) hit = r; });
  return hit;
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

function sellerRowByKey(key) {
  key = String(key || '');
  if (key.length < 8) return null;
  var hit = null;
  sellerRows().forEach(function (r) { if (String(r.row[S.key]) === key && r.row[S.status] !== STOPPED) hit = r; });
  return hit;
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
function tempPassword() {
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789', out = '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  for (var i = 0; i < 8; i++) out += chars.charAt(((bytes[i] % 256) + 256) % chars.length);
  return out;
}
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

// 아이디: 앞뒤 빈칸을 빼고, 빈칸 여러 개는 하나로, 영어는 소문자로
function normId(v) { return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 20); }
function normEmail(v) { return String(v || '').trim().toLowerCase().slice(0, 60); }
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(v)); }
function clip(v, n) { return String(v || '').trim().slice(0, n); }
function text(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
