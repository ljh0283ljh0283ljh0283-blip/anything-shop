// SEKI POmall 발주: 거래처가 로그인해 사양(모델, 와이어 길이, 동작온도)을 골라 선주문 생산을 요청한다.
// 모델 단가는 거래처마다 다르다. 회사가 관리 > 거래처 단가에서 정하고, 거래처는 로그인해야 자기 단가만 본다.
// 제품 목록과 공통 가산·할인 규칙은 products.json, 주문 저장 위치는 settings.json에서 정한다.
// 저장 위치를 바꾸려면 STORAGES에 같은 일을 하는 항목을 더하고 settings.json의 storage 값을 그 이름으로 바꾼다.
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var KEY = { cart: 'pomall.cart', session: 'pomall.session', admin: 'pomall.admin', recent: 'pomall.recent', localOrders: 'pomall.orders', localCustomers: 'pomall.customers' };
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
    return null;
  }

  var STATUS = { '접수 대기': 'st-received', '생산 확정': 'st-confirmed', '생산 중': 'st-production', '출하 완료': 'st-shipped', '취소': 'st-canceled' };
  var STATUS_LIST = Object.keys(STATUS);

  // ----- 저장 위치 -----
  // 각 저장 위치는 같은 일을 한다:
  //   login(code, pw) → {customer, prices}      submit(auth, order) → {no, total, ...}      mine(auth) → [발주]
  //   list(key) → [발주]      setStatus(key, no, status)      customers(key) → [거래처]      saveCustomer(key, 거래처)
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
        list: function (key) { return call({ action: 'list', key: key }).then(function (d) { return d.orders; }); },
        setStatus: function (key, no, status) { return call({ action: 'status', key: key, no: no, status: status }); },
        customers: function (key) { return call({ action: 'customers', key: key }).then(function (d) { return d.customers; }); },
        saveCustomer: function (key, c) { return call({ action: 'saveCustomer', key: key, customer: c }); }
      };
    },
    // 이 브라우저에만 저장 (화면 확인용). 다른 사람에게는 보이지 않는다.
    local: function () {
      function orders() { return store(KEY.localOrders) || []; }
      function custs() { return store(KEY.localCustomers) || []; }
      function auth(code, pw) {
        var c = custs().filter(function (x) { return x.code === code && x.pw === pw && x.active; })[0];
        return c ? Promise.resolve(c) : Promise.reject(new Error('거래처 코드나 비밀번호가 맞지 않아요.'));
      }
      function pub(c) { return { code: c.code, name: c.name, contact: c.contact, phone: c.phone, address: c.address, active: c.active, prices: c.prices, hasPassword: !!c.pw }; }
      return {
        ready: true,
        login: function (code, pw) { return auth(code, pw).then(function (c) { return { customer: pub(c), prices: c.prices }; }); },
        submit: function (a, order) {
          return auth(a.code, a.pw).then(function (c) {
            var o = Object.assign({}, order, { no: orderNo(), code: c.code, company: c.name, createdAt: new Date().toISOString(), status: '접수 대기' });
            var list = orders(); list.unshift(o); store(KEY.localOrders, list); return o;
          });
        },
        mine: function (a) { return auth(a.code, a.pw).then(function (c) { return orders().filter(function (o) { return o.code === c.code; }); }); },
        list: function () { return Promise.resolve(orders()); },
        setStatus: function (key, no, status) {
          var list = orders(); list.forEach(function (o) { if (o.no === no) o.status = status; }); store(KEY.localOrders, list);
          return Promise.resolve({ ok: true });
        },
        customers: function () { return Promise.resolve(custs().map(pub)); },
        saveCustomer: function (key, c) {
          var list = custs(), ex = list.filter(function (x) { return x.code === c.code; })[0];
          if (!ex && !c.pw) return Promise.reject(new Error('새 거래처는 비밀번호가 필요해요.'));
          var row = Object.assign(ex || {}, { code: c.code, name: c.name, contact: c.contact, phone: c.phone, address: c.address, active: c.active, prices: c.prices });
          if (c.pw) row.pw = c.pw;
          if (!ex) list.push(row);
          store(KEY.localCustomers, list); return Promise.resolve({ ok: true });
        }
      };
    }
  };

  // ----- 상태 -----
  var C = null, settings = {}, api = null;
  var sel = { model: null };
  var session = store(KEY.session);      // {code, pw, customer, prices}
  var cart = [];
  var history = [];
  var adminOrders = [], adminFilter = 'all', adminTab = 'orders', customers = [], editing = null;

  // ----- 계산 -----
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var kday = function (d) { return (d.getMonth() + 1) + '/' + d.getDate() + '(' + '일월화수목금토'[d.getDay()] + ')'; };
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function orderNo() { var d = new Date(); return 'PO-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  function addBizDays(n) { var d = new Date(); d.setHours(0, 0, 0, 0); var k = 0; while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) k++; } return d; }
  function product(id) { return C.products.filter(function (p) { return p.id === id; })[0]; }
  function specCode(model, len, temp) { return model + '-L' + String(len).padStart(3, '0') + '-T' + String(temp).padStart(3, '0'); }
  function basePrice(model) { var v = session && session.prices ? Number(session.prices[model]) : 0; return v > 0 ? v : null; }
  // 거래처 모델 단가에 공통 가산(와이어 길이, 고온)과 수량 할인을 붙인다. 단가가 없으면 null.
  function unitPrice(p, len, temp, qty) {
    var base = basePrice(p.id); if (base == null) return null;
    var r = C.price, u = base + Math.max(0, (len - r.wireBaseMm) / 10) * r.wirePer10mm;
    if (temp > r.highTempOver) u *= 1 + r.highTempRate;
    var v = r.volume.filter(function (v) { return qty >= v.min; })[0];
    if (v) u *= 1 - v.off;
    return Math.round(u * 10) / 10;
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
      session = { code: code, pw: pw, customer: d.customer, prices: d.prices || {} };
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
      var price = !session ? '로그인 후 단가' : b == null ? '단가 문의' : '기본 ' + won(b);
      return '<button type="button" class="model" data-id="' + esc(p.id) + '" aria-pressed="' + (p.id === sel.model) + '"><b>' + esc(p.id) + '</b>' +
        '<small>' + esc(p.name) + ' · ' + p.temp[0] + '~' + p.temp[1] + '°C</small><span class="price">' + price + '</span></button>';
    }).join('');
  }
  function renderChips() {
    var p = product(sel.model), L = C.length, Q = C.qty;
    $('#len-chips').innerHTML = L.presets.map(function (v) { return '<button type="button" class="chip" data-len="' + v + '">' + v + '</button>'; }).join('');
    $('#temp-chips').innerHTML = (C.tempPresets[p.family] || []).map(function (v) { return '<button type="button" class="chip" data-temp="' + v + '">' + v + '</button>'; }).join('');
    $('#qty-chips').innerHTML = Q.presets.map(function (v) { return '<button type="button" class="chip" data-qty="' + v + '">' + v.toLocaleString() + '</button>'; }).join('');
    $('#len-hint').textContent = L.min + '~' + L.max + 'mm, ' + L.step + 'mm 단위';
    $('#temp-hint').textContent = p.id + ': ' + p.temp[0] + '~' + p.temp[1] + '°C, ' + C.tempStep + '°C 단위';
    $('#qty-hint').textContent = '최소 ' + Q.min.toLocaleString() + 'EA, ' + Q.step + 'EA 단위';
  }
  function validate() {
    var p = product(sel.model), L = C.length, Q = C.qty;
    var len = +$('#len').value, temp = +$('#temp').value, qty = +$('#qty').value, errs = [];
    if (!len || len < L.min || len > L.max || len % L.step) errs.push('와이어 길이는 ' + L.min + '~' + L.max + 'mm 사이 ' + L.step + 'mm 단위로 입력하세요.');
    if (!temp || temp < p.temp[0] || temp > p.temp[1] || temp % C.tempStep) errs.push(p.id + ' 동작온도는 ' + p.temp[0] + '~' + p.temp[1] + '°C 사이 ' + C.tempStep + '°C 단위로 입력하세요.');
    if (!qty || qty < Q.min || qty % Q.step) errs.push('수량은 ' + Q.min + 'EA 이상 ' + Q.step + 'EA 단위로 입력하세요.');
    return { p: p, len: len, temp: temp, qty: qty, errs: errs };
  }
  function renderSpec() {
    var v = validate(), add = $('#add-btn');
    $('#spec-code').textContent = specCode(v.p.id, v.len || 0, v.temp || 0);
    if (v.errs.length) { $('#spec-meta').textContent = ''; $('#spec-err').textContent = v.errs[0]; add.disabled = true; return; }
    $('#spec-err').textContent = '';
    if (!session) { $('#spec-meta').textContent = '로그인하면 우리 회사 단가로 금액이 나옵니다.'; add.disabled = true; return; }
    var u = unitPrice(v.p, v.len, v.temp, v.qty);
    if (u == null) { $('#spec-meta').textContent = v.p.id + '는 아직 단가가 정해지지 않았어요. 담당 영업에 문의해 주세요.'; add.disabled = true; return; }
    $('#spec-meta').textContent = '단가 ' + won(u) + ' × ' + v.qty.toLocaleString() + 'EA = ' + won(u * v.qty);
    add.disabled = false;
  }
  function selectModel(id) {
    sel.model = id; renderModels(); renderChips();
    var p = product(id), t = +$('#temp').value;
    if (!(t >= p.temp[0] && t <= p.temp[1])) $('#temp').value = (C.tempPresets[p.family] || [p.temp[0]])[0];
  }
  function setSpec(model, len, temp, qty) {
    if (!product(model)) return;
    $('#len').value = len; $('#temp').value = temp; if (qty) $('#qty').value = qty;
    selectModel(model); renderSpec();
  }

  // ----- 발주서 (거래처마다 따로 보관) -----
  function saveCart() { if (!session) return; var all = store(KEY.cart) || {}; if (Array.isArray(all)) all = {}; all[session.code] = cart; store(KEY.cart, all); }
  function repriceCart() {
    cart = cart.filter(function (i) { var p = product(i.model); return p && (i.unit = unitPrice(p, i.len, i.temp, i.qty)) != null; });
    saveCart();
  }
  function renderCart() {
    $('#cart').innerHTML = cart.map(function (i, k) {
      return '<li class="cart-item"><code>' + esc(i.code) + '</code><span class="money">' + won(i.unit * i.qty) + '</span>' +
        '<div class="sub"><label for="cq-' + k + '">수량</label><input class="num" id="cq-' + k + '" data-k="' + k + '" type="number" step="' + C.qty.step + '" min="' + C.qty.min + '" value="' + i.qty + '">' +
        '<span>× ' + won(i.unit) + '</span>' + (i.memo ? '<span>· ' + esc(i.memo) + '</span>' : '') +
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
    var unit = unitPrice(v.p, v.len, v.temp, v.qty); if (unit == null) return;
    var code = specCode(v.p.id, v.len, v.temp), memo = $('#item-memo').value.trim();
    var ex = cart.filter(function (i) { return i.code === code && i.memo === memo; })[0];
    if (ex) { ex.qty += v.qty; ex.unit = unitPrice(v.p, v.len, v.temp, ex.qty); }
    else cart.push({ code: code, model: v.p.id, len: v.len, temp: v.temp, qty: v.qty, unit: unit, memo: memo });
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
      items: cart.map(function (i) { return { model: i.model, len: i.len, temp: i.temp, qty: i.qty, memo: i.memo, code: i.code, unit: i.unit }; }),
      net: t.net, vat: t.vat, total: t.total
    };
    $('#submit-btn').disabled = true; err.textContent = '발주를 보내는 중이에요…';
    api.submit(auth(), order).then(function (saved) {
      err.textContent = '';
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

  // ----- 최근 사양 (이 기기) -----
  function rememberSpecs(items) {
    var rec = store(KEY.recent) || [];
    items.forEach(function (i) { rec = rec.filter(function (r) { return r.code !== i.code; }); rec.unshift({ code: i.code, model: i.model, len: i.len, temp: i.temp, qty: i.qty }); });
    store(KEY.recent, rec.slice(0, 8)); renderRecent();
  }
  function renderRecent() {
    var rec = store(KEY.recent) || [];
    $('#reorder-panel').hidden = !rec.length;
    $('#recent-specs').innerHTML = rec.map(function (i) { return '<button type="button" class="chip" data-spec="' + esc([i.model, i.len, i.temp, i.qty].join('|')) + '">' + esc(i.code) + '</button>'; }).join('');
  }

  // ----- 주문 조회 -----
  function pill(s) { return '<span class="pill ' + (STATUS[s] || 'st-received') + '">' + esc(s || '접수 대기') + '</span>'; }
  function itemsHtml(o) { return '<ul class="order-items">' + o.items.map(function (i) { return '<li>' + esc(i.code) + ' × ' + Number(i.qty).toLocaleString() + '</li>'; }).join('') + '</ul>'; }
  function loadHistory() {
    var msg = $('#history-msg');
    if (!session) { $('#history-wrap').hidden = true; say(msg, '주문하기 화면에서 거래처 로그인을 하면 발주 내역이 보입니다.'); return; }
    say(msg, '불러오는 중이에요…');
    api.mine(auth()).then(function (list) {
      history = list || [];
      $('#history-wrap').hidden = !history.length;
      say(msg, history.length ? '' : '아직 접수한 발주가 없어요.');
      $('#history-body').innerHTML = history.map(function (o) {
        return '<tr><td class="mono">' + esc(o.no) + (o.customerPo ? '<div class="order-items">귀사 PO ' + esc(o.customerPo) + '</div>' : '') + '</td>' +
          '<td class="mono">' + esc(String(o.createdAt).slice(0, 10)) + '</td><td>' + itemsHtml(o) + '</td>' +
          '<td class="mono">' + won(o.total) + '</td><td class="mono">' + esc(o.requestedDate) + '</td><td>' + pill(o.status) + '</td>' +
          '<td><button type="button" class="btn ghost small" data-reorder="' + esc(o.no) + '">재주문</button></td></tr>';
      }).join('');
    }).catch(function (err) { say(msg, errText(err, '불러오지 못했어요. 잠시 후 다시 열어 주세요.'), true); });
  }
  function reorder(no) {
    var o = history.filter(function (x) { return x.no === no; })[0]; if (!o) return;
    var n = 0, skipped = 0;
    o.items.forEach(function (i) {
      var p = product(i.model), unit = p ? unitPrice(p, +i.len, +i.temp, +i.qty) : null;
      if (unit == null) { skipped++; return; }
      n++; cart.push({ code: i.code, model: i.model, len: +i.len, temp: +i.temp, qty: +i.qty, memo: i.memo || '', unit: unit });
    });
    saveCart(); renderCart(); show('order'); $('#done').hidden = true;
    toast(o.no + '의 품목 ' + n + '개를 현재 단가로 담았습니다' + (skipped ? ' (단가 없는 ' + skipped + '개 제외)' : ''));
  }

  // ----- 관리 -----
  function adminKey() { return store(KEY.admin); }
  function adminLoad() {
    var key = adminKey(), msg = $('#admin-msg');
    $('#key-form').hidden = !!key; $('#admin-wrap').hidden = !key;
    if (!key) return;
    if (!api.ready) { say(msg, '주문 받을 주소(orderUrl)가 아직 없어요. README의 순서대로 구글 시트를 연결해 주세요.', true); return; }
    say(msg, '불러오는 중이에요…');
    Promise.all([api.list(key), api.customers(key)]).then(function (r) {
      adminOrders = r[0] || []; customers = r[1] || []; say(msg, '');
      renderAdmin(); renderCustomers();
    }).catch(function (err) {
      store(KEY.admin, null); $('#key-form').hidden = false; $('#admin-wrap').hidden = true;
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
      return '<tr><td class="mono">' + esc(o.no) + '<div class="order-items">' + esc(String(o.createdAt).slice(0, 16).replace('T', ' ')) + '</div>' + (o.customerPo ? '<div class="order-items">PO ' + esc(o.customerPo) + '</div>' : '') + '</td>' +
        '<td><b>' + esc(o.company) + '</b> <span class="order-items">' + esc(o.code || '') + '</span><div class="order-items">' + esc(o.contact) + ' · ' + esc(o.phone) + '</div><div class="order-items">' + esc(o.address) + '</div>' + (o.memo ? '<div class="order-items">요청: ' + esc(o.memo) + '</div>' : '') + '</td>' +
        '<td>' + itemsHtml(o) + '</td><td class="mono">' + won(o.total) + '</td>' +
        '<td class="mono">' + esc(o.requestedDate) + '<div class="order-items">최단 ' + esc(o.eta) + '</div></td>' +
        '<td><select data-status="' + esc(o.no) + '" aria-label="' + esc(o.no) + ' 상태">' + STATUS_LIST.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td></tr>';
    }).join('');
    $('#admin-empty').hidden = list.length > 0;
  }
  function changeStatus(no, status, selectEl) {
    selectEl.disabled = true;
    api.setStatus(adminKey(), no, status).then(function () {
      adminOrders.forEach(function (o) { if (o.no === no) o.status = status; });
      renderAdmin(); toast(no + ' → ' + status);
    }).catch(function (err) { toast(errText(err, '상태를 바꾸지 못했어요.')); renderAdmin(); });
  }

  // 거래처 단가
  function renderCustomers() {
    $('#cust-head').innerHTML = '<tr><th>코드</th><th>거래처</th><th>담당 · 연락처</th>' + C.products.map(function (p) { return '<th>' + esc(p.id) + '</th>'; }).join('') + '<th>상태</th><th></th></tr>';
    $('#cust-body').innerHTML = customers.map(function (c) {
      return '<tr class="' + (c.active ? '' : 'off') + (editing === c.code ? ' editing' : '') + '"><td class="mono">' + esc(c.code) + '</td><td><b>' + esc(c.name) + '</b></td>' +
        '<td>' + esc(c.contact) + '<div class="order-items">' + esc(c.phone) + '</div></td>' +
        C.products.map(function (p) { var v = Number((c.prices || {})[p.id]); return '<td class="num">' + (v > 0 ? v.toLocaleString() : '-') + '</td>'; }).join('') +
        '<td>' + (c.active ? '사용' : '중지') + '</td><td><button type="button" class="btn ghost small" data-edit="' + esc(c.code) + '">수정</button></td></tr>';
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
    $('#cu-code').value = c ? c.code : ''; $('#cu-code').readOnly = !!c;
    $('#cu-name').value = c ? c.name : ''; $('#cu-contact').value = c ? c.contact : ''; $('#cu-phone').value = c ? c.phone : ''; $('#cu-addr').value = c ? c.address : '';
    $('#cu-pw').value = ''; $('#cu-pw-hint').textContent = c ? '바꿀 때만 적으세요. 비워 두면 그대로예요.' : '거래처에 알려줄 비밀번호 (4자 이상)';
    $('#cu-active').value = !c || c.active ? '1' : '0';
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
    if (!editing && customers.some(function (x) { return x.code === c.code; })) { say(msg, '이미 있는 거래처 코드예요. 목록에서 수정을 눌러 주세요.', true); return; }
    if (!editing && c.pw.length < 4) { say(msg, '새 거래처는 비밀번호를 4자 이상 정해 주세요.', true); return; }
    if (c.pw && c.pw.length < 4) { say(msg, '비밀번호는 4자 이상이에요.', true); return; }
    document.querySelectorAll('[data-price]').forEach(function (inp) { var v = Number(inp.value); if (v > 0) prices[inp.dataset.price] = Math.round(v * 10) / 10; });
    c.prices = prices;
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
    if (d.len) { $('#len').value = d.len; return renderSpec(); }
    if (d.temp) { $('#temp').value = d.temp; return renderSpec(); }
    if (d.qty) { $('#qty').value = d.qty; return renderSpec(); }
    if (d.del !== undefined) { cart.splice(+d.del, 1); saveCart(); return renderCart(); }
    if (d.spec) { var s = d.spec.split('|'); setSpec(s[0], +s[1], +s[2], +s[3]); return window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (d.reorder) return reorder(d.reorder);
    if (d.filter) { adminFilter = d.filter; return renderAdmin(); }
    if (d.adminTab) return showAdminTab(d.adminTab);
    if (d.edit) { fillCustomerForm(customers.filter(function (x) { return x.code === d.edit; })[0]); return $('#cust-form').scrollIntoView({ behavior: 'smooth' }); }
  });
  ['len', 'temp', 'qty'].forEach(function (id) { $('#' + id).addEventListener('input', function () { if (C) renderSpec(); }); });
  $('#add-btn').addEventListener('click', addToCart);
  $('#cart').addEventListener('change', function (e) {
    var k = e.target.dataset.k; if (k === undefined) return;
    var i = cart[+k], p = product(i.model);
    i.qty = Math.max(C.qty.min, Math.round((+e.target.value || 0) / C.qty.step) * C.qty.step);
    i.unit = unitPrice(p, i.len, i.temp, i.qty); saveCart(); renderCart();
  });
  $('#go-checkout').addEventListener('click', function () { if (!session) return; $('#checkout').hidden = false; fillCheckout(); $('#checkout').scrollIntoView({ behavior: 'smooth' }); });
  $('#cancel-checkout').addEventListener('click', function () { $('#checkout').hidden = true; });
  $('#checkout-form').addEventListener('submit', submitOrder);
  $('#done-history').addEventListener('click', function () { show('history'); });
  $('#admin-entry').addEventListener('click', function () { show('admin'); });
  $('#key-form').addEventListener('submit', function (e) {
    e.preventDefault(); var k = $('#admin-key').value.trim();
    if (!k) { say($('#admin-msg'), '관리자 열쇠를 적어 주세요.', true); return; }
    store(KEY.admin, k); $('#admin-key').value = ''; adminLoad();
  });
  $('#admin-reload').addEventListener('click', adminLoad);
  $('#admin-logout').addEventListener('click', function () { store(KEY.admin, null); adminLoad(); say($('#admin-msg'), '닫았어요.'); });
  $('#admin-body').addEventListener('change', function (e) { if (e.target.dataset.status) changeStatus(e.target.dataset.status, e.target.value, e.target); });

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
    setSpec(C.products[0].id, 70, 100, 1000);
    renderRecent();
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
