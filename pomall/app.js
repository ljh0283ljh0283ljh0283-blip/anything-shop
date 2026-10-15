// SEKI POmall 발주: 거래처가 로그인해 사양(모델, 와이어 길이, 동작온도)을 골라 선주문 생산을 요청한다.
// 모델 단가와 할인율은 거래처마다 다르다. 회사가 관리 > 거래처 단가에서 정하고, 거래처는 로그인해야 자기 단가만 본다.
// 제품 목록과 범위는 products.json, 주문 저장 위치는 settings.json에서 정한다.
// 저장 위치를 바꾸려면 STORAGES에 같은 일을 하는 항목을 더하고 settings.json의 storage 값을 그 이름으로 바꾼다.
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var KEY = { cart: 'pomall.cart', session: 'pomall.session', admin: 'pomall.admin', recent: 'pomall.recent', localOrders: 'pomall.orders', localCustomers: 'pomall.customers', localLead: 'pomall.lead' };
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
    return null;
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
  //   login(code, pw) → {customer, prices}      submit(auth, order) → {no, total, ...}      mine(auth) → [발주]
  //   staff(key) → 'admin' | 'sales' | 'view'      list(key) → [발주]      setStatus(key, {no, status, by, reason})
  //   config() → {lead}      saveLead(key, {days, bigQty, bigDays, by})      shipDate(key, {no, date, by})
  //   customers(key) → [거래처]      saveCustomer(key, 거래처 + oldCode)      deleteCustomer(key, code)
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
        list: function (key) { return call({ action: 'list', key: key }).then(function (d) { return d.orders; }); },
        setStatus: function (key, c) { return call({ action: 'status', key: key, no: c.no, status: c.status, by: c.by, reason: c.reason }); },
        customers: function (key) { return call({ action: 'customers', key: key }).then(function (d) { return d.customers; }); },
        saveCustomer: function (key, c) { return call({ action: 'saveCustomer', key: key, customer: c }); },
        deleteCustomer: function (key, code) { return call({ action: 'deleteCustomer', key: key, code: code }); }
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
      function pub(c) { return { code: c.code, name: c.name, contact: c.contact, phone: c.phone, address: c.address, active: c.active, prices: c.prices, discount: c.discount || 0, hasPassword: !!c.pw }; }
      return {
        ready: true,
        login: function (code, pw) { return auth(code, pw).then(function (c) { return { customer: pub(c), prices: c.prices, discount: c.discount || 0 }; }); },
        submit: function (a, order) {
          return auth(a.code, a.pw).then(function (c) {
            // 이 브라우저 저장 방식은 파일 내용을 두지 않고 이름만 남긴다
            var o = Object.assign({}, order, { attachment: '', attachmentName: order.attachment ? order.attachment.name : '', no: orderNo(orders()), code: c.code, company: c.name, createdAt: new Date().toISOString(), status: '접수 대기' });
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
        customers: function () { return Promise.resolve(custs().map(pub)); },
        saveCustomer: function (key, c) {
          var list = custs(), ex = list.filter(function (x) { return x.code === (c.oldCode || c.code); })[0];
          var renamed = !!(c.oldCode && c.oldCode !== c.code);
          if (renamed && list.some(function (x) { return x.code === c.code; })) return Promise.reject(new Error('이미 있는 거래처 코드예요.'));
          if ((!ex || renamed) && !c.pw) return Promise.reject(new Error('비밀번호가 필요해요.'));
          var row = Object.assign(ex || {}, { code: c.code, name: c.name, contact: c.contact, phone: c.phone, address: c.address, active: c.active, prices: c.prices, discount: c.discount });
          if (c.pw) row.pw = c.pw;
          if (!ex) list.push(row);
          store(KEY.localCustomers, list);
          if (renamed) store(KEY.localOrders, orders().map(function (o) { if (o.code === c.oldCode) o.code = c.code; return o; }));
          return Promise.resolve({ ok: true });
        },
        deleteCustomer: function (key, code) {
          store(KEY.localCustomers, custs().filter(function (x) { return x.code !== code; })); return Promise.resolve({ ok: true });
        }
      };
    }
  };

  // ----- 상태 -----
  var C = null, settings = {}, api = null;
  var sel = { model: null };
  var session = store(KEY.session);      // {code, pw, customer, prices, discount}
  var cart = [];
  var history = [];
  var adminOrders = [], adminFilter = 'all', adminTab = 'orders', customers = [], editing = null, role = null, pending = null;

  // ----- 계산 -----
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var kday = function (d) { return (d.getMonth() + 1) + '/' + d.getDate() + '(' + '일월화수목금토'[d.getDay()] + ')'; };
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // 이 브라우저 저장 방식에서도 시트와 같은 모양: PO-날짜-그날의 일련번호
  function orderNo(list) {
    var d = new Date(), prefix = 'PO-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-', max = 0;
    (list || []).forEach(function (o) { var m = String(o.no).match(/^PO-\d{6}-(\d{3,})$/); if (m && o.no.indexOf(prefix) === 0) max = Math.max(max, +m[1]); });
    return prefix + String(max + 1).padStart(3, '0');
  }
  function addBizDays(n) { var d = new Date(); d.setHours(0, 0, 0, 0); var k = 0; while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) k++; } return d; }
  function product(id) { return C.products.filter(function (p) { return p.id === id; })[0]; }
  // 와이어가 두 줄인 모델은 길이를 둘 다 적는다: ST-22W-L070-L100-T100
  // 마감(T, TD)은 맨 끝에 붙는다: ST-12-L070-T100-TD
  function specCode(model, len, temp, len2, finish) {
    return model + '-L' + String(len).padStart(3, '0') + (len2 ? '-L' + String(len2).padStart(3, '0') : '') + '-T' + String(temp).padStart(3, '0') + (finish ? '-' + finish : '');
  }
  function finishes() { return C.finishes || []; }
  function renderFinish() {
    $('#finish').innerHTML = finishes().map(function (f) {
      return '<button type="button" data-finish="' + esc(f.code) + '" aria-pressed="' + (sel.finish === f.code) + '"><b>' + esc(f.code) + '</b>' + esc(f.name) + '</button>';
    }).join('');
  }
  function twoWires(p) { return !!p && p.wires === 2; }
  function basePrice(model) { var v = session && session.prices ? Number(session.prices[model]) : 0; return v > 0 ? v : null; }
  // 최종 단가 = 거래처 모델 단가 × (1 - 거래처 할인율). 와이어 길이, 온도, 수량과 상관없다. 단가가 없으면 null.
  function unitPrice(p) {
    var base = basePrice(p.id); if (base == null) return null;
    return Math.round(base * (1 - ((session && session.discount) || 0) / 100) * 10) / 10;
  }
  function leadDays(items) { return items.some(function (i) { return i.qty >= C.lead.bigQty; }) ? C.lead.bigDays : C.lead.days; }
  function totals(items) { var net = items.reduce(function (s, i) { return s + i.unit * i.qty; }, 0); return { net: net, vat: net * C.price.vat, total: net * (1 + C.price.vat) }; }

  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }
  function say(el, text, isErr) { el.textContent = text || ''; el.classList.toggle('err', !!isErr); }
  function errText(err, fallback) { return err && err.message && !/fetch|network|json|token/i.test(err.message) ? err.message : fallback; }

  // ----- 로그인 -----
  function auth() { return { code: session.code, pw: session.pw }; }
  function renderSession() {
    var on = !!session;
    $('#login-panel').hidden = on;
    $('#who').hidden = !on;
    if (on) $('#who-name').textContent = session.customer.name + ' (' + session.code + ')';
    if (C) { renderModels(); renderSpec(); }
  }
  function login(code, pw, quiet) {
    return api.login(code, pw).then(function (d) {
      session = { code: code, pw: pw, customer: d.customer, prices: d.prices || {}, discount: Number(d.discount) || 0 };
      store(KEY.session, session);
      cart = (store(KEY.cart) || {})[code] || [];
      repriceCart(); renderSession(); renderCart();
      if (!quiet) toast(d.customer.name + '으로 로그인했어요');
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
    if (!code || !pw) { say(msg, '거래처 코드와 비밀번호를 넣어 주세요.', true); return; }
    if (!settings.open || !api.ready) { say(msg, '아직 로그인을 받지 않아요. 정식 오픈 후에 다시 와 주세요.', true); return; }
    say(msg, '확인하는 중이에요…'); $('#login-btn').disabled = true;
    login(code, pw).then(function () { say(msg, ''); $('#login-pw').value = ''; })
      .catch(function (err) { say(msg, errText(err, '로그인하지 못했어요. 잠시 후 다시 눌러 주세요.'), true); })
      .then(function () { $('#login-btn').disabled = false; });
  });
  $('#logout').addEventListener('click', function () { logout(); show('order'); toast('로그아웃했어요'); });

  // ----- 사양 입력 -----
  function renderModels() {
    $('#models').innerHTML = C.products.map(function (p) {
      var b = basePrice(p.id);
      var price = !session ? '로그인 후 단가' : b == null ? '단가 문의' : '단가 ' + won(unitPrice(p));
      return '<button type="button" class="model" data-id="' + esc(p.id) + '" aria-pressed="' + (p.id === sel.model) + '"><b>' + esc(p.id) + '</b>' +
        '<small>' + esc(p.name) + ' · ' + p.temp[0] + '~' + p.temp[1] + '°C</small><span class="price">' + price + '</span></button>';
    }).join('');
  }
  function renderChips() {
    var p = product(sel.model), L = C.length, Q = C.qty;
    $('#len2-field').hidden = !twoWires(p);
    $('#len-label').textContent = twoWires(p) ? '와이어 길이 1' : '와이어 길이';
    if (twoWires(p) && !$('#len2').value) $('#len2').value = $('#len').value;
    $('#len-hint').textContent = L.min + '~' + L.max + 'mm, ' + L.step + 'mm 단위';
    $('#temp-hint').textContent = p.id + ': ' + p.temp[0] + '~' + p.temp[1] + '°C, ' + C.tempStep + '°C 단위';
    $('#qty-hint').textContent = '최소 ' + Q.min.toLocaleString() + 'EA, ' + Q.step + 'EA 단위';
  }
  function validate() {
    var p = product(sel.model), L = C.length, Q = C.qty;
    var len = +$('#len').value, len2 = twoWires(p) ? +$('#len2').value : 0, temp = +$('#temp').value, qty = +$('#qty').value, errs = [];
    var badLen = function (v) { return !v || v < L.min || v > L.max || v % L.step; };
    if (badLen(len)) errs.push('와이어 길이는 ' + L.min + '~' + L.max + 'mm 사이 ' + L.step + 'mm 단위로 입력하세요.');
    if (twoWires(p) && badLen(len2)) errs.push('와이어 길이 2는 ' + L.min + '~' + L.max + 'mm 사이 ' + L.step + 'mm 단위로 입력하세요.');
    // 탈피는 선택 사항: 비워 두면 0, 적으면 0.1mm 단위로 와이어 길이보다 짧게
    var strip = +$('#strip').value || 0, strip2 = twoWires(p) ? +$('#strip2').value || 0 : 0;
    var badStrip = function (v, l) { return v && (v < 0 || v >= l || Math.abs(Math.round(v * 10) - v * 10) > 1e-9); };
    if (badStrip(strip, len)) errs.push('탈피' + (twoWires(p) ? ' 1' : '') + '은 와이어 길이보다 짧게 0.1mm 단위로 입력하세요.');
    if (badStrip(strip2, len2)) errs.push('탈피 2는 와이어 길이 2보다 짧게 0.1mm 단위로 입력하세요.');
    if (!temp || temp < p.temp[0] || temp > p.temp[1] || temp % C.tempStep) errs.push(p.id + ' 동작온도는 ' + p.temp[0] + '~' + p.temp[1] + '°C 사이 ' + C.tempStep + '°C 단위로 입력하세요.');
    if (!qty || qty < Q.min || qty % Q.step) errs.push('수량은 ' + Q.min + 'EA 이상 ' + Q.step + 'EA 단위로 입력하세요.');
    return { p: p, len: len, len2: len2, strip: strip, strip2: strip2, temp: temp, qty: qty, finish: sel.finish || '', errs: errs };
  }
  function renderSpec() {
    var v = validate(), add = $('#add-btn');
    $('#spec-code').textContent = specCode(v.p.id, v.len || 0, v.temp || 0, twoWires(v.p) ? v.len2 || 0 : 0, v.finish);
    if (v.errs.length) { $('#spec-meta').textContent = ''; $('#spec-err').textContent = v.errs[0]; add.disabled = true; return; }
    $('#spec-err').textContent = '';
    if (!session) { $('#spec-meta').textContent = '로그인하면 우리 회사 단가로 금액이 나옵니다.'; add.disabled = true; return; }
    var u = unitPrice(v.p);
    if (u == null) { $('#spec-meta').textContent = v.p.id + '는 아직 단가가 정해지지 않았어요. 담당 영업에 문의해 주세요.'; add.disabled = true; return; }
    $('#spec-meta').textContent = '단가 ' + won(u) + ' × ' + v.qty.toLocaleString() + 'EA = ' + won(u * v.qty);
    add.disabled = false;
  }
  function selectModel(id) {
    sel.model = id; renderModels(); renderChips();
    var p = product(id), t = +$('#temp').value;
    if (!(t >= p.temp[0] && t <= p.temp[1])) $('#temp').value = (C.tempPresets[p.family] || [p.temp[0]])[0];
  }
  function setSpec(model, len, temp, qty, len2, finish, strip, strip2) {
    if (!product(model)) return;
    if (finish) { sel.finish = finish; renderFinish(); }
    $('#len').value = len; $('#len2').value = len2 || ''; $('#strip').value = strip || ''; $('#strip2').value = strip2 || ''; $('#temp').value = temp; if (qty) $('#qty').value = qty;
    selectModel(model); renderSpec();
  }

  // ----- 발주서 (거래처마다 따로 보관) -----
  function saveCart() { if (!session) return; var all = store(KEY.cart) || {}; if (Array.isArray(all)) all = {}; all[session.code] = cart; store(KEY.cart, all); }
  function repriceCart() {
    cart = cart.filter(function (i) { var p = product(i.model); return p && (i.unit = unitPrice(p)) != null; });
    saveCart();
  }
  function renderCart() {
    $('#cart').innerHTML = cart.map(function (i, k) {
      return '<li class="cart-item"><code>' + esc(i.code) + '</code><span class="money">' + won(i.unit * i.qty) + '</span>' +
        '<div class="sub"><label for="cq-' + k + '">수량</label><input class="num" id="cq-' + k + '" data-k="' + k + '" type="number" step="' + C.qty.step + '" min="' + C.qty.min + '" value="' + i.qty + '">' +
        '<span>× ' + won(i.unit) + '</span>' + (stripText(i) ? '<span>· ' + esc(stripText(i)) + '</span>' : '') + (i.memo ? '<span>· ' + esc(i.memo) + '</span>' : '') +
        '<button type="button" class="btn ghost small" data-del="' + k + '">빼기</button></div></li>';
    }).join('');
    $('#cart-empty').hidden = cart.length > 0;
    $('#cart-sum').hidden = !cart.length;
    var c = $('#cart-count'); c.hidden = !cart.length; c.textContent = cart.length;
    if (!cart.length) { $('#checkout').hidden = true; return; }
    var t = totals(cart), d = addBizDays(leadDays(cart));
    $('#sum-net').textContent = won(t.net); $('#sum-vat').textContent = won(t.vat); $('#sum-total').textContent = won(t.total);
    $('#eta').innerHTML = '오늘 확정하면 생산 소요 <b>' + leadDays(cart) + '영업일</b>, 예상 출하일 <b>' + ymd(d) + '</b> ' + kday(d) + '.<br>선주문 생산이라 재고 출고는 없습니다.';
    var di = $('#c-date'); di.min = ymd(d); if (!di.value || di.value < ymd(d)) di.value = ymd(d);
    $('#date-hint').textContent = '가장 빠른 출하일 ' + ymd(d);
  }
  function addToCart() {
    var v = validate(); if (v.errs.length || !session) return;
    var unit = unitPrice(v.p); if (unit == null) return;
    var code = specCode(v.p.id, v.len, v.temp, v.len2, v.finish), memo = $('#item-memo').value.trim();
    var ex = cart.filter(function (i) { return i.code === code && i.memo === memo && (i.strip || 0) === v.strip && (i.strip2 || 0) === v.strip2; })[0];
    if (ex) { ex.qty += v.qty; ex.unit = unitPrice(v.p); }
    else cart.push({ code: code, model: v.p.id, len: v.len, len2: v.len2, strip: v.strip, strip2: v.strip2, finish: v.finish, temp: v.temp, qty: v.qty, unit: unit, memo: memo });
    $('#item-memo').value = '';
    saveCart(); renderCart(); $('#done').hidden = true;
    toast(code + ' ' + v.qty.toLocaleString() + 'EA 담았습니다');
  }

  // ----- 발주 확정 -----
  function fillCheckout() {
    var c = session.customer;
    $('#c-company').value = c.name; $('#c-name').value = c.contact || ''; $('#c-phone').value = c.phone || ''; $('#c-addr').value = c.address || '';
  }
  function submitOrder(e) {
    e.preventDefault();
    var err = $('#checkout-err');
    if (!session) { err.textContent = '로그인한 뒤에 발주할 수 있어요.'; return; }
    var v = { name: $('#c-name').value.trim(), phone: $('#c-phone').value.trim(), po: $('#c-po').value.trim(), addr: $('#c-addr').value.trim() };
    var miss = [['name', '담당자'], ['phone', '연락처'], ['addr', '납품 주소']].filter(function (x) { return !v[x[0]]; }).map(function (x) { return x[1]; });
    if (miss.length) { err.textContent = miss.join(', ') + '을(를) 입력하세요.'; return; }
    if (digits(v.phone).length < 8) { err.textContent = '연락처를 숫자 8자리 이상으로 적어 주세요.'; return; }
    if (!cart.length) return;
    var ship = addBizDays(leadDays(cart)), t = totals(cart);
    var order = {
      contact: v.name, phone: v.phone, customerPo: v.po, address: v.addr,
      memo: $('#c-memo').value.trim(), requestedDate: $('#c-date').value || ymd(ship), eta: ymd(ship),
      items: cart.map(function (i) { return { model: i.model, len: i.len, len2: i.len2 || 0, strip: i.strip || 0, strip2: i.strip2 || 0, finish: i.finish || '', temp: i.temp, qty: i.qty, memo: i.memo, code: i.code, unit: i.unit }; }),
      net: t.net, vat: t.vat, total: t.total
    };
    var f = $('#c-file').files[0];
    if (f && !ATTACH_OK.test(f.name)) { err.textContent = '발주서는 PDF, 사진, 엑셀, 워드, 한글 파일만 첨부할 수 있어요.'; return; }
    if (f && f.size > 10 * 1024 * 1024) { err.textContent = '발주서 파일은 10MB까지 첨부할 수 있어요.'; return; }
    $('#submit-btn').disabled = true; err.textContent = f ? '발주서와 함께 보내는 중이에요…' : '발주를 보내는 중이에요…';
    readFile(f).then(function (att) {
      if (att) order.attachment = att;
      return api.submit(auth(), order);
    }).then(function (saved) {
      err.textContent = ''; $('#c-file').value = '';
      rememberSpecs(cart);
      cart = []; saveCart(); renderCart();
      $('#checkout').hidden = true; $('#done').hidden = false;
      $('#done-no').textContent = saved.no;
      $('#done-text').textContent = session.customer.name + ' 발주가 접수되었습니다. 회사에서 생산을 확정하면 주문 조회의 상태가 바뀝니다. 합계 ' + won(saved.total || t.total) + ', 희망 출하일 ' + (saved.requestedDate || order.requestedDate) + '.';
      $('#done').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }).catch(function (e2) {
      err.textContent = errText(e2, '발주를 보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');
    }).then(function () { $('#submit-btn').disabled = false; });
  }

  // 첨부한 발주서를 글자(base64)로 바꿔 함께 보낸다
  var ATTACH_OK = /\.(pdf|jpe?g|png|xlsx?|docx?|hwpx?)$/i;
  function readFile(f) {
    if (!f) return Promise.resolve(null);
    return new Promise(function (ok, fail) {
      var r = new FileReader();
      r.onload = function () { ok({ name: f.name, data: String(r.result).split(',')[1] || '' }); };
      r.onerror = function () { fail(new Error('발주서 파일을 읽지 못했어요. 다시 골라 주세요.')); };
      r.readAsDataURL(f);
    });
  }
  // 시트에 남은 구글 드라이브 링크만 연다
  function fileLink(o) {
    if (/^https:\/\/(drive|docs)\.google\.com\//.test(o.attachment || '')) return '<div class="order-items"><a href="' + esc(o.attachment) + '" target="_blank" rel="noopener">발주서 보기</a></div>';
    return o.attachmentName ? '<div class="order-items">발주서 ' + esc(o.attachmentName) + '</div>' : '';
  }

  // ----- 최근 사양 (이 기기) -----
  function rememberSpecs(items) {
    var rec = store(KEY.recent) || [];
    var same = function (a, b) { return a.code === b.code && (a.strip || 0) === (b.strip || 0) && (a.strip2 || 0) === (b.strip2 || 0); };
    items.forEach(function (i) { rec = rec.filter(function (r) { return !same(r, i); }); rec.unshift({ code: i.code, model: i.model, len: i.len, len2: i.len2 || 0, strip: i.strip || 0, strip2: i.strip2 || 0, finish: i.finish || '', temp: i.temp, qty: i.qty }); });
    store(KEY.recent, rec.slice(0, 8)); renderRecent();
  }
  function renderRecent() {
    var rec = store(KEY.recent) || [];
    $('#reorder-panel').hidden = !rec.length;
    $('#recent-specs').innerHTML = rec.map(function (i) { return '<button type="button" class="chip" data-spec="' + esc([i.model, i.len, i.temp, i.qty, i.len2 || 0, i.finish || '', i.strip || 0, i.strip2 || 0].join('|')) + '">' + esc(i.code + (stripText(i) ? ' (' + stripText(i) + ')' : '')) + '</button>'; }).join('');
  }

  // ----- 주문 조회 -----
  // 예전 상태 이름으로 남은 발주는 새 이름으로 보여 준다
  var OLD_STATUS = { '생산 확정': '생산 지시', '출하 완료': '출하' };
  function pill(s) { s = OLD_STATUS[s] || s; return '<span class="pill ' + (STATUS[s] || 'st-received') + '">' + esc(s || '접수 대기') + '</span>'; }
  // 마감(T, TD)을 이름과 함께 보여 준다. 마감 칸이 생기기 전 발주는 "기록 없음"
  function finishTag(i) {
    if (!finishes().length) return '';
    var f = finishes().filter(function (x) { return x.code === i.finish; })[0];
    return '<div class="item-finish">마감: ' + (f ? '<b>' + esc(f.code) + '</b> ' + esc(f.name) : '마감 없음') + '</div>';
  }
  // 탈피 길이: 와이어가 두 줄이면 1·2를 나눠 적는다. 적지 않았으면 빈 글자
  function stripText(i) {
    var a = +i.strip || 0, b = +i.strip2 || 0;
    if (!a && !b) return '';
    return '탈피 ' + (i.len2 ? '1: ' + (a ? a + 'mm' : '없음') + ', 2: ' + (b ? b + 'mm' : '없음') : a + 'mm');
  }
  // 품목 메모는 사양 코드 아래에 작게 보여 준다
  function itemsHtml(o) {
    return '<ul class="order-items">' + o.items.map(function (i) {
      return '<li>' + esc(i.code) + ' × ' + Number(i.qty).toLocaleString() + finishTag(i) + (stripText(i) ? '<div class="item-finish">' + esc(stripText(i)) + '</div>' : '') + (i.memo ? '<div class="item-memo">메모: ' + esc(i.memo) + '</div>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  // 담당자가 예상 출하일을 정했으면 그것을, 아니면 희망 출하일을 보여 준다 (시트 칸 이름은 '확정 출하일' 그대로)
  function shipText(o) {
    return o.shipDate ? '<b>' + esc(o.shipDate) + '</b><div class="order-items">예상 출하일</div>'
      : esc(o.requestedDate) + '<div class="order-items">희망 · 예상일 미정</div>';
  }
  function loadHistory() {
    var msg = $('#history-msg');
    if (!session) { $('#history-wrap').hidden = true; say(msg, '주문하기 화면에서 거래처 로그인을 하면 발주 내역이 보입니다.'); return; }
    say(msg, '불러오는 중이에요…');
    api.mine(auth()).then(function (list) {
      history = list || [];
      $('#history-wrap').hidden = !history.length;
      say(msg, history.length ? '' : '아직 접수한 발주가 없어요.');
      $('#history-body').innerHTML = history.map(function (o) {
        return '<tr><td class="mono">' + esc(o.no) + (o.customerPo ? '<div class="order-items">귀사 PO ' + esc(o.customerPo) + '</div>' : '') + fileLink(o) + '</td>' +
          '<td class="mono">' + esc(String(o.createdAt).slice(0, 10)) + '</td><td>' + itemsHtml(o) + '</td>' +
          '<td class="mono">' + won(o.total) + '</td><td class="mono">' + shipText(o) + '</td><td>' + pill(o.status) + '</td>' +
          '<td><button type="button" class="btn ghost small" data-reorder="' + esc(o.no) + '">재주문</button></td></tr>';
      }).join('');
    }).catch(function (err) { say(msg, errText(err, '불러오지 못했어요. 잠시 후 다시 열어 주세요.'), true); });
  }
  function reorder(no) {
    var o = history.filter(function (x) { return x.no === no; })[0]; if (!o) return;
    var n = 0, skipped = 0;
    o.items.forEach(function (i) {
      var p = product(i.model), unit = p ? unitPrice(p) : null;
      if (unit == null) { skipped++; return; }
      n++; cart.push({ code: i.code, model: i.model, len: +i.len, len2: +i.len2 || 0, strip: +i.strip || 0, strip2: +i.strip2 || 0, finish: i.finish || '', temp: +i.temp, qty: +i.qty, memo: i.memo || '', unit: unit });
    });
    saveCart(); renderCart(); show('order'); $('#done').hidden = true;
    toast(o.no + '의 품목 ' + n + '개를 현재 단가로 담았습니다' + (skipped ? ' (단가가 없는 ' + skipped + '개 제외)' : ''));
  }

  // ----- 관리 -----
  // 관리 열쇠는 팀마다 다르다(관리자, 영업팀, 조회 전용). 이름은 상태를 바꿀 때 기록에 남는다.
  function staffInfo() { var v = store(KEY.admin); return v && typeof v === 'object' && v.key ? v : null; }
  function adminKey() { var v = staffInfo(); return v ? v.key : null; }
  function adminLoad() {
    var key = adminKey(), msg = $('#admin-msg');
    $('#key-form').hidden = !!key; $('#admin-wrap').hidden = !key;
    if (!key) return;
    if (!api.ready) { say(msg, '주문 받을 주소(orderUrl)가 아직 없어요. README의 순서대로 구글 시트를 연결해 주세요.', true); return; }
    say(msg, '불러오는 중이에요…');
    api.staff(key).then(function (r) {
      role = r;
      return Promise.all([api.list(key), canEdit() ? api.customers(key) : []]);
    }).then(function (r) {
      adminOrders = r[0] || []; customers = r[1] || []; say(msg, '');
      $('#staff-badge').textContent = ROLES[role] + ' · ' + staffInfo().name;
      $('#staff-badge').className = 'role role-' + role;
      $('#cust-tab').hidden = !canEdit();
      showAdminTab(canEdit() ? adminTab : 'orders');
      renderAdmin(); renderLead(); if (canEdit()) renderCustomers();
    }).catch(function (err) {
      store(KEY.admin, null); role = null; $('#key-form').hidden = false; $('#admin-wrap').hidden = true;
      say(msg, errText(err, '불러오지 못했어요.'), true);
    });
  }
  function showAdminTab(tab) {
    adminTab = tab;
    document.querySelectorAll('[data-admin-tab]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.adminTab === tab); });
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
      return '<tr><td class="mono">' + esc(o.no) + '<div class="order-items">' + esc(String(o.createdAt).slice(0, 16).replace('T', ' ')) + '</div>' + (o.customerPo ? '<div class="order-items">PO ' + esc(o.customerPo) + '</div>' : '') + fileLink(o) + '</td>' +
        '<td><b>' + esc(o.company) + '</b> <span class="order-items">' + esc(o.code || '') + '</span><div class="order-items">' + esc(o.contact) + ' · ' + esc(o.phone) + '</div><div class="order-items">' + esc(o.address) + '</div>' + (o.memo ? '<div class="order-items">요청: ' + esc(o.memo) + '</div>' : '') + '</td>' +
        '<td>' + itemsHtml(o) + '</td><td class="mono">' + won(o.total) + '</td>' +
        '<td class="mono">' + shipCell(o) + '</td>' +
        '<td>' + statusCell(o) + '</td></tr>';
    }).join('');
    $('#admin-empty').hidden = list.length > 0;
  }
  function canEdit() { return role === 'admin' || role === 'sales'; }
  function shipCell(o) {
    var head = '<div class="order-items">희망 ' + esc(o.requestedDate) + ' · 최단 ' + esc(o.eta) + '</div>';
    if (!canEdit()) return (o.shipDate ? '<b>' + esc(o.shipDate) + '</b>' : '<span class="order-items">예상일 미정</span>') + head;
    return '<label class="ship"><span class="order-items">예상 출하일</span><input type="date" data-ship="' + esc(o.no) + '" value="' + esc(o.shipDate || '') + '"></label>' + head;
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

  // 거래처 단가
  function renderCustomers() {
    $('#cust-head').innerHTML = '<tr><th>코드</th><th>거래처</th><th>담당 · 연락처</th>' + C.products.map(function (p) { return '<th>' + esc(p.id) + '</th>'; }).join('') + '<th>할인율</th><th>상태</th><th></th></tr>';
    $('#cust-body').innerHTML = customers.map(function (c) {
      return '<tr class="' + (c.active ? '' : 'off') + (editing === c.code ? ' editing' : '') + '"><td class="mono">' + esc(c.code) + '</td><td><b>' + esc(c.name) + '</b></td>' +
        '<td>' + esc(c.contact) + '<div class="order-items">' + esc(c.phone) + '</div></td>' +
        C.products.map(function (p) { var v = Number((c.prices || {})[p.id]); return '<td class="num">' + (v > 0 ? v.toLocaleString() : '-') + '</td>'; }).join('') +
        '<td class="num">' + (c.discount ? c.discount + '%' : '-') + '</td><td>' + (c.active ? '사용' : '중지') + '</td><td><button type="button" class="btn ghost small" data-edit="' + esc(c.code) + '">수정</button></td></tr>';
    }).join('');
    $('#cust-empty').hidden = customers.length > 0;
    if (!$('#cu-prices').children.length) {
      $('#cu-prices').innerHTML = C.products.map(function (p) {
        return '<label for="cp-' + esc(p.id) + '">' + esc(p.id) + '<input class="num" id="cp-' + esc(p.id) + '" data-price="' + esc(p.id) + '" type="number" min="0" step="0.1" inputmode="decimal" placeholder="단가 문의"></label>';
      }).join('');
    }
  }
  function fillCustomerForm(c) {
    editing = c ? c.code : null;
    $('#cust-form-title').textContent = c ? c.name + ' 수정' : '거래처 추가';
    $('#cu-code').value = c ? c.code : '';
    $('#cu-code-hint').textContent = c ? '바꾸면 비밀번호도 새로 정해야 해요. 지난 발주도 새 코드로 옮겨져요.' : '거래처가 로그인할 때 씁니다.';
    $('#cu-delete').hidden = !c;
    $('#cu-name').value = c ? c.name : ''; $('#cu-contact').value = c ? c.contact : ''; $('#cu-phone').value = c ? c.phone : ''; $('#cu-addr').value = c ? c.address : '';
    $('#cu-pw').value = ''; $('#cu-pw-hint').textContent = c ? '바꿀 때만 적으세요. 비워 두면 그대로예요.' : '거래처에 알려줄 비밀번호 (4자 이상)';
    $('#cu-active').value = !c || c.active ? '1' : '0';
    $('#cu-discount').value = c && c.discount ? c.discount : '';
    document.querySelectorAll('[data-price]').forEach(function (inp) { var v = c && c.prices ? Number(c.prices[inp.dataset.price]) : 0; inp.value = v > 0 ? v : ''; });
    say($('#cu-msg'), '');
    renderCustomers();
  }
  $('#cust-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('#cu-msg'), prices = {};
    var c = { code: $('#cu-code').value.trim().toUpperCase(), name: $('#cu-name').value.trim(), contact: $('#cu-contact').value.trim(),
      phone: $('#cu-phone').value.trim(), address: $('#cu-addr').value.trim(), active: $('#cu-active').value === '1', pw: $('#cu-pw').value };
    if (!/^[A-Z0-9_-]{2,20}$/.test(c.code)) { say(msg, '거래처 코드는 영문 대문자, 숫자, -, _ 로 2~20자예요.', true); return; }
    if (!c.name) { say(msg, '거래처명을 적어 주세요.', true); return; }
    var renamed = !!(editing && editing !== c.code);
    if ((!editing || renamed) && customers.some(function (x) { return x.code === c.code; })) { say(msg, '이미 있는 거래처 코드예요. 목록에서 수정을 눌러 주세요.', true); return; }
    if (!editing && c.pw.length < 4) { say(msg, '새 거래처는 비밀번호를 4자 이상 정해 주세요.', true); return; }
    if (renamed && c.pw.length < 4) { say(msg, '거래처 코드를 바꾸면 비밀번호도 새로 정해야 해요 (4자 이상).', true); return $('#cu-pw').focus(); }
    if (editing) c.oldCode = editing;
    if (c.pw && c.pw.length < 4) { say(msg, '비밀번호는 4자 이상이에요.', true); return; }
    document.querySelectorAll('[data-price]').forEach(function (inp) { var v = Number(inp.value); if (v > 0) prices[inp.dataset.price] = Math.round(v * 10) / 10; });
    c.prices = prices;
    c.discount = Number($('#cu-discount').value) || 0;
    if (c.discount < 0 || c.discount >= 100) { say(msg, '할인율은 0 이상 100 미만으로 적어 주세요.', true); return; }
    $('#cu-save').disabled = true; say(msg, '저장하는 중이에요…');
    api.saveCustomer(adminKey(), c).then(function () {
      return api.customers(adminKey());
    }).then(function (list) {
      customers = list || [];
      fillCustomerForm(customers.filter(function (x) { return x.code === c.code; })[0]);
      say(msg, '저장했어요. 거래처가 다음에 로그인하면 새 단가가 보여요.');
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

  // ----- 탭 -----
  function show(view) {
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.view === view); });
    ['order', 'history', 'admin'].forEach(function (v) { $('#view-' + v).hidden = v !== view; });
    if (view === 'admin') { $('#tab-admin').hidden = false; adminLoad(); }
    if (view === 'history') loadHistory();
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
    if (d.spec) { var s = d.spec.split('|'); setSpec(s[0], +s[1], +s[2], +s[3], +s[4] || 0, s[5] || '', +s[6] || 0, +s[7] || 0); return window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (d.reorder) return reorder(d.reorder);
    if (d.filter) { adminFilter = d.filter; return renderAdmin(); }
    if (d.adminTab) return showAdminTab(d.adminTab);
    if (d.edit) { fillCustomerForm(customers.filter(function (x) { return x.code === d.edit; })[0]); return $('#cust-form').scrollIntoView({ behavior: 'smooth' }); }
  });
  ['len', 'len2', 'strip', 'strip2', 'temp', 'qty'].forEach(function (id) { $('#' + id).addEventListener('input', function () { if (C) renderSpec(); }); });
  $('#add-btn').addEventListener('click', addToCart);
  $('#cart').addEventListener('change', function (e) {
    var k = e.target.dataset.k; if (k === undefined) return;
    var i = cart[+k], p = product(i.model);
    i.qty = Math.max(C.qty.min, Math.round((+e.target.value || 0) / C.qty.step) * C.qty.step);
    i.unit = unitPrice(p); saveCart(); renderCart();
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
  // 닫기: 저장된 열쇠를 지우고 주문관리 탭도 감춘다 (다시 열려면 맨 아래 관리자 버튼)
  $('#admin-logout').addEventListener('click', function () { store(KEY.admin, null); role = null; $('#tab-admin').hidden = true; show('order'); toast('주문관리를 닫았어요'); });
  $('#admin-body').addEventListener('change', function (e) {
    if (e.target.dataset.status) askStatus(e.target.dataset.status, e.target.value);
    if (e.target.dataset.ship) saveShip(e.target);
  });

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
    if (adminKey()) $('#tab-admin').hidden = false;
    setSpec(C.products[0].id, 70, 100, 1000); renderFinish();
    renderRecent();
    // 담당자가 관리 화면에서 바꾼 생산 소요일을 받아 온다
    if (api.ready && api.config) api.config().then(function (d) { if (d && d.lead && d.lead.days) { C.lead = d.lead; renderCart(); } }).catch(function () {});
    if (session && api.ready) {
      cart = (store(KEY.cart) || {})[session.code] || [];
      renderSession(); renderCart();
      // 저장된 로그인으로 단가를 새로 받아 온다. 비밀번호가 바뀌었거나 중지된 거래처면 로그아웃한다.
      login(session.code, session.pw, true).catch(function (err) {
        if (/맞지|중지/.test((err && err.message) || '')) { logout(); toast('다시 로그인해 주세요'); }
      });
    } else { session = null; renderSession(); renderCart(); }
  }).catch(function () {
    $('#models').innerHTML = '<p class="msg err">제품 목록을 불러오지 못했어요. 새로고침해 주세요.</p>';
  });
})();
