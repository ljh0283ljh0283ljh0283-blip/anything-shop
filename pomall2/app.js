// SEKI POmall 발주: 거래처가 로그인해 사양(모델, 와이어 길이, 동작온도)을 골라 선주문 생산을 요청한다.
// 모델 단가와 할인율은 거래처마다 다르다. 회사가 관리 > 거래처 단가에서 정하고, 거래처는 로그인해야 자기 단가만 본다.
// 제품 목록과 범위는 products.json, 주문 저장 위치는 settings.json에서 정한다.
// 저장 위치를 바꾸려면 STORAGES에 같은 일을 하는 항목을 더하고 settings.json의 storage 값을 그 이름으로 바꾼다.
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var KEY = { cart: 'pomall.cart', session: 'pomall.session', admin: 'pomall.admin', recent: 'pomall.recent', localOrders: 'pomall.orders', localCustomers: 'pomall.customers', localLead: 'pomall.lead', localHelp: 'pomall.help', localReset: 'pomall.reset', lang: 'pomall.lang' };
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
    return null;
  }

  // ----- 언어: 한국어 / English -----
  // 주소 끝에 ?lang=en 을 붙이면 영어로 연다(해외 바이어에게 보내는 주소). 고른 언어는 이 기기에 기억한다.
  // 처음 오는 사람은 브라우저 언어가 한국어가 아니면 영어로 보여 준다. 회사용 관리 화면은 한국어 그대로다.
  var LANG = (function () {
    var q = (location.search.match(/[?&]lang=(en|ko)\b/) || [])[1];
    if (q) { store(KEY.lang, q); return q; }
    var saved = store(KEY.lang);
    return saved === 'en' || saved === 'ko' ? saved : /^ko\b/i.test(navigator.language || 'ko') ? 'ko' : 'en';
  })();
  function T(ko, en) { return LANG === 'en' ? en : ko; }
  var STATUS_EN = { '접수 대기': 'Received', '생산 지시': 'Production ordered', '생산 중': 'In production', '입고 완료': 'Ready to ship', '출하': 'Shipped', '취소': 'Cancelled' };
  // 서버(Apps Script, 회사 서버)가 보내는 한국어 안내를 영어로 바꾼다. 없는 문장은 화면의 영어 안내로 대신한다.
  var EN_ERR = [
    [/거래처 코드나 비밀번호가 맞지/, 'The customer code or password is incorrect.'],
    [/사용 중지된 거래처/, 'This account is suspended. Please contact your sales representative.'],
    [/다시 로그인/, 'Please sign in again.'],
    [/담당자, 연락처, 납품 주소가 필요/, 'Contact name, phone and delivery address are required.'],
    [/담긴 품목이 없/, 'Your order has no items.'],
    [/^없는 모델이에요/, 'Unknown model.'],
    [/^(\S+) 견적 모델이 아니에요/, '$1 is not one of your quoted models.'],
    [/^(\S+) 수량은 1EA 이상/, 'Quantity for $1 must be at least 1 EA.'],
    [/^(\S+) 희망납기일/, 'Please check the requested date for $1.'],
    [/^(\S+)는 단가가 정해지지/, '$1 has no price yet and cannot be ordered.'],
    [/^(\S+) 와이어 길이 2가 범위/, '$1 wire length 2 is out of range.'],
    [/^(\S+) 와이어 길이가 범위/, '$1 wire length is out of range.'],
    [/^(\S+) 마감을 다시/, 'Please choose the $1 finish again.'],
    [/^(\S+) (.+) 항목을 골라/, 'Please choose the $1 $2.'],
    [/^(\S+) 탈피 길이는/, '$1 strip length must be shorter than the wire, in 0.1 mm steps.'],
    [/^(\S+) 복귀온도는/, '$1 reset temperature must be lower than the operating temperature, in 5°C steps.'],
    [/^(\S+) 동작온도가 범위/, '$1 operating temperature is out of range.'],
    [/^수량은 (\d+)EA 이상 (\d+)EA 단위/, 'Quantity must be at least $1 EA, in steps of $2 EA.'],
    [/발주서는 PDF/, 'The PO file must be a PDF, image, Excel, Word or HWP file.'],
    [/10MB까지/, 'The PO file can be up to 10 MB.'],
    [/인증번호를 먼저/, 'Please request a verification number first.'],
    [/인증번호 시간이 지났/, 'The verification number has expired. Please request a new one.'],
    [/여러 번 틀렸/, 'Too many wrong tries. Please request a new verification number.'],
    [/인증번호가 맞지/, 'The verification number is incorrect.'],
    [/이 메일에 등록된 거래처 코드가 아니/, 'That customer code is not registered to this email.'],
    [/비밀번호는 4자 이상/, 'The password must be at least 4 characters.']
  ];
  function enErr(m) {
    for (var k = 0; k < EN_ERR.length; k++) {
      var r = m.match(EN_ERR[k][0]);
      if (r) return EN_ERR[k][1].replace(/\$(\d)/g, function (x, n) { return r[+n] || ''; });
    }
    return '';
  }

  var STATUS = { '접수 대기': 'st-received', '생산 지시': 'st-confirmed', '생산 중': 'st-production', '입고 완료': 'st-stocked', '출하': 'st-shipped', '취소': 'st-canceled' };
  var STATUS_LIST = Object.keys(STATUS);
  var ROLES = { admin: '관리자', sales: '영업팀', view: '조회 전용' };
  // 상태 규칙 (pomall-script.gs의 canMove, needsReason과 같다. 진짜 검사는 서버가 한다)
  //   영업팀: 앞으로만. 출하나 취소가 된 발주는 못 바꾼다.   관리자: 아무 상태로나.   조회 전용: 못 바꾼다.
  //   취소, 되돌리기, 취소된 발주 살리기는 사유가 있어야 한다.
  function canMove(role, from, to) {
    if (role === 'admin') return true;
    if (role !== 'sales' || from === '출하' || from === '취소') return false;
    return to === '취소' || STATUS_LIST.indexOf(to) > STATUS_LIST.indexOf(from);
  }
  function needsReason(from, to) { return to === '취소' || from === '취소' || STATUS_LIST.indexOf(to) < STATUS_LIST.indexOf(from); }

  // ----- 저장 위치 -----
  // 각 저장 위치는 같은 일을 한다:
  //   login(code, pw) → {customer, prices, quotes}      submit(auth, order) → {no, total, ...}      mine(auth) → [발주]
  //   staff(key) → 'admin' | 'sales' | 'view'      list(key) → [발주]      setStatus(key, {no, status, by, reason})
  //   config() → {lead}      saveLead(key, {days, bigQty, bigDays, by})      shipDate(key, {no, date, by})
  //   customers(key) → [거래처]      saveCustomer(key, 거래처 + oldCode)      deleteCustomer(key, code)
  //   resetStart({email, lang}) → 등록된 메일로 거래처 코드와 인증번호 발송      resetFinish({email, code, otp, pw})
  //   requestHelp({company, contact, phone, what, memo})      helpList(key) → [요청]      helpDone(key, {id, by})
  var STORAGES = {
    // 구글 시트 + Apps Script 웹 앱 (pomall-script.gs)
    sheet: function (cfg) {
      // text/plain 본문이라 브라우저가 사전 확인(CORS preflight) 없이 보낸다. 비밀번호가 주소에 남지 않도록 모두 POST로 보낸다.
      function call(body) {
        return fetch(cfg.orderUrl, { method: 'POST', body: JSON.stringify(body) }).then(function (r) { return r.json(); })
          .then(function (d) { if (!d.ok) throw new Error(d.error || '요청을 처리하지 못했어요.'); return d; });
      }
      return {
        ready: !!cfg.orderUrl,
        login: function (code, pw) { return call({ action: 'login', code: code, pw: pw }); },
        submit: function (auth, order) { return call({ action: 'order', code: auth.code, pw: auth.pw, order: order }).then(function (d) { return d.order; }); },
        mine: function (auth) { return call({ action: 'mine', code: auth.code, pw: auth.pw }).then(function (d) { return d.orders; }); },
        staff: function (key) { return call({ action: 'staff', key: key }).then(function (d) { return d.role; }); },
        config: function () { return call({ action: 'config' }); },
        saveLead: function (key, L) { return call(Object.assign({ action: 'saveLead', key: key }, L)); },
        shipDate: function (key, c) { return call({ action: 'shipDate', key: key, no: c.no, date: c.date, by: c.by }); },
        staffMemo: function (key, c) { return call({ action: 'staffMemo', key: key, no: c.no, memo: c.memo, by: c.by }); },
        list: function (key) { return call({ action: 'list', key: key }).then(function (d) { return d.orders; }); },
        setStatus: function (key, c) { return call({ action: 'status', key: key, no: c.no, status: c.status, by: c.by, reason: c.reason }); },
        customers: function (key) { return call({ action: 'customers', key: key }).then(function (d) { return d.customers; }); },
        saveCustomer: function (key, c) { return call({ action: 'saveCustomer', key: key, customer: c }); },
        deleteCustomer: function (key, code) { return call({ action: 'deleteCustomer', key: key, code: code }); },
        resetStart: function (r) { return call({ action: 'resetStart', email: r.email, lang: r.lang }); },
        resetFinish: function (r) { return call({ action: 'resetFinish', email: r.email, code: r.code, otp: r.otp, pw: r.pw }); },
        requestHelp: function (r) { return call(Object.assign({ action: 'help' }, r)); },
        helpList: function (key) { return call({ action: 'helpList', key: key }).then(function (d) { return d.requests; }); },
        helpDone: function (key, c) { return call({ action: 'helpDone', key: key, id: c.id, by: c.by }); }
      };
    },
    // 이 브라우저에만 저장 (화면 확인용). 다른 사람에게는 보이지 않는다.
    // 열쇠 검사가 없다: sales로 시작하는 열쇠는 영업팀, view로 시작하면 조회 전용, 나머지는 관리자로 본다.
    local: function () {
      function roleOf(key) { return /^sales/i.test(key) ? 'sales' : /^view/i.test(key) ? 'view' : 'admin'; }
      function orders() { return store(KEY.localOrders) || []; }
      function custs() { return store(KEY.localCustomers) || []; }
      function auth(code, pw) {
        var c = custs().filter(function (x) { return x.code === code && x.pw === pw && x.active; })[0];
        return c ? Promise.resolve(c) : Promise.reject(new Error('거래처 코드나 비밀번호가 맞지 않아요.'));
      }
      function pub(c) { return { no: c.no, code: c.code, name: c.name, contact: c.contact, phone: c.phone, email: c.email || '', address: c.address, active: c.active, prices: c.prices, quotes: c.quotes || [], discount: c.discount || 0, hasPassword: !!c.pw }; }
      return {
        ready: true,
        login: function (code, pw) { return auth(code, pw).then(function (c) { return { customer: pub(c), prices: c.prices, quotes: c.quotes || [], discount: c.discount || 0 }; }); },
        submit: function (a, order) {
          return auth(a.code, a.pw).then(function (c) {
            // 이 브라우저 저장 방식은 파일 내용을 두지 않고 이름만 남긴다
            var o = Object.assign({}, order, { attachment: '', attachmentName: order.attachment ? order.attachment.name : '', no: orderNo(orders(), c.no), code: c.code, company: c.name, createdAt: new Date().toISOString(), status: '접수 대기' });
            var list = orders(); list.unshift(o); store(KEY.localOrders, list); return o;
          });
        },
        mine: function (a) { return auth(a.code, a.pw).then(function (c) { return orders().filter(function (o) { return o.code === c.code; }); }); },
        staff: function (key) { return Promise.resolve(roleOf(key)); },
        config: function () { return Promise.resolve({ lead: store(KEY.localLead) }); },
        saveLead: function (key, L) { if (roleOf(key) === 'view') return Promise.reject(new Error('영업팀 권한이 필요해요.')); store(KEY.localLead, { days: +L.days, bigQty: +L.bigQty, bigDays: +L.bigDays }); return Promise.resolve({ ok: true }); },
        shipDate: function (key, c) {
          if (roleOf(key) === 'view') return Promise.reject(new Error('영업팀 권한이 필요해요.'));
          store(KEY.localOrders, orders().map(function (o) { if (o.no === c.no) o.shipDate = c.date; return o; })); return Promise.resolve({ ok: true });
        },
        staffMemo: function (key, c) {
          if (roleOf(key) === 'view') return Promise.reject(new Error('영업팀 권한이 필요해요.'));
          var by = c.by + ' · ' + new Date().toISOString();
          store(KEY.localOrders, orders().map(function (o) { if (o.no === c.no) { o.staffMemo = c.memo; o.staffMemoBy = by; } return o; })); return Promise.resolve({ ok: true, by: by });
        },
        list: function () { return Promise.resolve(orders()); },
        setStatus: function (key, c) {
          var role = roleOf(key), list = orders(), o = list.filter(function (x) { return x.no === c.no; })[0];
          if (!o) return Promise.reject(new Error('없는 발주예요.'));
          if (!canMove(role, o.status, c.status)) return Promise.reject(new Error(o.status + '에서 ' + c.status + '(으)로는 관리자만 바꿀 수 있어요.'));
          if (needsReason(o.status, c.status) && String(c.reason || '').trim().length < 2) return Promise.reject(new Error('사유를 적어 주세요.'));
          (o.log = o.log || []).push({ at: new Date().toISOString(), from: o.status, to: c.status, by: c.by, role: ROLES[role], reason: c.reason || '' });
          o.status = c.status; store(KEY.localOrders, list);
          return Promise.resolve({ ok: true });
        },
        customers: function () {
          // 번호가 없는 거래처는 목록 순서대로 번호를 붙인다
          var list = custs(), seq = list.reduce(function (m, c) { return Math.max(m, c.no || 0); }, 0);
          list.forEach(function (c) { if (!c.no) c.no = ++seq; }); store(KEY.localCustomers, list);
          return Promise.resolve(list.map(pub).sort(function (a, b) { return a.no - b.no; }));
        },
        saveCustomer: function (key, c) {
          var list = custs(), ex = list.filter(function (x) { return x.code === (c.oldCode || c.code); })[0];
          var renamed = !!(c.oldCode && c.oldCode !== c.code);
          if (renamed && list.some(function (x) { return x.code === c.code; })) return Promise.reject(new Error('이미 있는 거래처 코드예요.'));
          if ((!ex || renamed) && !c.pw) return Promise.reject(new Error('비밀번호가 필요해요.'));
          var row = Object.assign(ex || {}, { code: c.code, name: c.name, contact: c.contact, phone: c.phone, email: c.email || '', address: c.address, active: c.active, prices: c.prices, quotes: c.quotes || [], discount: c.discount });
          if (c.pw) row.pw = c.pw;
          if (!ex) { row.no = list.reduce(function (m, x) { return Math.max(m, x.no || 0); }, 0) + 1; list.push(row); }
          store(KEY.localCustomers, list);
          if (renamed) store(KEY.localOrders, orders().map(function (o) { if (o.code === c.oldCode) o.code = c.code; return o; }));
          return Promise.resolve({ ok: true });
        },
        deleteCustomer: function (key, code) {
          store(KEY.localCustomers, custs().filter(function (x) { return x.code !== code; })); return Promise.resolve({ ok: true });
        },
        // 이 브라우저 저장 방식은 메일을 보낼 수 없어서, 보낼 내용을 preview로 돌려주고 화면에 보여 준다
        resetStart: function (r) {
          var email = String(r.email || '').trim().toLowerCase();
          var mine = custs().filter(function (c) { return c.active && String(c.email || '').toLowerCase() === email; });
          if (!mine.length) return Promise.resolve({ ok: true });
          var otp = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
          store(KEY.localReset, { email: email, otp: otp, exp: Date.now() + 10 * 60000, tries: 0 });
          return Promise.resolve({ ok: true, preview: { codes: mine.map(function (c) { return c.code; }), otp: otp } });
        },
        resetFinish: function (r) {
          var email = String(r.email || '').trim().toLowerCase(), rec = store(KEY.localReset);
          if (!rec || rec.email !== email) return Promise.reject(new Error('인증번호를 먼저 받아 주세요.'));
          if (Date.now() > rec.exp) return Promise.reject(new Error('인증번호 시간이 지났어요. 다시 받아 주세요.'));
          if (rec.tries >= 5) return Promise.reject(new Error('여러 번 틀렸어요. 인증번호를 다시 받아 주세요.'));
          if (String(r.otp) !== rec.otp) { rec.tries++; store(KEY.localReset, rec); return Promise.reject(new Error('인증번호가 맞지 않아요.')); }
          var list = custs(), c = list.filter(function (x) { return x.code === r.code && x.active && String(x.email || '').toLowerCase() === email; })[0];
          if (!c) return Promise.reject(new Error('이 메일에 등록된 거래처 코드가 아니에요.'));
          if (String(r.pw || '').length < 4) return Promise.reject(new Error('비밀번호는 4자 이상이에요.'));
          c.pw = r.pw; store(KEY.localCustomers, list); store(KEY.localReset, null);
          return Promise.resolve({ ok: true });
        },
        requestHelp: function (r) {
          var list = store(KEY.localHelp) || [];
          list.unshift({ id: String(Date.now()), at: new Date().toISOString(), company: r.company, contact: r.contact, phone: r.phone, what: r.what, memo: r.memo, done: '', doneBy: '' });
          store(KEY.localHelp, list); return Promise.resolve({ ok: true });
        },
        helpList: function () { return Promise.resolve(store(KEY.localHelp) || []); },
        helpDone: function (key, c) {
          store(KEY.localHelp, (store(KEY.localHelp) || []).map(function (h) { if (h.id === c.id) { h.done = new Date().toISOString(); h.doneBy = c.by; } return h; }));
          return Promise.resolve({ ok: true });
        }
      };
    }
  };

  // ----- 상태 -----
  var C = null, settings = {}, api = null;
  var sel = { model: null, choice: {} };
  var session = store(KEY.session);      // {code, pw, customer, prices, quotes, discount}
  var cart = [];
  var history = [];
  var adminOrders = [], adminFilter = 'all', adminTab = 'orders', customers = [], editing = null, role = null, pending = null;

  // ----- 계산 -----
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var won = function (n) { return LANG === 'en' ? '₩' + Math.round(n).toLocaleString('en-US') : Math.round(n).toLocaleString('ko-KR') + '원'; };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var kday = function (d) { return LANG === 'en' ? '(' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ')' : (d.getMonth() + 1) + '/' + d.getDate() + '(' + '일월화수목금토'[d.getDay()] + ')'; };
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // 이 브라우저 저장 방식에서도 시트와 같은 모양: PO-날짜-그날의 일련번호
  // 발주번호: PO-날짜-거래처번호-그날 전체 몇 번째 (예: PO-261015-1-002)
  function orderNo(list, custNo) {
    var d = new Date(), prefix = 'PO-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-', max = 0;
    (list || []).forEach(function (o) { var m = String(o.no).match(/^PO-\d{6}-(?:\d+-)?(\d{3,})$/); if (m && o.no.indexOf(prefix) === 0) max = Math.max(max, +m[1]); });
    return prefix + (custNo ? custNo + '-' : '') + String(max + 1).padStart(3, '0');
  }
  function addBizDays(n) { var d = new Date(); d.setHours(0, 0, 0, 0); var k = 0; while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) k++; } return d; }
  function product(id) { return C.products.filter(function (p) { return p.id === id; })[0]; }
  // 와이어가 두 줄인 모델은 길이를 둘 다 적는다: ST-22W-L070-L100-T100
  // 마감(T, TD)은 맨 끝에 붙는다: ST-12-L070-T100-TD
  function specCode(model, len, temp, len2, finish) {
    return model + (len ? '-L' + String(len).padStart(3, '0') : '') + (len2 ? '-L' + String(len2).padStart(3, '0') : '') + '-T' + String(temp).padStart(3, '0') + (finish ? '-' + finish : '');
  }
  function finishes() { return C.finishes || []; }
  function renderFinish() {
    $('#finish').innerHTML = finishes().map(function (f) {
      return '<button type="button" data-finish="' + esc(f.code) + '" aria-pressed="' + (sel.finish === f.code) + '"><b>' + esc(f.code) + '</b>' + esc(f.name) + '</button>';
    }).join('');
  }
  function twoWires(p) { return !!p && p.wires === 2; }
  // 와이어가 없는 모델(products.json의 wires: 0)은 와이어 길이와 탈피를 받지 않는다
  function noWire(p) { return !!p && p.wires === 0; }
  // 핀 모델(products.json의 pinLength: true)은 핀 길이를 받는다
  function hasPin(p) { return !!p && !!p.pinLength; }
  // 마감을 고르지 않는 모델(products.json의 noFinish: true)
  function noFinish(p) { return !!p && !!p.noFinish; }
  // 복귀온도를 받는 모델(products.json의 resetTemp: true). 동작온도보다 낮게 tempStep 단위
  function hasReset(p) { return !!p && !!p.resetTemp; }
  // 품목의 복귀온도(복귀온도 모델이 아니거나 기록이 없으면 빈 글자)
  function rtempOf(i) { return hasReset(product(i.model)) && i.rtemp !== '' && i.rtemp != null ? +i.rtemp : ''; }
  // 체크박스로 하나를 고르는 항목(products.json의 choices). 모델의 choices에 적힌 것 중 고를 값이 있는 것만 받는다
  function choiceGroups(p) {
    var keys = (p && p.choices) || [];
    return (C.choices || []).filter(function (g) { return keys.indexOf(g.key) >= 0 && g.options && g.options.length; });
  }
  function choiceName(key) { var g = (C.choices || []).filter(function (x) { return x.key === key; })[0]; return g ? T(g.name, g.name_en || g.name) : key; }
  function renderChoices() {
    var p = product(sel.model), gs = choiceGroups(p);
    $('#choice-row').hidden = !gs.length; $('#choice-row').classList.toggle('single', gs.length === 1);
    $('#choice-row').innerHTML = gs.map(function (g) {
      return '<div class="field"><span class="field-label" id="ch-' + esc(g.key) + '">' + esc(T(g.name, g.name_en || g.name)) + '</span>' +
        '<div class="checks" role="group" aria-labelledby="ch-' + esc(g.key) + '">' + g.options.map(function (o) {
          return '<label><input type="checkbox" data-choice="' + esc(g.key) + '" value="' + esc(o) + '"' + (sel.choice[g.key] === o ? ' checked' : '') + '>' + esc(o) + '</label>';
        }).join('') + '</div></div>';
    }).join('');
  }
  function basePrice(model) { var v = session && session.prices ? Number(session.prices[model]) : 0; return v > 0 ? v : null; }
  // 최종 단가 = 거래처 모델 단가 × (1 - 거래처 할인율). 와이어 길이, 온도, 수량과 상관없다. 단가가 없으면 null.
  function unitPrice(p) {
    var base = basePrice(p.id); if (base == null) return null;
    return Math.round(base * (1 - ((session && session.discount) || 0) / 100) * 10) / 10;
  }
  // 견적 모델: 거래처 관리에서 영업 담당이 적은 주문모델과 견적단가. 할인율은 적용하지 않는다.
  function quotes() { return (session && session.quotes) || []; }
  function quotePrice(model) { var q = quotes().filter(function (x) { return x.model === model; })[0]; return q && Number(q.price) > 0 ? Number(q.price) : null; }
  // 발주서 품목의 단가: 견적 모델이면 견적단가, 아니면 모델 단가
  function unitOf(i) { if (i.quote) return quotePrice(i.model); var p = product(i.model); return p ? unitPrice(p) : null; }
  function leadDays(items) { return items.some(function (i) { return i.qty >= C.lead.bigQty; }) ? C.lead.bigDays : C.lead.days; }
  function totals(items) { var net = items.reduce(function (s, i) { return s + i.unit * i.qty; }, 0); return { net: net, vat: net * C.price.vat, total: net * (1 + C.price.vat) }; }

  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }
  function say(el, text, isErr) { el.textContent = text || ''; el.classList.toggle('err', !!isErr); }
  function errText(err, fallback) {
    var m = err && err.message && !/fetch|network|json|token/i.test(err.message) ? err.message : '';
    if (m && LANG === 'en') m = enErr(m);
    return m || fallback;
  }

  // ----- 로그인 -----
  function auth() { return { code: session.code, pw: session.pw }; }
  function renderSession() {
    var on = !!session;
    // 로그인 전에는 로그인 화면만 보이고, 주문하기·주문 조회 탭은 감춘다
    $('#tab-order').hidden = !on; $('#tab-history').hidden = !on;
    $('#who').hidden = !on;
    if (on) $('#who-name').textContent = session.customer.name + ' (' + session.code + ')';
    if (C) { renderModels(); renderSpec(); renderQuotes(); }
  }
  function login(code, pw, quiet) {
    return api.login(code, pw).then(function (d) {
      session = { code: code, pw: pw, customer: d.customer, prices: d.prices || {}, quotes: d.quotes || [], discount: Number(d.discount) || 0 };
      store(KEY.session, session);
      cart = (store(KEY.cart) || {})[code] || [];
      repriceCart(); renderSession(); renderCart();
      if (!quiet) { toast(T(d.customer.name + '으로 로그인했어요', 'Signed in as ' + d.customer.name)); show('order'); }
    });
  }
  function logout() {
    session = null; store(KEY.session, null); cart = []; history = [];
    $('#checkout').hidden = true; $('#history-wrap').hidden = true;
    renderSession(); renderCart();
  }
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('#login-code').value.trim().toUpperCase(), pw = $('#login-pw').value, msg = $('#login-msg');
    if (!code || !pw) { say(msg, T('거래처 코드와 비밀번호를 넣어 주세요.', 'Enter your customer code and password.'), true); return; }
    if (!settings.open || !api.ready) { say(msg, T('아직 로그인을 받지 않아요. 정식 오픈 후에 다시 와 주세요.', 'Sign-in is not open yet. Please come back after launch.'), true); return; }
    say(msg, T('확인하는 중이에요…', 'Checking…')); $('#login-btn').disabled = true;
    login(code, pw).then(function () { say(msg, ''); $('#login-pw').value = ''; })
      .catch(function (err) { say(msg, errText(err, T('로그인하지 못했어요. 잠시 후 다시 눌러 주세요.', 'Could not sign in. Please try again in a moment.')), true); })
      .then(function () { $('#login-btn').disabled = false; });
  });
  $('#logout').addEventListener('click', function () { logout(); show('order'); toast(T('로그아웃했어요', 'Signed out')); });

  // ----- 사양 입력 -----
  function renderModels() {
    $('#models').innerHTML = C.products.map(function (p) {
      var b = basePrice(p.id);
      var price = !session ? T('로그인 후 단가', 'Sign in for price') : b == null ? T('단가 문의', 'Price on request') : T('단가 ', 'Unit ') + won(unitPrice(p));
      return '<button type="button" class="model" data-id="' + esc(p.id) + '" aria-pressed="' + (p.id === sel.model) + '"><b>' + esc(p.id) + '</b>' +
        '<small>' + esc(LANG === 'en' && p.name_en ? p.name_en : p.name) + ' · ' + p.temp[0] + '~' + p.temp[1] + '°C</small><span class="price">' + price + '</span></button>';
    }).join('');
  }
  function renderChips() {
    var p = product(sel.model), L = C.length, Q = C.qty;
    $('#len-field').hidden = noWire(p);
    $('#finish-field').hidden = noFinish(p); $('#finish-row').classList.toggle('no-finish', noFinish(p));
    $('#pin-field').hidden = !hasPin(p); $('#finish-row').classList.toggle('has-pin', hasPin(p));
    renderChoices();
    if (C.pin) $('#pin-hint').textContent = C.pin.min + '~' + C.pin.max + 'mm, ' + T('0.1mm 단위', 'in 0.1 mm steps');
    $('#len2-field').hidden = !twoWires(p);
    $('#len-label').textContent = twoWires(p) ? T('와이어 길이 1', 'Wire length 1') : T('와이어 길이', 'Wire length');
    if (twoWires(p) && !$('#len2').value) $('#len2').value = $('#len').value;
    $('#len-hint').textContent = L.min + '~' + L.max + 'mm, ' + T(L.step + 'mm 단위', 'in ' + L.step + ' mm steps');
    $('#rtemp-field').hidden = !hasReset(p);
    $('#rtemp-hint').textContent = T('동작온도보다 낮게, ' + C.tempStep + '°C 단위', 'Below the operating temperature, in ' + C.tempStep + '°C steps');
    $('#temp-hint').textContent = p.id + ': ' + p.temp[0] + '~' + p.temp[1] + '°C, ' + T(C.tempStep + '°C 단위', 'in ' + C.tempStep + '°C steps');
    $('#qty-hint').textContent = T('최소 ' + Q.min.toLocaleString() + 'EA, ' + Q.step + 'EA 단위', 'Min. ' + Q.min.toLocaleString() + ' EA, in ' + Q.step + ' EA steps');
  }
  function validate() {
    var p = product(sel.model), L = C.length, Q = C.qty;
    var len = noWire(p) ? 0 : +$('#len').value, len2 = twoWires(p) ? +$('#len2').value : 0, temp = +$('#temp').value, qty = +$('#qty').value, errs = [];
    var badLen = function (v) { return !v || v < L.min || v > L.max || v % L.step; };
    if (!noWire(p) && badLen(len)) errs.push(T('와이어 길이는 ' + L.min + '~' + L.max + 'mm 사이 ' + L.step + 'mm 단위로 입력하세요.', 'Enter a wire length of ' + L.min + '–' + L.max + ' mm in ' + L.step + ' mm steps.'));
    if (twoWires(p) && badLen(len2)) errs.push(T('와이어 길이 2는 ' + L.min + '~' + L.max + 'mm 사이 ' + L.step + 'mm 단위로 입력하세요.', 'Enter wire length 2 of ' + L.min + '–' + L.max + ' mm in ' + L.step + ' mm steps.'));
    // 탈피는 선택 사항: 비워 두면 0, 적으면 0.1mm 단위로 와이어 길이보다 짧게
    var strip = noWire(p) ? 0 : +$('#strip').value || 0, strip2 = twoWires(p) ? +$('#strip2').value || 0 : 0;
    var badStrip = function (v, l) { return v && (v < 0 || v >= l || Math.abs(Math.round(v * 10) - v * 10) > 1e-9); };
    if (badStrip(strip, len)) errs.push(T('탈피' + (twoWires(p) ? ' 1' : '') + '은 와이어 길이보다 짧게 0.1mm 단위로 입력하세요.', 'Strip' + (twoWires(p) ? ' 1' : '') + ' must be shorter than the wire length, in 0.1 mm steps.'));
    if (badStrip(strip2, len2)) errs.push(T('탈피 2는 와이어 길이 2보다 짧게 0.1mm 단위로 입력하세요.', 'Strip 2 must be shorter than wire length 2, in 0.1 mm steps.'));
    var pin = hasPin(p) ? +$('#pin').value || 0 : 0, PN = C.pin || { min: 0.1, max: 1000 };
    if (hasPin(p) && (!pin || pin < PN.min || pin > PN.max || Math.abs(Math.round(pin * 10) - pin * 10) > 1e-9)) errs.push(T('핀 길이는 ' + PN.min + '~' + PN.max + 'mm 사이 0.1mm 단위로 입력하세요.', 'Enter a pin length of ' + PN.min + '–' + PN.max + ' mm in 0.1 mm steps.'));
    if (!temp || temp < p.temp[0] || temp > p.temp[1] || temp % C.tempStep) errs.push(T(p.id + ' 동작온도는 ' + p.temp[0] + '~' + p.temp[1] + '°C 사이 ' + C.tempStep + '°C 단위로 입력하세요.', 'Enter a ' + p.id + ' operating temperature of ' + p.temp[0] + '–' + p.temp[1] + '°C in ' + C.tempStep + '°C steps.'));
    var rtemp = hasReset(p) ? +$('#rtemp').value || 0 : 0;
    if (hasReset(p) && (!$('#rtemp').value || rtemp < 0 || rtemp >= temp || rtemp % C.tempStep)) errs.push(T('복귀온도는 동작온도보다 낮게 ' + C.tempStep + '°C 단위로 입력하세요.', 'Enter a reset temperature below the operating temperature, in ' + C.tempStep + '°C steps.'));
    var ch = {};
    choiceGroups(p).forEach(function (g) {
      ch[g.key] = g.options.indexOf(sel.choice[g.key]) >= 0 ? sel.choice[g.key] : '';
      if (!ch[g.key]) errs.push(T(g.name + ' 항목을 골라 주세요.', 'Choose the ' + (g.name_en || g.name).toLowerCase() + '.'));
    });
    if (!qty || qty < Q.min || qty % Q.step) errs.push(T('수량은 ' + Q.min + 'EA 이상 ' + Q.step + 'EA 단위로 입력하세요.', 'Enter a quantity of at least ' + Q.min + ' EA in ' + Q.step + ' EA steps.'));
    return { p: p, len: len, len2: len2, strip: strip, strip2: strip2, pin: pin, speed: ch.speed || '', terminal: ch.terminal || '', term: ch.term || '', rtemp: rtemp, temp: temp, qty: qty, finish: noFinish(p) ? '' : sel.finish || '', errs: errs };
  }
  function renderSpec() {
    var v = validate(), add = $('#add-btn');
    $('#spec-code').textContent = specCode(v.p.id, v.len || 0, v.temp || 0, twoWires(v.p) ? v.len2 || 0 : 0, v.finish);
    if (v.errs.length) { $('#spec-meta').textContent = ''; $('#spec-err').textContent = v.errs[0]; add.disabled = true; return; }
    $('#spec-err').textContent = '';
    if (!session) { $('#spec-meta').textContent = T('로그인하면 우리 회사 단가로 금액이 나옵니다.', 'Sign in to see the amount at your prices.'); add.disabled = true; return; }
    var u = unitPrice(v.p);
    if (u == null) { $('#spec-meta').textContent = T(v.p.id + '는 아직 단가가 정해지지 않았어요. 담당 영업에 문의해 주세요.', v.p.id + ' has no price for your account yet. Please contact your sales representative.'); add.disabled = true; return; }
    $('#spec-meta').textContent = T('단가 ', 'Unit price ') + won(u) + ' × ' + v.qty.toLocaleString() + 'EA = ' + won(u * v.qty);
    add.disabled = false;
  }
  function selectModel(id) {
    sel.model = id; renderModels(); renderChips();
    var p = product(id), t = +$('#temp').value;
    if (!(t >= p.temp[0] && t <= p.temp[1])) $('#temp').value = (C.tempPresets[p.family] || [p.temp[0]])[0];
  }
  function setSpec(model, len, temp, qty, len2, finish, strip, strip2, pin, choice, rtemp) {
    if (!product(model)) return;
    if (choice) Object.keys(choice).forEach(function (k) { if (choice[k]) sel.choice[k] = choice[k]; });
    if (finish) { sel.finish = finish; renderFinish(); }
    $('#len').value = len; $('#len2').value = len2 || ''; $('#strip').value = strip || ''; $('#strip2').value = strip2 || ''; $('#pin').value = pin || ''; $('#rtemp').value = rtemp || ''; $('#temp').value = temp; if (qty) $('#qty').value = qty;
    selectModel(model); renderSpec();
  }

  // ----- 발주서 (거래처마다 따로 보관) -----
  function saveCart() { if (!session) return; var all = store(KEY.cart) || {}; if (Array.isArray(all)) all = {}; all[session.code] = cart; store(KEY.cart, all); }
  function repriceCart() {
    cart = cart.filter(function (i) { return i.quote && (i.unit = unitOf(i)) != null; });
    saveCart();
  }
  function renderCart() {
    $('#cart').innerHTML = cart.map(function (i, k) {
      return '<li class="cart-item"><code>' + esc(i.code) + '</code><span class="money">' + won(i.unit * i.qty) + '</span>' +
        '<div class="sub"><label for="cq-' + k + '">' + T('수량', 'Qty') + '</label><input class="num" id="cq-' + k + '" data-k="' + k + '" type="number" step="' + (i.quote ? 1 : C.qty.step) + '" min="' + (i.quote ? 1 : C.qty.min) + '" value="' + i.qty + '">' +
        '<span>× ' + won(i.unit) + '</span>' + (stripText(i) ? '<span>· ' + esc(stripText(i)) + '</span>' : '') + (i.due ? '<span>· ' + T('희망납기 ', 'Requested ') + esc(i.due) + '</span>' : '') + (i.memo ? '<span>· ' + esc(i.memo) + '</span>' : '') +
        '<button type="button" class="btn ghost small" data-del="' + k + '">' + T('빼기', 'Remove') + '</button></div></li>';
    }).join('');
    $('#cart-empty').hidden = cart.length > 0;
    $('#cart-sum').hidden = !cart.length;
    var c = $('#cart-count'); c.hidden = !cart.length; c.textContent = cart.length;
    if (!cart.length) { $('#checkout').hidden = true; return; }
    var t = totals(cart), d = addBizDays(leadDays(cart));
    $('#sum-net').textContent = won(t.net); $('#sum-vat').textContent = won(t.vat); $('#sum-total').textContent = won(t.total);
    $('#eta').innerHTML = T('오늘 확정하면 생산 소요 <b>' + leadDays(cart) + '영업일</b>, 예상 출하일 <b>' + ymd(d) + '</b> ' + kday(d) + '.<br>선주문 생산이라 재고 출고는 없습니다.',
      'If you order today: production takes <b>' + leadDays(cart) + ' business days</b>, estimated ship date <b>' + ymd(d) + '</b> ' + kday(d) + '.<br>All items are built to order; nothing ships from stock.');
    var di = $('#c-date'); di.min = ymd(d); if (!di.value || di.value < ymd(d)) di.value = ymd(d);
    $('#date-hint').textContent = T('가장 빠른 출하일 ', 'Earliest ship date ') + ymd(d);
  }
  function addToCart() {
    var v = validate(); if (v.errs.length || !session) return;
    var unit = unitPrice(v.p); if (unit == null) return;
    var code = specCode(v.p.id, v.len, v.temp, v.len2, v.finish), memo = $('#item-memo').value.trim();
    var ex = cart.filter(function (i) { return i.code === code && i.memo === memo && (i.strip || 0) === v.strip && (i.strip2 || 0) === v.strip2 && (i.pin || 0) === v.pin && (i.speed || '') === v.speed && (i.terminal || '') === v.terminal && (i.term || '') === v.term && (i.rtemp || 0) === v.rtemp; })[0];
    if (ex) { ex.qty += v.qty; ex.unit = unitPrice(v.p); }
    else cart.push({ code: code, model: v.p.id, len: v.len, len2: v.len2, strip: v.strip, strip2: v.strip2, pin: v.pin, speed: v.speed, terminal: v.terminal, term: v.term, rtemp: v.rtemp, finish: v.finish, temp: v.temp, qty: v.qty, unit: unit, memo: memo });
    $('#item-memo').value = '';
    saveCart(); renderCart(); $('#done').hidden = true;
    toast(T(code + ' ' + v.qty.toLocaleString() + 'EA 담았습니다', 'Added ' + code + ' × ' + v.qty.toLocaleString() + ' EA'));
  }

  // ----- 견적 모델 주문 -----
  // 영업 담당이 거래처 관리에 적은 주문모델을 보여 주고, 확인을 체크한 줄을 발주서에 담는다
  function renderQuotes() {
    var on = !!session, list = quotes();
    $('#quote-panel').hidden = !on; if (!on) return;
    $('#quote-empty').hidden = list.length > 0; $('#quote-actions').hidden = !list.length;
    $('#quote-panel table').hidden = !list.length;
    $('#quote-body').innerHTML = list.map(function (q, k) {
      return '<tr><td><code>' + esc(q.model) + '</code><div class="q-price">' + T('견적단가 ', 'Quoted ') + won(q.price) + '</div></td>' +
        '<td><input type="checkbox" data-q="' + k + '" aria-label="' + esc(q.model) + ' ' + T('확인', 'confirm') + '"></td>' +
        '<td><input class="num" data-q-qty="' + k + '" type="number" min="1" step="1" inputmode="numeric" aria-label="' + T('수량', 'Quantity') + '"></td>' +
        '<td><input type="date" data-q-due="' + k + '" min="' + ymd(new Date()) + '" aria-label="' + T('희망납기일', 'Requested date') + '"></td>' +
        '<td><input class="q-memo" data-q-memo="' + k + '" maxlength="100" aria-label="' + T('품목메모', 'Item memo') + '"></td></tr>';
    }).join('');
    say($('#quote-err'), '');
  }
  function addQuotes() {
    var err = $('#quote-err'), list = quotes(), picked = [], bad = '';
    document.querySelectorAll('[data-q]').forEach(function (cb) {
      if (!cb.checked) return;
      var k = cb.dataset.q, q = list[+k]; if (!q) return;
      var qty = Number($('[data-q-qty="' + k + '"]').value), due = $('[data-q-due="' + k + '"]').value, memo = $('[data-q-memo="' + k + '"]').value.trim();
      if (!(qty >= 1 && qty === Math.floor(qty))) bad = bad || T(q.model + ' 수량을 1EA 이상으로 적어 주세요.', 'Enter a quantity of 1 EA or more for ' + q.model + '.');
      else if (due && due < ymd(new Date())) bad = bad || T(q.model + ' 희망납기일은 오늘 이후로 골라 주세요.', 'Choose a requested date from today for ' + q.model + '.');
      else picked.push({ quote: true, code: q.model, model: q.model, qty: qty, unit: Number(q.price), due: due, memo: memo });
    });
    if (bad) { say(err, bad, true); return; }
    if (!picked.length) { say(err, T('주문할 모델에 확인을 체크해 주세요.', 'Tick Confirm on the models you want to order.'), true); return; }
    picked.forEach(function (it) {
      var ex = cart.filter(function (i) { return i.quote && i.model === it.model && (i.due || '') === it.due && (i.memo || '') === it.memo; })[0];
      if (ex) { ex.qty += it.qty; ex.unit = it.unit; } else cart.push(it);
    });
    saveCart(); renderCart(); renderQuotes(); $('#done').hidden = true;
    toast(T(picked.length + '개 모델을 발주서에 담았습니다', 'Added ' + picked.length + ' model(s) to your order'));
  }
  $('#quote-add').addEventListener('click', addQuotes);
  // 수량이나 희망납기일을 적으면 확인도 자동으로 체크한다
  $('#quote-body').addEventListener('input', function (e) {
    var k = e.target.dataset.qQty || e.target.dataset.qDue;
    if (k !== undefined && e.target.value) $('[data-q="' + k + '"]').checked = true;
  });

  // ----- 발주 확정 -----
  function fillCheckout() {
    var c = session.customer;
    $('#c-company').value = c.name; $('#c-name').value = c.contact || ''; $('#c-phone').value = c.phone || ''; $('#c-addr').value = c.address || '';
  }
  function submitOrder(e) {
    e.preventDefault();
    var err = $('#checkout-err');
    if (!session) { err.textContent = T('로그인한 뒤에 발주할 수 있어요.', 'Please sign in to place an order.'); return; }
    var v = { name: $('#c-name').value.trim(), phone: $('#c-phone').value.trim(), po: $('#c-po').value.trim(), addr: $('#c-addr').value.trim() };
    var miss = [['name', T('담당자', 'contact name')], ['phone', T('연락처', 'phone')], ['addr', T('납품 주소', 'delivery address')]].filter(function (x) { return !v[x[0]]; }).map(function (x) { return x[1]; });
    if (miss.length) { err.textContent = T(miss.join(', ') + '을(를) 입력하세요.', 'Please enter ' + miss.join(', ') + '.'); return; }
    if (digits(v.phone).length < 8) { err.textContent = T('연락처를 숫자 8자리 이상으로 적어 주세요.', 'Please enter a phone number with at least 8 digits.'); return; }
    if (!cart.length) return;
    var ship = addBizDays(leadDays(cart)), t = totals(cart);
    var order = {
      contact: v.name, phone: v.phone, customerPo: v.po, address: v.addr,
      memo: $('#c-memo').value.trim(), requestedDate: $('#c-date').value || ymd(ship), eta: ymd(ship),
      items: cart.map(function (i) { if (i.quote) return { quote: true, model: i.model, code: i.model, qty: i.qty, unit: i.unit, due: i.due || '', memo: i.memo }; return { model: i.model, len: i.len, len2: i.len2 || 0, strip: i.strip || 0, strip2: i.strip2 || 0, pin: i.pin || 0, speed: i.speed || '', terminal: i.terminal || '', term: i.term || '', rtemp: i.rtemp || 0, finish: i.finish || '', temp: i.temp, qty: i.qty, memo: i.memo, code: i.code, unit: i.unit }; }),
      net: t.net, vat: t.vat, total: t.total
    };
    var f = $('#c-file').files[0];
    if (f && !ATTACH_OK.test(f.name)) { err.textContent = T('발주서는 PDF, 사진, 엑셀, 워드, 한글 파일만 첨부할 수 있어요.', 'The PO file must be a PDF, image, Excel, Word or HWP file.'); return; }
    if (f && f.size > 10 * 1024 * 1024) { err.textContent = T('발주서 파일은 10MB까지 첨부할 수 있어요.', 'The PO file can be up to 10 MB.'); return; }
    $('#submit-btn').disabled = true; err.textContent = f ? T('발주서와 함께 보내는 중이에요…', 'Sending your order with the PO file…') : T('발주를 보내는 중이에요…', 'Sending your order…');
    readFile(f).then(function (att) {
      if (att) order.attachment = att;
      return api.submit(auth(), order);
    }).then(function (saved) {
      err.textContent = ''; $('#c-file').value = '';
      rememberSpecs(cart);
      cart = []; saveCart(); renderCart();
      $('#checkout').hidden = true; $('#done').hidden = false;
      $('#done-no').textContent = saved.no;
      $('#done-text').textContent = T(session.customer.name + ' 발주가 접수되었습니다. 회사에서 생산을 확정하면 주문 조회의 상태가 바뀝니다. 합계 ' + won(saved.total || t.total) + ', 희망 출하일 ' + (saved.requestedDate || order.requestedDate) + '.',
        'We have received the order from ' + session.customer.name + '. The status in My orders changes when we confirm production. Total ' + won(saved.total || t.total) + ', requested ship date ' + (saved.requestedDate || order.requestedDate) + '.');
      $('#done').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }).catch(function (e2) {
      err.textContent = errText(e2, T('발주를 보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'Could not send the order. Check your connection and try again.'));
    }).then(function () { $('#submit-btn').disabled = false; });
  }

  // 첨부한 발주서를 글자(base64)로 바꿔 함께 보낸다
  var ATTACH_OK = /\.(pdf|jpe?g|png|xlsx?|docx?|hwpx?)$/i;
  function readFile(f) {
    if (!f) return Promise.resolve(null);
    return new Promise(function (ok, fail) {
      var r = new FileReader();
      r.onload = function () { ok({ name: f.name, data: String(r.result).split(',')[1] || '' }); };
      r.onerror = function () { fail(new Error(T('발주서 파일을 읽지 못했어요. 다시 골라 주세요.', 'Could not read the PO file. Please choose it again.'))); };
      r.readAsDataURL(f);
    });
  }
  // 시트에 남은 구글 드라이브 링크만 연다
  // 구글 드라이브 링크, 또는 회사 서버(pomall-server)가 저장한 /files/ 링크만 연다
  function serverFile(u) {
    try { var a = new URL(u, location.href), b = new URL(settings.orderUrl || '', location.href); return a.origin === b.origin && /^\/files\/[0-9a-f]{32}\//.test(a.pathname); } catch (e) { return false; }
  }
  function fileLink(o) {
    if (/^https:\/\/(drive|docs)\.google\.com\//.test(o.attachment || '') || serverFile(o.attachment || '')) return '<div class="order-items"><a href="' + esc(o.attachment) + '" target="_blank" rel="noopener">' + T('발주서 보기', 'View PO file') + '</a></div>';
    return o.attachmentName ? '<div class="order-items">' + T('발주서 ', 'PO file ') + esc(o.attachmentName) + '</div>' : '';
  }

  // ----- 최근 사양 (이 기기) -----
  function rememberSpecs(items) {
    var rec = store(KEY.recent) || [];
    var same = function (a, b) { return a.code === b.code && (a.strip || 0) === (b.strip || 0) && (a.strip2 || 0) === (b.strip2 || 0) && (a.pin || 0) === (b.pin || 0) && (a.speed || '') === (b.speed || '') && (a.terminal || '') === (b.terminal || '') && (a.term || '') === (b.term || '') && (a.rtemp || 0) === (b.rtemp || 0); };
    items.forEach(function (i) { if (i.quote) return; rec = rec.filter(function (r) { return !same(r, i); }); rec.unshift({ code: i.code, model: i.model, len: i.len, len2: i.len2 || 0, strip: i.strip || 0, strip2: i.strip2 || 0, pin: i.pin || 0, speed: i.speed || '', terminal: i.terminal || '', term: i.term || '', rtemp: i.rtemp || 0, finish: i.finish || '', temp: i.temp, qty: i.qty }); });
    store(KEY.recent, rec.slice(0, 8)); renderRecent();
  }
  function renderRecent() {
    var rec = store(KEY.recent) || [];
    // 모델 고르기 칸을 감췄으니 최근 사양도 보이지 않는다
    $('#reorder-panel').hidden = true;
    $('#recent-specs').innerHTML = rec.map(function (i) { return '<button type="button" class="chip" data-spec="' + esc([i.model, i.len, i.temp, i.qty, i.len2 || 0, i.finish || '', i.strip || 0, i.strip2 || 0, i.pin || 0, i.speed || '', i.terminal || '', i.term || '', i.rtemp || 0].join('|')) + '">' + esc(i.code + (stripText(i) ? ' (' + stripText(i) + ')' : '')) + '</button>'; }).join('');
  }

  // ----- 주문 조회 -----
  // 예전 상태 이름으로 남은 발주는 새 이름으로 보여 준다
  var OLD_STATUS = { '생산 확정': '생산 지시', '출하 완료': '출하' };
  function pill(s) { s = OLD_STATUS[s] || s || '접수 대기'; return '<span class="pill ' + (STATUS[s] || 'st-received') + '">' + esc(LANG === 'en' ? STATUS_EN[s] || s : s) + '</span>'; }
  // 마감(T, TD)을 이름과 함께 보여 준다. 마감 칸이 생기기 전 발주는 "기록 없음"
  function finishTag(i) {
    if (i.quote || !product(i.model) || !finishes().length || noFinish(product(i.model))) return '';
    var f = finishes().filter(function (x) { return x.code === i.finish; })[0];
    return '<div class="item-finish">' + T('마감: ', 'Finish: ') + (f ? '<b>' + esc(f.code) + '</b> ' + esc(f.name) : T('마감 없음', 'none')) + '</div>';
  }
  // 탈피 길이: 와이어가 두 줄이면 1·2를 나눠 적는다. 적지 않았으면 빈 글자
  function stripText(i) {
    var a = +i.strip || 0, b = +i.strip2 || 0, parts = [];
    if (rtempOf(i) !== '') parts.push(T('복귀온도 ', 'Reset ') + (+i.rtemp) + '°C');
    if (+i.pin) parts.push(T('핀 길이 ', 'Pin length ') + (+i.pin) + 'mm');
    else if (a || b) parts.push(T('탈피 ', 'Strip ') + (i.len2 ? '1: ' + (a ? a + 'mm' : T('없음', 'none')) + ', 2: ' + (b ? b + 'mm' : T('없음', 'none')) : a + 'mm'));
    // 전류감응속도·터미널방향(CK), 터미널(HB)
    ['speed', 'terminal', 'term'].forEach(function (k) { if (i[k]) parts.push(choiceName(k) + ' ' + i[k]); });
    return parts.join(', ');
  }
  // 품목 메모는 사양 코드 아래에 작게 보여 준다
  function itemsHtml(o) {
    return '<ul class="order-items">' + o.items.map(function (i) {
      return '<li>' + esc(i.code) + ' × ' + Number(i.qty).toLocaleString() + finishTag(i) + (stripText(i) ? '<div class="item-finish">' + esc(stripText(i)) + '</div>' : '') + (i.due ? '<div class="item-finish">' + T('희망납기 ', 'Requested ') + esc(i.due) + '</div>' : '') + (i.memo ? '<div class="item-memo">' + T('메모: ', 'Memo: ') + esc(i.memo) + '</div>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  // 담당자가 예상 출하일을 정했으면 그것을, 아니면 희망 출하일을 보여 준다 (시트 칸 이름은 '확정 출하일' 그대로)
  function shipText(o) {
    return o.shipDate ? '<b>' + esc(o.shipDate) + '</b><div class="order-items">' + T('예상 출하일', 'Estimated') + '</div>'
      : esc(o.requestedDate) + '<div class="order-items">' + T('희망 · 예상일 미정', 'Requested · not yet scheduled') + '</div>';
  }
  function loadHistory() {
    var msg = $('#history-msg');
    if (!session) { $('#history-wrap').hidden = true; say(msg, T('주문하기 화면에서 거래처 로그인을 하면 발주 내역이 보입니다.', 'Sign in on the Order page to see your orders.')); return; }
    say(msg, T('불러오는 중이에요…', 'Loading…'));
    api.mine(auth()).then(function (list) {
      history = list || [];
      $('#history-wrap').hidden = !history.length;
      say(msg, history.length ? '' : T('아직 접수한 발주가 없어요.', 'You have no orders yet.'));
      $('#history-body').innerHTML = history.map(function (o) {
        return '<tr><td class="mono">' + esc(o.no) + (o.customerPo ? '<div class="order-items">' + T('귀사 PO ', 'Your PO ') + esc(o.customerPo) + '</div>' : '') + fileLink(o) + '</td>' +
          '<td class="mono">' + esc(kst(o.createdAt).slice(0, 10)) + '</td><td>' + itemsHtml(o) + '</td>' +
          '<td class="mono">' + won(o.total) + '</td><td class="mono">' + shipText(o) + '</td><td>' + pill(o.status) + '</td>' +
          '<td><button type="button" class="btn ghost small" data-reorder="' + esc(o.no) + '">' + T('재주문', 'Reorder') + '</button></td></tr>';
      }).join('');
    }).catch(function (err) { say(msg, errText(err, T('불러오지 못했어요. 잠시 후 다시 열어 주세요.', 'Could not load your orders. Please try again in a moment.')), true); });
  }
  function reorder(no) {
    var o = history.filter(function (x) { return x.no === no; })[0]; if (!o) return;
    var n = 0, skipped = 0;
    o.items.forEach(function (i) {
      if (i.quote) {
        var qu = quotePrice(i.model);
        if (qu == null) { skipped++; return; }
        n++; cart.push({ quote: true, code: i.model, model: i.model, qty: +i.qty, unit: qu, due: '', memo: i.memo || '' }); return;
      }
      // 모델 고르기 칸을 감췄으니 견적 모델이 아닌 예전 품목은 다시 담지 않는다
      skipped++; return;
    });
    saveCart(); renderCart(); show('order'); $('#done').hidden = true;
    toast(T(o.no + '의 품목 ' + n + '개를 현재 단가로 담았습니다' + (skipped ? ' (견적 모델이 아닌 ' + skipped + '개 제외)' : ''),
      'Added ' + n + ' item(s) from ' + o.no + ' at current prices' + (skipped ? ' (' + skipped + ' not in your quoted models skipped)' : '')));
  }

  // ----- 관리 -----
  // 관리 열쇠는 팀마다 다르다(관리자, 영업팀, 조회 전용). 이름은 상태를 바꿀 때 기록에 남는다.
  function staffInfo() { var v = store(KEY.admin); return v && typeof v === 'object' && v.key ? v : null; }
  function adminKey() { var v = staffInfo(); return v ? v.key : null; }
  // 담당자로 열려 있으면 위쪽에 이름과 관리자 로그아웃을 보인다
  function renderStaff() {
    var info = staffInfo();
    $('#staff-who').hidden = !info;
    if (info) $('#staff-who-name').textContent = info.name + (role ? ' (' + ROLES[role] + ')' : '');
  }
  function staffLogout() {
    store(KEY.admin, null); role = null; $('#tab-admin').hidden = true; $('#tab-cust').hidden = true;
    closeCustInfo(); renderStaff(); show('order'); toast('관리자 로그아웃했어요');
  }
  function adminLoad() {
    var key = adminKey(), msg = $('#admin-msg');
    $('#key-form').hidden = !!key; $('#admin-wrap').hidden = !key;
    if (!key) return;
    if (!api.ready) { say(msg, '주문 받을 주소(orderUrl)가 아직 없어요. README의 순서대로 구글 시트를 연결해 주세요.', true); return; }
    say(msg, '불러오는 중이에요…');
    api.staff(key).then(function (r) {
      role = r;
      // 찾기 요청은 예전 Apps Script에는 없으니 못 받아 와도 나머지는 연다
      return Promise.all([api.list(key), canEdit() ? api.customers(key) : [], canEdit() && api.helpList ? api.helpList(key).catch(function () { return []; }) : []]);
    }).then(function (r) {
      adminOrders = r[0] || []; customers = r[1] || []; helps = r[2] || []; say(msg, '');
      $('#staff-badge').textContent = ROLES[role] + ' · ' + staffInfo().name;
      $('#staff-badge').className = 'role role-' + role;
      $('#tab-cust').hidden = !canEdit(); renderStaff();
      if (!canEdit() && adminTab === 'customers') { toast('거래처 관리는 영업팀과 관리자만 열 수 있어요'); return show('admin'); }
      renderAdmin(); renderLead(); if (canEdit()) { renderCustomers(); renderHelp(); }
      if (infoCode) renderCustInfo();
    }).catch(function (err) {
      store(KEY.admin, null); role = null; $('#key-form').hidden = false; $('#admin-wrap').hidden = true; renderStaff();
      say(msg, errText(err, '불러오지 못했어요.'), true);
    });
  }
  function showAdminTab(tab) {
    adminTab = tab;
    $('#admin-title').textContent = tab === 'customers' ? '거래처 관리' : '주문관리';
    $('#admin-orders').hidden = tab !== 'orders'; $('#admin-customers').hidden = tab !== 'customers';
  }
  function renderAdmin() {
    var counts = { all: adminOrders.length };
    STATUS_LIST.forEach(function (s) { counts[s] = adminOrders.filter(function (o) { return o.status === s; }).length; });
    $('#admin-filter').innerHTML = ['all'].concat(STATUS_LIST).map(function (k) {
      return '<button type="button" data-filter="' + esc(k) + '" aria-pressed="' + (adminFilter === k) + '">' + (k === 'all' ? '전체' : esc(k)) + ' ' + counts[k] + '</button>';
    }).join('');
    var list = adminOrders.filter(function (o) { return adminFilter === 'all' || o.status === adminFilter; });
    $('#admin-body').innerHTML = list.map(function (o) {
      return '<tr><td class="mono">' + esc(o.no) + '<div class="order-items">' + esc(kst(o.createdAt).slice(0, 16)) + '</div>' + (o.customerPo ? '<div class="order-items">PO ' + esc(o.customerPo) + '</div>' : '') + fileLink(o) + '</td>' +
        '<td><b>' + esc(o.company) + '</b> <span class="order-items">' + esc(o.code || '') + '</span><div class="order-items">' + esc(o.contact) + ' · ' + esc(o.phone) + '</div><div class="order-items">' + esc(o.address) + '</div>' + (o.memo ? '<div class="order-items">요청: ' + esc(o.memo) + '</div>' : '') + '</td>' +
        '<td>' + itemsHtml(o) + '</td><td class="mono">' + won(o.total) + '</td>' +
        '<td class="mono">' + shipCell(o) + '</td>' +
        '<td>' + statusCell(o) + '</td><td>' + memoCell(o) + '</td></tr>';
    }).join('');
    $('#admin-empty').hidden = list.length > 0;
  }
  function canEdit() { return role === 'admin' || role === 'sales'; }
  function shipCell(o) {
    var head = '<div class="order-items">희망 ' + esc(o.requestedDate) + ' · 최단 ' + esc(o.eta) + '</div>';
    if (!canEdit()) return (o.shipDate ? '<b>' + esc(o.shipDate) + '</b>' : '<span class="order-items">예상일 미정</span>') + head;
    return '<label class="ship"><span class="order-items">예상 출하일</span><input type="date" data-ship="' + esc(o.no) + '" value="' + esc(o.shipDate || '') + '"></label>' + head;
  }
  // 담당자 메모: 회사 담당자끼리만 보는 발주별 메모. 거래처 화면에는 나오지 않는다. 칸을 벗어나면 저장된다.
  function memoBy(o) {
    if (!o.staffMemoBy) return '';
    var m = String(o.staffMemoBy).match(/^(.*) · (.+)$/);
    return '<div class="order-items">' + esc(m ? m[1] + ' · ' + stamp(m[2]) : o.staffMemoBy) + '</div>';
  }
  function memoCell(o) {
    if (!canEdit()) return (o.staffMemo ? '<div class="staff-memo">' + esc(o.staffMemo) + '</div>' : '<span class="order-items">-</span>') + memoBy(o);
    return '<textarea class="staff-memo-input" data-smemo="' + esc(o.no) + '" maxlength="500" rows="3" placeholder="담당자끼리 남길 메모" aria-label="' + esc(o.no) + ' 담당자메모">' + esc(o.staffMemo || '') + '</textarea>' + memoBy(o);
  }
  function saveStaffMemo(input) {
    var no = input.dataset.smemo, memo = input.value.trim(), o = adminOrders.filter(function (x) { return x.no === no; })[0];
    if (!o || memo === (o.staffMemo || '')) return;
    input.disabled = true;
    api.staffMemo(adminKey(), { no: no, memo: memo, by: staffInfo().name }).then(function (r) {
      o.staffMemo = memo; o.staffMemoBy = (r && r.by) || staffInfo().name + ' · ' + new Date().toISOString();
      renderAdmin(); toast(no + ' 담당자메모를 저장했어요');
    }).catch(function (err) { input.disabled = false; toast(errText(err, '담당자메모를 저장하지 못했어요.')); });
  }
  function saveShip(input) {
    var no = input.dataset.ship, date = input.value;
    input.disabled = true;
    api.shipDate(adminKey(), { no: no, date: date, by: staffInfo().name }).then(function () {
      adminOrders.forEach(function (o) {
        if (o.no !== no) return;
        (o.log = o.log || []).push({ at: new Date().toISOString(), from: '출하일 ' + (o.shipDate || '미정'), to: '출하일 ' + (date || '미정'), by: staffInfo().name, role: ROLES[role], reason: '' });
        o.shipDate = date;
      });
      renderAdmin(); toast(no + ' 출하일 ' + (date || '미정'));
    }).catch(function (err) { toast(errText(err, '출하일을 저장하지 못했어요.')); renderAdmin(); });
  }
  // 생산 소요일 설정: 영업팀과 관리자가 바꾼다. 거래처 화면의 예상 출하일 계산에 바로 쓰인다.
  function renderLead() {
    var L = C.lead;
    $('#lead-now').textContent = L.days + '영업일 (' + Number(L.bigQty).toLocaleString() + 'EA 이상 ' + L.bigDays + '영업일)';
    $('#lead-days').value = L.days; $('#lead-bigqty').value = L.bigQty; $('#lead-bigdays').value = L.bigDays;
    $('#lead-form').querySelectorAll('input,button').forEach(function (el) { el.disabled = !canEdit(); });
    $('#lead-hint').textContent = canEdit() ? '바꾸면 거래처 화면의 예상 출하일이 바로 이 기준으로 계산돼요. 이미 들어온 발주는 바뀌지 않아요.' : '영업팀과 관리자만 바꿀 수 있어요.';
  }
  $('#lead-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var L = { days: +$('#lead-days').value, bigQty: +$('#lead-bigqty').value, bigDays: +$('#lead-bigdays').value, by: staffInfo().name };
    if (!(L.days >= 1 && L.days <= 120 && L.bigDays >= 1 && L.bigDays <= 120 && L.bigQty >= 1)) { say($('#lead-msg'), '영업일은 1~120, 수량은 1 이상으로 적어 주세요.', true); return; }
    say($('#lead-msg'), '저장하는 중이에요…');
    api.saveLead(adminKey(), L).then(function () {
      C.lead = { days: L.days, bigQty: L.bigQty, bigDays: L.bigDays };
      renderLead(); renderCart(); say($('#lead-msg'), '저장했어요.');
    }).catch(function (err) { say($('#lead-msg'), errText(err, '저장하지 못했어요.'), true); });
  });
  function stamp(iso) { var d = new Date(iso); return isNaN(d) ? String(iso || '') : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function logLine(l) { return esc(stamp(l.at)) + ' ' + esc(l.by) + '(' + esc(l.role) + ') ' + esc(l.from) + ' → ' + esc(l.to) + (l.reason ? '<br>사유: ' + esc(l.reason) : ''); }
  // 바꿀 수 있는 상태만 고르게 하고, 마지막으로 바꾼 사람과 기록을 함께 보여 준다
  function statusCell(o) {
    var opts = STATUS_LIST.filter(function (s) { return s !== o.status && canMove(role, o.status, s); });
    var html = opts.length
      ? '<select data-status="' + esc(o.no) + '" aria-label="' + esc(o.no) + ' 상태 바꾸기"><option selected>' + esc(o.status) + '</option>' +
        opts.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>'
      : pill(o.status) + '<div class="order-items">' + (role === 'view' ? '보기만 할 수 있어요' : '관리자만 바꿀 수 있어요') + '</div>';
    var log = o.log || [];
    if (log.length) {
      html += '<div class="order-items">' + logLine(log[log.length - 1]) + '</div>';
      if (log.length > 1) html += '<details class="log"><summary>기록 ' + log.length + '건</summary><ol>' + log.slice().reverse().map(function (l) { return '<li>' + logLine(l) + '</li>'; }).join('') + '</ol></details>';
    }
    return html;
  }
  // 잘못 누르는 일을 막으려고 바꾸기 전에 한 번 더 묻는다. 취소와 되돌리기는 사유를 받는다.
  function askStatus(no, to) {
    var o = adminOrders.filter(function (x) { return x.no === no; })[0]; if (!o) return;
    var reason = needsReason(o.status, to);
    pending = { no: no, status: to, from: o.status };
    $('#st-title').textContent = no + ' 상태를 바꿀까요?';
    $('#st-change').innerHTML = pill(o.status) + ' → ' + pill(to);
    $('#st-company').textContent = o.company;
    $('#st-by').textContent = staffInfo().name + ' (' + ROLES[role] + ')';
    $('#st-reason-wrap').hidden = !reason; $('#st-reason').value = '';
    $('#st-reason-label').textContent = to === '취소' ? '취소 사유' : '사유';
    say($('#st-msg'), ''); $('#st-ok').disabled = false;
    $('#st-ok').classList.toggle('danger', to === '취소');
    $('#st-ok').textContent = to === '취소' ? '발주 취소하기' : to + '(으)로 바꾸기';
    $('#st-dialog').showModal();
    if (reason) $('#st-reason').focus();
  }
  function closeStatus() { pending = null; $('#st-dialog').close(); renderAdmin(); }
  $('#st-form').addEventListener('submit', function (e) {
    e.preventDefault(); if (!pending) return;
    var c = { no: pending.no, status: pending.status, by: staffInfo().name, reason: $('#st-reason').value.trim() };
    if (needsReason(pending.from, c.status) && c.reason.length < 2) { say($('#st-msg'), '사유를 적어 주세요.', true); return $('#st-reason').focus(); }
    $('#st-ok').disabled = true; say($('#st-msg'), '바꾸는 중이에요…');
    api.setStatus(adminKey(), c).then(function () {
      var o = adminOrders.filter(function (x) { return x.no === c.no; })[0];
      if (o) { (o.log = o.log || []).push({ at: new Date().toISOString(), from: o.status, to: c.status, by: c.by, role: ROLES[role], reason: c.reason }); o.status = c.status; }
      toast(c.no + ' → ' + c.status); closeStatus();
    }).catch(function (err) { $('#st-ok').disabled = false; say($('#st-msg'), errText(err, '상태를 바꾸지 못했어요.'), true); });
  });
  $('#st-cancel').addEventListener('click', closeStatus);
  $('#st-dialog').addEventListener('cancel', function () { pending = null; renderAdmin(); });

  // 발주 시각(세계 표준시로 저장됨)을 한국 시간 "2026-10-15 13:22"로
  function kst(iso) {
    var d = new Date(iso); if (isNaN(d)) return String(iso || '');
    return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  }

  // ----- 거래처 정보: 한 거래처의 거래내역을 일별·월별·연별로 묶는다 -----
  var infoCode = null, infoPeriod = 'month', infoKey = null, infoData = null;
  var PERIOD = { day: { len: 10, name: '날짜' }, month: { len: 7, name: '월' }, year: { len: 4, name: '연도' } };
  function openCustInfo(code) {
    infoCode = code; infoKey = null;
    $('#cust-main').hidden = true; $('#cust-info').hidden = false;
    renderCustInfo(); window.scrollTo(0, 0);
  }
  function closeCustInfo() { infoCode = null; $('#cust-info').hidden = true; $('#cust-main').hidden = false; }
  function supply(o) { return o.items.reduce(function (s, i) { return s + (Number(i.unit) || 0) * (Number(i.qty) || 0); }, 0); }
  function renderCustInfo() {
    var c = customers.filter(function (x) { return x.code === infoCode; })[0];
    if (!c) { closeCustInfo(); return; }
    $('#ci-title').textContent = (c.no ? c.no + '번 ' : '') + c.name + ' (' + c.code + ')';
    var meta = [['담당자', c.contact], ['연락처', c.phone], ['메일', c.email], ['기본 납품 주소', c.address], ['할인율', c.discount ? c.discount + '%' : '없음'], ['상태', c.active ? '사용' : '중지']];
    $('#ci-meta').innerHTML = meta.map(function (m) { return '<div><span>' + m[0] + '</span>' + esc(m[1] || '-') + '</div>'; }).join('');
    document.querySelectorAll('[data-period]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.period === infoPeriod); });
    var P = PERIOD[infoPeriod];
    $('#ci-col').textContent = P.name;
    var mine = adminOrders.filter(function (o) { return o.code === c.code; });
    var groups = {}, keys = [];
    mine.forEach(function (o) {
      var k = kst(o.createdAt).slice(0, P.len);
      if (!groups[k]) { groups[k] = { n: 0, qty: 0, supply: 0, total: 0, cancel: 0 }; keys.push(k); }
      var g = groups[k];
      if (o.status === '취소') { g.cancel++; return; }
      g.n++; g.total += Number(o.total) || 0; g.supply += supply(o);
      g.qty += o.items.reduce(function (s, i) { return s + (Number(i.qty) || 0); }, 0);
    });
    keys.sort().reverse();
    infoData = { c: c, keys: keys, groups: groups, P: P };
    var all = keys.reduce(function (t, k) { var g = groups[k]; t.n += g.n; t.qty += g.qty; t.supply += g.supply; t.total += g.total; t.cancel += g.cancel; return t; }, { n: 0, qty: 0, supply: 0, total: 0, cancel: 0 });
    var row = function (label, g, attr) {
      return '<tr' + attr + '><td class="mono">' + label + '</td><td class="num">' + g.n + '건</td><td class="num">' + g.qty.toLocaleString() + 'EA</td><td class="num">' + won(g.supply) + '</td><td class="num">' + won(g.total) + '</td><td class="num">' + (g.cancel ? g.cancel + '건' : '-') + '</td></tr>';
    };
    $('#ci-sum').innerHTML = keys.map(function (k) { return row(esc(k), groups[k], ' data-period-key="' + esc(k) + '" aria-selected="' + (infoKey === k) + '"'); }).join('') +
      (keys.length ? row('전체', all, ' class="total"') : '');
    var list = mine.filter(function (o) { return !infoKey || kst(o.createdAt).slice(0, P.len) === infoKey; });
    infoData.list = list; infoData.all = all;
    $('#ci-list-title').textContent = infoKey ? infoKey + ' 발주 목록' : '발주 목록 (전체)';
    $('#ci-orders').innerHTML = list.map(function (o) {
      return '<tr><td class="mono">' + esc(o.no) + '</td><td class="mono">' + esc(kst(o.createdAt)) + '</td><td>' + itemsHtml(o) + '</td><td class="mono">' + won(o.total) + '</td><td>' + pill(o.status) + '</td></tr>';
    }).join('');
    $('#ci-empty').hidden = mine.length > 0;
  }
  $('#ci-back').addEventListener('click', closeCustInfo);
  // 거래처 정보의 거래내역(지금 고른 일별·월별·연별 그대로)과 발주 목록(품목 한 줄씩)을 엑셀 파일로
  var PERIOD_FILE = { day: 'daily', month: 'monthly', year: 'yearly' };
  $('#ci-sum-excel').addEventListener('click', function () {
    var D = infoData; if (!D || !D.keys.length) { toast('내려받을 거래내역이 없어요'); return; }
    var row = function (label, g) { return [csvText(label), g.n, g.qty, Math.round(g.supply), Math.round(g.total), g.cancel].join(','); };
    var lines = [['거래처', D.c.name + ' (' + D.c.code + ')'].map(csvCell).join(','), [D.P.name, '발주(건)', '수량(EA)', '공급가(원)', '합계 VAT 포함(원)', '취소(건)'].map(csvCell).join(',')]
      .concat(D.keys.map(function (k) { return row(k, D.groups[k]); }), [row('전체', D.all)]);
    saveCsv('POmall_' + D.c.code + '_' + PERIOD_FILE[infoPeriod], lines);
  });
  $('#ci-orders-excel').addEventListener('click', function () {
    var D = infoData; if (!D || !D.list.length) { toast('내려받을 발주가 없어요'); return; }
    var head = ['발주번호', '접수 시각', '상태', '예상 출하일', '사양 코드', '모델', '와이어(mm)', '와이어2(mm)', '탈피(mm)', '탈피2(mm)', '핀 길이(mm)', '전류감응속도', '터미널방향', '터미널', '복귀온도(°C)', '마감', '온도(°C)', '수량(EA)', '단가(원)', '금액(원)', '품목 메모', '품목 희망납기일', '발주 합계 VAT 포함(원)'];
    var lines = [head.map(csvCell).join(',')];
    D.list.forEach(function (o) {
      o.items.forEach(function (i) {
        lines.push([csvCell(o.no), csvText(kst(o.createdAt)), csvCell(OLD_STATUS[o.status] || o.status), csvText(o.shipDate || ''), csvCell(i.code), csvCell(i.model), i.len || '', i.len2 || '', i.strip || '', i.strip2 || '', i.pin || '', csvCell(i.speed || ''), csvCell(i.terminal || ''), csvCell(i.term || ''), rtempOf(i),
          csvCell(i.finish || ''), i.temp || '', i.qty || '', i.unit || '', (Number(i.unit) || 0) * (Number(i.qty) || 0), csvCell(i.memo || ''), csvText(i.due || ''), o.total || ''].join(','));
      });
    });
    saveCsv('POmall_' + D.c.code + '_orders' + (infoKey ? '_' + infoKey : ''), lines);
  });
  $('#ci-sum').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-period-key]'); if (!tr) return;
    infoKey = infoKey === tr.dataset.periodKey ? null : tr.dataset.periodKey; renderCustInfo();
  });

  // 거래처 목록을 엑셀에서 바로 열리는 파일(CSV, 한글 깨짐 방지 BOM 포함)로 내려받는다. 비밀번호는 넣지 않는다.
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  // 0으로 시작하는 연락처·코드·날짜는 엑셀이 숫자나 날짜로 바꾸므로 글자로 고정한다
  function csvText(v) { v = String(v || ''); return v ? '="' + v.replace(/"/g, '""') + '"' : ''; }
  function saveCsv(name, lines) {
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name + '_' + kst(new Date().toISOString()).slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function downloadCustomers() {
    if (!customers.length) { toast('내려받을 거래처가 없어요'); return; }
    var cell = csvCell, asText = csvText;
    var head = ['번호', '거래처 코드', '거래처명', '담당자', '연락처', '메일', '기본 납품 주소', '주문모델 · 견적단가(원)', '할인율(%)', '상태'];
    var lines = [head.map(cell).join(',')].concat(customers.map(function (c) {
      return [c.no || '', asText(c.code), cell(c.name), cell(c.contact), asText(String(c.phone || '').replace(/^'/, '')), cell(c.email || ''), cell(c.address)]
        .concat([cell((c.quotes || []).map(function (q) { return q.model + ' ' + q.price; }).join('; ')), c.discount || '', c.active ? '사용' : '중지']).join(',');
    }));
    saveCsv('POmall_customers', lines);
  }
  $('#cust-excel').addEventListener('click', downloadCustomers);

  // 거래처 단가
  function renderCustomers() {
    $('#cust-head').innerHTML = '<tr><th>번호</th><th>코드</th><th>거래처</th><th>담당 · 연락처</th><th>주문모델 · 견적단가</th><th>할인율</th><th>상태</th><th></th></tr>';
    $('#cust-body').innerHTML = customers.map(function (c) {
      return '<tr class="' + (c.active ? '' : 'off') + (editing === c.code ? ' editing' : '') + '"><td class="num">' + (c.no || '-') + '</td><td><button type="button" class="code-link" data-cust-info="' + esc(c.code) + '" title="거래처 정보 보기">' + esc(c.code) + '</button></td><td><b>' + esc(c.name) + '</b></td>' +
        '<td>' + esc(c.contact) + '<div class="order-items">' + esc(c.phone) + '</div></td>' +
        '<td>' + quoteSummary(c) + '</td>' +
        '<td class="num">' + (c.discount ? c.discount + '%' : '-') + '</td><td>' + (c.active ? '사용' : '중지') + '</td><td><button type="button" class="btn ghost small" data-edit="' + esc(c.code) + '">수정</button></td></tr>';
    }).join('');
    $('#cust-empty').hidden = customers.length > 0;
    if (!$('#cu-quotes').children.length) fillQuotes(null);
  }
  // 거래처 목록에는 주문모델을 두 개까지 보여 주고 나머지는 개수로
  function quoteSummary(c) {
    var q = c.quotes || [];
    if (!q.length) return '<span class="order-items">-</span>';
    return q.slice(0, 2).map(function (x) { return '<div class="order-items"><b>' + esc(x.model) + '</b> ' + Number(x.price).toLocaleString() + '원</div>'; }).join('') +
      (q.length > 2 ? '<div class="order-items">외 ' + (q.length - 2) + '개</div>' : '');
  }
  // 주문모델·견적단가 입력 줄. +를 누르면 한 줄씩 늘어난다
  // 이미 저장된 줄은 '삭제'(바로 저장돼 거래처 화면에서 사라짐), 새로 적는 줄은 '빼기'(저장 전 입력만 지움)
  function quoteRow(q, saved) {
    return '<div class="quote-row"><input data-qm maxlength="60" placeholder="주문모델 (예: ST-22W-L070-L120-T100)" aria-label="주문모델" value="' + esc(q ? q.model : '') + '">' +
      '<div class="inrow"><input class="num" data-qp type="number" min="0" step="0.1" inputmode="decimal" placeholder="견적단가" aria-label="견적단가" value="' + (q && q.price ? q.price : '') + '"><span class="unit">원</span></div>' +
      (saved && q ? '<button type="button" class="btn ghost small danger-text" data-q-del data-q-saved="' + esc(q.model) + '" aria-label="' + esc(q.model) + ' 삭제">삭제</button>'
        : '<button type="button" class="btn ghost small" data-q-del aria-label="이 줄 빼기">빼기</button>') + '</div>';
  }
  function fillQuotes(list, saved) { $('#cu-quotes').innerHTML = (list && list.length ? list : [null]).map(function (q) { return quoteRow(q, saved); }).join(''); }
  $('#cu-quote-add').addEventListener('click', function () {
    $('#cu-quotes').insertAdjacentHTML('beforeend', quoteRow(null));
    var all = $('#cu-quotes').querySelectorAll('[data-qm]'); all[all.length - 1].focus();
  });
  $('#cu-quotes').addEventListener('click', function (e) {
    if (!e.target.hasAttribute('data-q-del')) return;
    var row = e.target.closest('.quote-row'), model = e.target.dataset.qSaved;
    if (!model) { row.remove(); if (!$('#cu-quotes').children.length) fillQuotes(null); return; }
    deleteQuote(model, row, e.target);
  });
  // 저장된 견적 모델 삭제: 한 번 묻고, 시트에 저장된 거래처 정보에서 그 모델만 빼서 바로 저장한다.
  // 화면에 적다 만 다른 칸은 저장하지 않는다. 지난 발주에 남은 주문모델은 그대로다.
  function deleteQuote(model, row, btn) {
    var c = customers.filter(function (x) { return x.code === editing; })[0], msg = $('#cu-msg');
    if (!c) return;
    if (!window.confirm(model + ' 주문모델을 삭제할까요?\n거래처 화면에서 바로 사라져요. 지난 발주 기록은 그대로 남아요.')) return;
    var left = (c.quotes || []).filter(function (q) { return q.model !== model; });
    btn.disabled = true; say(msg, '삭제하는 중이에요…');
    api.saveCustomer(adminKey(), { code: c.code, oldCode: c.code, name: c.name, contact: c.contact, phone: String(c.phone || '').replace(/^'/, ''), email: c.email || '', address: c.address,
      active: c.active, discount: c.discount || 0, prices: c.prices || {}, quotes: left, pw: '' })
      .then(function () { return api.customers(adminKey()); })
      .then(function (list) {
        customers = list || [];
        var now = customers.filter(function (x) { return x.code === c.code; })[0];
        if (now && (now.quotes || []).some(function (q) { return q.model === model; })) { btn.disabled = false; say(msg, '삭제되지 않았어요. Apps Script에 새 pomall-script.gs를 붙여 넣고 새 버전으로 배포해 주세요.', true); return; }
        row.remove(); if (!$('#cu-quotes').children.length) fillQuotes(null);
        renderCustomers(); say(msg, model + ' 주문모델을 삭제했어요.');
      })
      .catch(function (err) { btn.disabled = false; say(msg, errText(err, '삭제하지 못했어요. 다시 눌러 주세요.'), true); });
  }
  function fillCustomerForm(c) {
    editing = c ? c.code : null;
    $('#cust-form-title').textContent = c ? (c.no ? c.no + '번 ' : '') + c.name + ' 수정' : '거래처 추가';
    $('#cu-code').value = c ? c.code : '';
    $('#cu-code-hint').textContent = c ? '바꾸면 비밀번호도 새로 정해야 해요. 지난 발주도 새 코드로 옮겨져요.' : '거래처가 로그인할 때 씁니다.';
    $('#cu-delete').hidden = !c;
    $('#cu-name').value = c ? c.name : ''; $('#cu-contact').value = c ? c.contact : ''; $('#cu-phone').value = c ? c.phone : ''; $('#cu-email').value = c ? c.email || '' : ''; $('#cu-addr').value = c ? c.address : '';
    $('#cu-pw').value = ''; $('#cu-pw-hint').textContent = c ? '바꿀 때만 적으세요. 비워 두면 그대로예요.' : '거래처에 알려줄 비밀번호 (4자 이상)';
    $('#cu-active').value = !c || c.active ? '1' : '0';
    $('#cu-discount').value = c && c.discount ? c.discount : '';
    fillQuotes(c ? c.quotes : null, true);
    say($('#cu-msg'), '');
    renderCustomers();
  }
  $('#cust-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#cu-msg'), quoteList = [], qErr = '';
    var c = { code: $('#cu-code').value.trim().toUpperCase(), name: $('#cu-name').value.trim(), contact: $('#cu-contact').value.trim(),
      phone: $('#cu-phone').value.trim(), email: $('#cu-email').value.trim(), address: $('#cu-addr').value.trim(), active: $('#cu-active').value === '1', pw: $('#cu-pw').value };
    if (!/^[A-Z0-9_-]{2,20}$/.test(c.code)) { say(msg, '거래처 코드는 영문 대문자, 숫자, -, _ 로 2~20자예요.', true); return; }
    if (!c.name) { say(msg, '거래처명을 적어 주세요.', true); return; }
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) { say(msg, '메일 주소를 확인해 주세요.', true); return $('#cu-email').focus(); }
    var renamed = !!(editing && editing !== c.code);
    if ((!editing || renamed) && customers.some(function (x) { return x.code === c.code; })) { say(msg, '이미 있는 거래처 코드예요. 목록에서 수정을 눌러 주세요.', true); return; }
    if (!editing && c.pw.length < 4) { say(msg, '새 거래처는 비밀번호를 4자 이상 정해 주세요.', true); return; }
    if (renamed && c.pw.length < 4) { say(msg, '거래처 코드를 바꾸면 비밀번호도 새로 정해야 해요 (4자 이상).', true); return $('#cu-pw').focus(); }
    if (editing) c.oldCode = editing;
    if (c.pw && c.pw.length < 4) { say(msg, '비밀번호는 4자 이상이에요.', true); return; }
    // 모델 단가 칸은 없앴다. 예전에 적어 둔 모델 단가는 지우지 않고 그대로 보낸다
    var old = editing ? customers.filter(function (x) { return x.code === editing; })[0] : null;
    c.prices = (old && old.prices) || {};
    document.querySelectorAll('#cu-quotes .quote-row').forEach(function (row) {
      var m = row.querySelector('[data-qm]').value.trim(), pv = row.querySelector('[data-qp]').value, v = Number(pv);
      if (!m && !pv) return;
      if (!m) qErr = qErr || '견적단가만 있고 주문모델이 빈 줄이 있어요.';
      else if (!(v > 0)) qErr = qErr || m + ' 견적단가를 0보다 크게 적어 주세요.';
      else if (quoteList.some(function (q) { return q.model === m; })) qErr = qErr || m + ' 주문모델이 두 번 적혀 있어요.';
      else quoteList.push({ model: m, price: Math.round(v * 10) / 10 });
    });
    if (qErr) { say(msg, qErr, true); return; }
    c.quotes = quoteList;
    c.discount = Number($('#cu-discount').value) || 0;
    if (c.discount < 0 || c.discount >= 100) { say(msg, '할인율은 0 이상 100 미만으로 적어 주세요.', true); return; }
    $('#cu-save').disabled = true; say(msg, '저장하는 중이에요…');
    api.saveCustomer(adminKey(), c).then(function () {
      return api.customers(adminKey());
    }).then(function (list) {
      customers = list || [];
      var saved = customers.filter(function (x) { return x.code === c.code; })[0];
      fillCustomerForm(saved);
      // 예전 Apps Script는 견적 모델을 모르고 버린다: 적은 주문모델이 돌아오지 않으면 새 버전 배포를 알린다
      if (c.quotes.length && !(saved && saved.quotes && saved.quotes.length)) { fillQuotes(c.quotes); say(msg, '거래처 정보는 저장됐지만 주문모델·견적단가는 저장되지 않았어요. Apps Script에 새 pomall-script.gs를 붙여 넣고 새 버전으로 배포해 주세요.', true); return; }
      say(msg, '저장했어요. 거래처가 다음에 로그인하면 새 주문모델과 견적단가가 보여요.');
    }).catch(function (err) { say(msg, errText(err, '저장하지 못했어요. 다시 눌러 주세요.'), true); })
      .then(function () { $('#cu-save').disabled = false; });
  });
  $('#cu-new').addEventListener('click', function () { fillCustomerForm(null); $('#cu-code').focus(); });
  // 거래처 삭제: 한 번 더 묻는다. 지난 발주는 시트에 남는다.
  $('#cu-delete').addEventListener('click', function () {
    var c = customers.filter(function (x) { return x.code === editing; })[0]; if (!c) return;
    $('#del-text').textContent = c.name + ' (' + c.code + ')';
    say($('#del-msg'), ''); $('#del-ok').disabled = false;
    $('#del-dialog').showModal();
  });
  $('#del-cancel').addEventListener('click', function () { $('#del-dialog').close(); });
  $('#del-form').addEventListener('submit', function (e) {
    e.preventDefault(); var code = editing; if (!code) return;
    $('#del-ok').disabled = true; say($('#del-msg'), '삭제하는 중이에요…');
    api.deleteCustomer(adminKey(), code).then(function () { return api.customers(adminKey()); }).then(function (list) {
      customers = list || []; $('#del-dialog').close(); fillCustomerForm(null); toast(code + ' 거래처를 삭제했어요');
    }).catch(function (err) { $('#del-ok').disabled = false; say($('#del-msg'), errText(err, '삭제하지 못했어요.'), true); });
  });

  // ----- 코드·비밀번호 찾기 -----
  // 거래처: 로그인 화면에서 요청을 남긴다. 비밀번호는 암호로 바꿔 저장해서 아무도 알 수 없으므로, 회사가 전화로 확인한 뒤 새로 정해 알려 준다.
  function showHelp(on) {
    $('#login-panel').hidden = on; $('#help-panel').hidden = !on;
    ['#help-msg', '#r-msg', '#r-msg2'].forEach(function (id) { say($(id), ''); });
    $('#reset-finish').hidden = true; $('#r-preview').hidden = true;
    (on ? $('#r-email') : $('#login-code')).focus();
  }
  // 1단계: 등록된 메일로 거래처 코드와 인증번호를 받는다. 메일이 등록돼 있는지는 알려 주지 않는다(남의 메일을 알아내지 못하게).
  $('#reset-start').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#r-msg'), email = $('#r-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say(msg, T('메일 주소를 확인해 주세요.', 'Please check the email address.'), true); return; }
    if (!settings.open || !api.ready || !api.resetStart) { say(msg, T('아직 찾기를 받지 않아요. 담당 영업에 연락해 주세요.', 'This is not open yet. Please contact your sales representative.'), true); return; }
    say(msg, T('보내는 중이에요…', 'Sending…')); $('#r-send').disabled = true;
    api.resetStart({ email: email, lang: LANG }).then(function (d) {
      say(msg, T('등록된 메일이면 거래처 코드와 인증번호를 보냈어요. 10분 안에 아래에 넣어 주세요.', 'If this email is registered, we have sent your customer code and a verification number. Enter them below within 10 minutes.'));
      $('#reset-finish').hidden = false;
      var pv = d && d.preview, box = $('#r-preview');
      box.hidden = !pv;
      if (pv) box.innerHTML = T('시험판이라 메일 대신 여기 보여 드려요.', 'Draft version: shown here instead of by email.') + '<br>' + T('거래처 코드', 'Customer code') + ' <b>' + esc(pv.codes.join(', ')) + '</b> · ' + T('인증번호', 'Verification number') + ' <b>' + esc(pv.otp) + '</b>';
      $('#r-code').focus();
    }).catch(function (err) { say(msg, errText(err, T('보내지 못했어요. 잠시 후 다시 눌러 주세요.', 'Could not send. Please try again in a moment.')), true); })
      .then(function () { $('#r-send').disabled = false; });
  });
  // 2단계: 인증번호가 맞으면 새 비밀번호로 바꾸고 바로 로그인한다
  $('#reset-finish').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#r-msg2'), r = { email: $('#r-email').value.trim(), code: $('#r-code').value.trim().toUpperCase(), otp: $('#r-otp').value.trim(), pw: $('#r-pw').value };
    if (!r.code) { say(msg, T('메일에 있는 거래처 코드를 넣어 주세요.', 'Enter the customer code from the email.'), true); return; }
    if (!/^\d{6}$/.test(r.otp)) { say(msg, T('인증번호 6자리를 넣어 주세요.', 'Enter the 6-digit verification number.'), true); return; }
    if (r.pw.length < 4) { say(msg, T('새 비밀번호를 4자 이상으로 정해 주세요.', 'Choose a new password of at least 4 characters.'), true); return; }
    if (r.pw !== $('#r-pw2').value) { say(msg, T('새 비밀번호 두 칸이 서로 달라요.', 'The two new passwords do not match.'), true); return; }
    say(msg, T('바꾸는 중이에요…', 'Updating…')); $('#r-save').disabled = true;
    api.resetFinish(r).then(function () {
      $('#reset-start').reset(); $('#reset-finish').reset(); showHelp(false);
      return login(r.code, r.pw);
    }).then(function () { toast(T('비밀번호를 바꾸고 로그인했어요', 'Password changed and signed in')); })
      .catch(function (err) { say(msg, errText(err, T('바꾸지 못했어요. 다시 눌러 주세요.', 'Could not change it. Please try again.')), true); })
      .then(function () { $('#r-save').disabled = false; });
  });
  $('#help-open').addEventListener('click', function () { showHelp(true); });
  $('#help-close').addEventListener('click', function () { showHelp(false); });
  $('#help-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#help-msg'), r = { company: $('#h-company').value.trim(), contact: $('#h-contact').value.trim(), phone: $('#h-phone').value.trim(), what: $('#h-what').value, memo: $('#h-memo').value.trim() };
    if (!r.company || !r.contact || !r.phone) { say(msg, T('회사명, 담당자, 연락처를 모두 적어 주세요.', 'Please enter your company name, your name and phone.'), true); return; }
    if (digits(r.phone).length < 8) { say(msg, T('연락처를 숫자 8자리 이상으로 적어 주세요.', 'Please enter a phone number with at least 8 digits.'), true); return; }
    if (!settings.open || !api.ready || !api.requestHelp) { say(msg, T('아직 요청을 받지 않아요. 담당 영업에 직접 연락해 주세요.', 'Requests are not open yet. Please contact your sales representative.'), true); return; }
    say(msg, T('보내는 중이에요…', 'Sending…')); $('#help-send').disabled = true;
    api.requestHelp(r).then(function () {
      $('#help-form').reset();
      say(msg, T('요청을 받았어요. 담당 영업이 ' + r.phone + '(으)로 확인 전화를 드린 뒤 거래처 코드와 새 비밀번호를 알려 드려요.', 'Request received. Your sales representative will call ' + r.phone + ' to confirm, then give you your customer code and a new password.'));
    }).catch(function (err) { say(msg, errText(err, T('보내지 못했어요. 잠시 후 다시 눌러 주세요.', 'Could not send. Please try again in a moment.')), true); })
      .then(function () { $('#help-send').disabled = false; });
  });

  // 회사: 거래처 관리 맨 위에 찾기 요청을 보여 주고, 회사명이나 연락처가 맞는 거래처를 찾아 준다.
  var helps = [];
  var HELP_WHAT = { pw: '비밀번호', code: '거래처 코드', both: '코드와 비밀번호' };
  function norm(v) { return String(v || '').toLowerCase().replace(/\s|\(주\)|㈜|주식회사|co\.?|ltd\.?|inc\.?|[.,]/g, ''); }
  function helpMatches(h) {
    var n = norm(h.company), ph = digits(h.phone).slice(-8);
    return customers.filter(function (c) {
      var cn = norm(c.name);
      return (n && cn && (cn.indexOf(n) >= 0 || n.indexOf(cn) >= 0)) || (ph.length === 8 && digits(c.phone).slice(-8) === ph);
    });
  }
  function renderHelp() {
    var all = $('#help-showdone').checked, open = helps.filter(function (h) { return !h.done; });
    var list = all ? helps : open;
    $('#help-box').hidden = !helps.length;
    $('#help-title').textContent = '코드·비밀번호 찾기 요청 ' + open.length + '건';
    $('#help-body').innerHTML = list.map(function (h) {
      var m = helpMatches(h);
      return '<tr' + (h.done ? ' class="done"' : '') + '><td class="mono">' + esc(kst(h.at)) + '</td><td><b>' + esc(h.company) + '</b><div class="order-items">' + esc(h.contact) + (h.memo ? ' · ' + esc(h.memo) : '') + '</div></td>' +
        '<td class="mono">' + esc(h.phone) + '</td><td>' + esc(HELP_WHAT[h.what] || h.what || '') + '</td>' +
        '<td>' + (m.length ? m.map(function (c) { return '<button type="button" class="code-link" data-edit="' + esc(c.code) + '" title="이 거래처 수정 열기">' + esc(c.code) + '</button> ' + esc(c.name); }).join('<br>') : '<span class="order-items">맞는 거래처 없음</span>') + '</td>' +
        '<td>' + (h.done ? '<span class="order-items">처리 ' + esc(h.doneBy) + ' ' + esc(kst(h.done)) + '</span>' : '<button type="button" class="btn ghost small" data-help-done="' + esc(h.id) + '">처리 완료</button>') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="order-items">남은 요청이 없어요.</td></tr>';
  }
  $('#help-showdone').addEventListener('change', renderHelp);
  function finishHelp(id) {
    api.helpDone(adminKey(), { id: id, by: staffInfo().name }).then(function () { return api.helpList(adminKey()); })
      .then(function (list) { helps = list || []; renderHelp(); toast('처리 완료로 표시했어요'); })
      .catch(function (err) { toast(errText(err, '처리하지 못했어요.')); });
  }
  // 임시 비밀번호: 헷갈리는 글자(0, O, 1, I)를 뺀 8자리
  $('#cu-temp-pw').addEventListener('click', function () {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = new Uint32Array(8), pw = '';
    crypto.getRandomValues(r); r.forEach(function (n) { pw += abc[n % abc.length]; });
    $('#cu-pw').value = pw;
    say($('#cu-msg'), '임시 비밀번호 ' + pw + ' 를 만들었어요. 저장을 누른 뒤 거래처에 알려 주세요.');
  });

  // ----- 탭 -----
  function show(view) {
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.view === view); });
    // 거래처 관리는 주문관리와 같은 화면(같은 팀 열쇠)에서 거래처 부분만 보여 준다
    var page = view === 'customers' ? 'admin' : view;
    // 거래처 화면(주문하기, 주문 조회)은 로그인해야 열린다. 로그인 전에는 로그인 화면으로
    if ((page === 'order' || page === 'history') && !session) page = 'login';
    ['login', 'order', 'history', 'admin'].forEach(function (v) { $('#view-' + v).hidden = v !== page; });
    if (page === 'admin') { $('#tab-admin').hidden = false; showAdminTab(view === 'customers' ? 'customers' : 'orders'); adminLoad(); }
    if (page === 'history') loadHistory();
    window.scrollTo(0, 0);
  }

  // ----- 이벤트 -----
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || !C) return;
    var d = t.dataset;
    if (d.view) return show(d.view);
    if (t.classList.contains('model')) { selectModel(d.id); return renderSpec(); }
    // 마감은 선택 사항: 이미 고른 것을 한 번 더 누르면 선택이 풀린다
    if (d.finish) { sel.finish = sel.finish === d.finish ? '' : d.finish; renderFinish(); return renderSpec(); }
    if (d.len) { $('#len').value = d.len; return renderSpec(); }
    if (d.temp) { $('#temp').value = d.temp; return renderSpec(); }
    if (d.qty) { $('#qty').value = d.qty; return renderSpec(); }
    if (d.del !== undefined) { cart.splice(+d.del, 1); saveCart(); return renderCart(); }
    if (d.spec) { var s = d.spec.split('|'); setSpec(s[0], +s[1], +s[2], +s[3], +s[4] || 0, s[5] || '', +s[6] || 0, +s[7] || 0, +s[8] || 0, { speed: s[9] || '', terminal: s[10] || '', term: s[11] || '' }, +s[12] || 0); return window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (d.reorder) return reorder(d.reorder);
    if (d.filter) { adminFilter = d.filter; return renderAdmin(); }
    if (d.custInfo) return openCustInfo(d.custInfo);
    if (d.helpDone) return finishHelp(d.helpDone);
    if (d.period) { infoPeriod = d.period; infoKey = null; return renderCustInfo(); }
    if (d.edit) { fillCustomerForm(customers.filter(function (x) { return x.code === d.edit; })[0]); return $('#cust-form').scrollIntoView({ behavior: 'smooth' }); }
  });
  ['len', 'len2', 'strip', 'strip2', 'pin', 'temp', 'rtemp', 'qty'].forEach(function (id) { $('#' + id).addEventListener('input', function () { if (C) renderSpec(); }); });
  $('#add-btn').addEventListener('click', addToCart);
  // 체크박스는 하나만 고른다: 하나를 체크하면 같은 항목의 다른 것은 풀리고, 다시 누르면 선택이 풀린다
  $('#choice-row').addEventListener('change', function (e) {
    var k = e.target.dataset.choice; if (!k) return;
    sel.choice[k] = e.target.checked ? e.target.value : '';
    renderChoices(); renderSpec();
  });
  $('#cart').addEventListener('change', function (e) {
    var k = e.target.dataset.k; if (k === undefined) return;
    var i = cart[+k];
    i.qty = i.quote ? Math.max(1, Math.round(+e.target.value || 0)) : Math.max(C.qty.min, Math.round((+e.target.value || 0) / C.qty.step) * C.qty.step);
    i.unit = unitOf(i); saveCart(); renderCart();
  });
  $('#go-checkout').addEventListener('click', function () { if (!session) return; $('#checkout').hidden = false; fillCheckout(); $('#checkout').scrollIntoView({ behavior: 'smooth' }); });
  $('#cancel-checkout').addEventListener('click', function () { $('#checkout').hidden = true; });
  $('#checkout-form').addEventListener('submit', submitOrder);
  $('#done-history').addEventListener('click', function () { show('history'); });
  $('#admin-entry').addEventListener('click', function () { show('admin'); });
  $('#key-form').addEventListener('submit', function (e) {
    e.preventDefault(); var k = $('#admin-key').value.trim(), name = $('#staff-name').value.trim();
    if (!name) { say($('#admin-msg'), '이름을 적어 주세요. 상태를 바꾸면 기록에 남아요.', true); return $('#staff-name').focus(); }
    if (!k) { say($('#admin-msg'), '팀 열쇠를 적어 주세요.', true); return $('#admin-key').focus(); }
    store(KEY.admin, { key: k, name: name.slice(0, 20) }); $('#admin-key').value = ''; adminLoad();
  });
  $('#admin-reload').addEventListener('click', adminLoad);
  // 닫기·관리자 로그아웃: 저장된 열쇠를 지우고 주문관리 탭도 감춘다 (다시 열려면 첫 화면의 관리자 로그인)
  $('#admin-logout').addEventListener('click', staffLogout);
  $('#staff-logout').addEventListener('click', staffLogout);
  $('#staff-open').addEventListener('click', function () { show('admin'); });
  $('#admin-body').addEventListener('change', function (e) {
    if (e.target.dataset.status) askStatus(e.target.dataset.status, e.target.value);
    if (e.target.dataset.ship) saveShip(e.target);
    if (e.target.dataset.smemo) saveStaffMemo(e.target);
  });

  // ----- 언어 바꾸기 -----
  // 화면 글자는 index.html의 data-en(영어), data-en-ph(입력란 안내)에 적어 두고 여기서 바꿔 끼운다.
  function applyLang() {
    document.documentElement.lang = LANG;
    document.title = T('SEKI POmall 발주', 'SEKI POmall Order');
    document.querySelectorAll('[data-en]').forEach(function (el) {
      if (el.dataset.ko == null) el.dataset.ko = el.innerHTML;
      el.innerHTML = LANG === 'en' ? el.dataset.en : el.dataset.ko;
    });
    document.querySelectorAll('[data-en-ph]').forEach(function (el) {
      if (el.dataset.koPh == null) el.dataset.koPh = el.placeholder;
      el.placeholder = LANG === 'en' ? el.dataset.enPh : el.dataset.koPh;
    });
    var b = $('#lang-btn'); b.textContent = T('English', '한국어'); b.lang = T('en', 'ko');
  }
  $('#lang-btn').addEventListener('click', function () {
    LANG = T('en', 'ko'); store(KEY.lang, LANG); applyLang();
    // 주소의 ?lang= 도 맞춰 바꿔서, 새로고침하거나 주소를 복사해도 고른 언어로 열린다
    try { var u = new URL(location.href); u.searchParams.set('lang', LANG); window.history.replaceState(null, '', u); } catch (e) {}
    if (!C) return;
    renderModels(); renderChips(); renderFinish(); renderSpec(); renderCart(); renderRecent(); renderQuotes();
    if (!$('#view-history').hidden) loadHistory();
  });
  applyLang();

  // ----- 시작 -----
  Promise.all([
    fetch('settings.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    fetch('products.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
  ]).then(function (res) {
    settings = res[0] || {}; C = res[1];
    var kind = STORAGES[settings.storage] ? settings.storage : 'sheet';
    api = STORAGES[kind](settings);
    $('#notice').hidden = !!(settings.open && api.ready);
    if (settings.company) { $('.brand b').textContent = settings.company; $('#footer-company').textContent = '© 2026 ' + settings.company; }
    if (adminKey()) { $('#tab-admin').hidden = false; $('#tab-cust').hidden = false; }
    renderStaff();
    setSpec(C.products[0].id, 70, 100, 1000); renderFinish();
    renderRecent();
    // 담당자가 관리 화면에서 바꾼 생산 소요일을 받아 온다
    if (api.ready && api.config) api.config().then(function (d) { if (d && d.lead && d.lead.days) { C.lead = d.lead; renderCart(); } }).catch(function () {});
    if (session && api.ready) {
      cart = (store(KEY.cart) || {})[session.code] || [];
      renderSession(); renderCart();
      // 저장된 로그인으로 단가를 새로 받아 온다. 비밀번호가 바뀌었거나 중지된 거래처면 로그아웃한다.
      login(session.code, session.pw, true).catch(function (err) {
        if (/맞지|중지/.test((err && err.message) || '')) { logout(); show('order'); toast(T('다시 로그인해 주세요', 'Please sign in again')); }
      });
    } else { session = null; renderSession(); renderCart(); }
    show('order');
  }).catch(function () {
    $('#models').innerHTML = '<p class="msg err">' + T('제품 목록을 불러오지 못했어요. 새로고침해 주세요.', 'Could not load the product list. Please refresh the page.') + '</p>';
  });
})();
