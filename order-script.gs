// 무엇이든 상점 주문 받기 (구글 시트용 Apps Script)
// 쇼핑몰에서 손님이 주문하면 이 시트에 한 줄씩 쌓입니다.
// 가격은 손님 브라우저가 보낸 값이 아니라 저장소의 products.json으로 다시 계산합니다.

var PRODUCTS_URL = 'https://raw.githubusercontent.com/ljh0283ljh0283ljh0283-blip/anything-shop/main/products.json';
var HEADER = ['주문번호', '주문 시각', '이름', '연락처', '받는 곳', '남긴 말', '입금자', '상품', '판매자', '금액', '상태'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse(e.postData.contents);
    var name = clip(d.name, 20), phone = clip(d.phone, 20);
    if (!name || !phone) return reply({ ok: false, error: '이름과 연락처가 필요해요.' });

    var list = JSON.parse(UrlFetchApp.fetch(PRODUCTS_URL + '?t=' + Date.now()).getContentText()).products || [];
    var byId = {};
    list.forEach(function (p) { byId[p.id] = p; });

    var total = 0, lines = [], sellers = [];
    (d.items || []).forEach(function (it) {
      var p = byId[it.id];
      var qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 0)));
      if (!p) return;
      total += Number(p.price) * qty;
      lines.push(p.name + ' × ' + qty + ' (' + Number(p.price).toLocaleString() + '원)');
      if (p.seller && sellers.indexOf(p.seller) < 0) sellers.push(p.seller);
    });
    if (!lines.length) return reply({ ok: false, error: '주문할 상품이 없어요.' });

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADER);
    var orderNo = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 90 + 10);
    // 수식으로 해석되지 않도록 손님이 적은 칸은 글자로 저장한다
    sheet.appendRow([orderNo, new Date(), text(name), "'" + phone, text(clip(d.place, 100)), text(clip(d.memo, 200)),
      text(clip(d.payer, 20) || name), lines.join('\n'), sellers.join(', '), total, '입금 대기']);
    return reply({ ok: true, orderNo: orderNo, total: total });
  } catch (err) {
    return reply({ ok: false, error: '주문을 저장하지 못했어요.' });
  } finally {
    lock.releaseLock();
  }
}

function clip(v, n) { return String(v || '').trim().slice(0, n); }
function text(v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }
function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
