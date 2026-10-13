// SEKI POmall 발주: 거래처가 사양(모델, 와이어 길이, 동작온도)을 골라 선주문 생산을 요청한다.
// 제품과 가격 기준은 products.json, 주문 저장 위치는 settings.json에서 정한다.
// 저장 위치를 바꾸려면 아래 STORAGES에 같은 네 가지 일(submit, lookup, list, setStatus)을 하는 항목을 더하고
// settings.json의 storage 값을 그 이름으로 바꾸면 된다. 화면 코드는 그대로 둔다.
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var KEY = { cart: 'pomall.cart', customer: 'pomall.customer', admin: 'pomall.admin', recent: 'pomall.recent', local: 'pomall.orders' };
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
    return null;
  }

  var STATUS = {
    '접수 대기': 'st-received', '생산 확정': 'st-confirmed', '생산 중': 'st-production', '출하 완료': 'st-shipped', '취소': 'st-canceled'
  };
  var STATUS_LIST = Object.keys(STATUS);

  // ----- 저장 위치 -----
  var STORAGES = {
    // 구글 시트 + Apps Script 웹 앱 (pomall-script.gs)
    sheet: function (cfg) {
      function get(params) {
        var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
        return fetch(cfg.orderUrl + '?' + qs, { cache: 'no-store' }).then(json);
      }
      // text/plain 본문이라 브라우저가 사전 확인(CORS preflight) 없이 보낸다
      function post(body) { return fetch(cfg.orderUrl, { method: 'POST', body: JSON.stringify(body) }).then(json); }
      function json(r) { return r.json().then(function (d) { if (!d.ok) throw new Error(d.error || '요청을 처리하지 못했어요.'); return d; }); }
      return {
        ready: !!cfg.orderUrl,
        submit: function (order) { return post({ action: 'order', order: order }).then(function (d) { return d.order; }); },
        lookup: function (company, phone) { return get({ action: 'mine', company: company, phone: phone }).then(function (d) { return d.orders; }); },
        list: function (key) { return get({ action: 'list', key: key }).then(function (d) { return d.orders; }); },
        setStatus: function (key, no, status) { return post({ action: 'status', key: key, no: no, status: status }); }
      };
    },
    // 이 브라우저에만 저장 (화면 확인용). 다른 사람에게는 보이지 않는다.
    local: function () {
      function all() { return store(KEY.local) || []; }
      return {
        ready: true,
        submit: function (order) {
          var o = Object.assign({}, order, { no: orderNo(), createdAt: new Date().toISOString(), status: '접수 대기' });
          var list = all(); list.unshift(o); store(KEY.local, list);
          return Promise.resolve(o);
        },
        lookup: function (company, phone) {
          return Promise.resolve(all().filter(function (o) { return o.company === company && digits(o.phone) === digits(phone); }));
        },
        list: function () { return Promise.resolve(all()); },
        setStatus: function (key, no, status) {
          var list = all(); list.forEach(function (o) { if (o.no === no) o.status = status; }); store(KEY.local, list);
          return Promise.resolve({ ok: true });
        }
      };
    }
  };

  // ----- 상태 -----
  var C = null;          // products.json
  var settings = {};
  var api = null;
  var sel = { model: null };
  var cart = store(KEY.cart) || [];
  var history = [];
  var adminOrders = [], adminFilter = 'all';

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
  function unitPrice(p, len, temp, qty) {
    var r = C.price, u = p.base + Math.max(0, (len - r.wireBaseMm) / 10) * r.wirePer10mm;
    if (temp > r.highTempOver) u *= 1 + r.highTempRate;
    var v = r.volume.filter(function (v) { return qty >= v.min; })[0];
    if (v) u *= 1 - v.off;
    return Math.round(u * 10) / 10;
  }
  function leadDays(items) { return items.some(function (i) { return i.qty >= C.lead.bigQty; }) ? C.lead.bigDays : C.lead.days; }
  function totals(items) { var net = items.reduce(function (s, i) { return s + i.unit * i.qty; }, 0); return { net: net, vat: net * C.price.vat, total: net * (1 + C.price.vat) }; }

  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }
  function say(el, text, isErr) { el.textContent = text || ''; el.classList.toggle('err', !!isErr); }
  function errText(err, fallback) { return err && err.message && !/fetch|network|json/i.test(err.message) ? err.message : fallback; }

  // ----- 사양 입력 -----
  function renderModels() {
    $('#models').innerHTML = C.products.map(function (p) {
      return '<button type="button" class="model" data-id="' + esc(p.id) + '" aria-pressed="' + (p.id === sel.model) + '"><b>' + esc(p.id) + '</b><small>' + esc(p.name) + ' · ' + p.temp[0] + '~' + p.temp[1] + '°C</small></button>';
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
    var v = validate();
    $('#spec-code').textContent = specCode(v.p.id, v.len || 0, v.temp || 0);
    if (v.errs.length) { $('#spec-meta').textContent = ''; $('#spec-err').textContent = v.errs[0]; $('#add-btn').disabled = true; return; }
    var u = unitPrice(v.p, v.len, v.temp, v.qty);
    $('#spec-meta').textContent = '단가 ' + won(u) + ' × ' + v.qty.toLocaleString() + 'EA = ' + won(u * v.qty);
    $('#spec-err').textContent = ''; $('#add-btn').disabled = false;
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

  // ----- 발주서 -----
  function saveCart() { store(KEY.cart, cart); }
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
    var v = validate(); if (v.errs.length) return;
    var code = specCode(v.p.id, v.len, v.temp), memo = $('#item-memo').value.trim();
    var ex = cart.filter(function (i) { return i.code === code && i.memo === memo; })[0];
    if (ex) { ex.qty += v.qty; ex.unit = unitPrice(v.p, v.len, v.temp, ex.qty); }
    else cart.push({ code: code, model: v.p.id, len: v.len, temp: v.temp, qty: v.qty, unit: unitPrice(v.p, v.len, v.temp, v.qty), memo: memo });
    $('#item-memo').value = '';
    saveCart(); renderCart(); $('#done').hidden = true;
    toast(code + ' ' + v.qty.toLocaleString() + 'EA 담았습니다');
  }

  // ----- 발주 확정 -----
  var CUST = ['company', 'name', 'phone', 'po', 'addr'];
  function loadCustomer() { var c = store(KEY.customer) || {}; CUST.forEach(function (f) { if (c[f]) $('#c-' + f).value = c[f]; }); }
  function submitOrder(e) {
    e.preventDefault();
    var err = $('#checkout-err');
    if (!settings.open || !api.ready) { err.textContent = '아직 발주를 받지 않아요. 정식 오픈 후에 다시 눌러 주세요.'; return; }
    var v = {}; CUST.forEach(function (f) { v[f] = $('#c-' + f).value.trim(); });
    var miss = [['company', '거래처명'], ['name', '담당자'], ['phone', '연락처'], ['addr', '납품 주소']].filter(function (x) { return !v[x[0]]; }).map(function (x) { return x[1]; });
    if (miss.length) { err.textContent = miss.join(', ') + '을(를) 입력하세요.'; return; }
    if (digits(v.phone).length < 8) { err.textContent = '연락처를 숫자 8자리 이상으로 적어 주세요.'; return; }
    if (!cart.length) return;
    store(KEY.customer, v);
    var ship = addBizDays(leadDays(cart));
    var order = {
      company: v.company, contact: v.name, phone: v.phone, customerPo: v.po, address: v.addr,
      memo: $('#c-memo').value.trim(), requestedDate: $('#c-date').value || ymd(ship), eta: ymd(ship),
      items: cart.map(function (i) { return { model: i.model, len: i.len, temp: i.temp, qty: i.qty, memo: i.memo, code: i.code, unit: i.unit }; })
    };
    var t = totals(cart); order.net = t.net; order.vat = t.vat; order.total = t.total;
    $('#submit-btn').disabled = true; err.textContent = '발주를 보내는 중이에요…';
    api.submit(order).then(function (saved) {
      err.textContent = '';
      rememberSpecs(cart);
      cart = []; saveCart(); renderCart();
      $('#checkout').hidden = true; $('#done').hidden = false;
      $('#done-no').textContent = saved.no;
      $('#done-text').textContent = v.company + ' 발주가 접수되었습니다. 회사에서 생산을 확정하면 주문 조회의 상태가 바뀝니다. 합계 ' + won(saved.total || t.total) + ', 희망 출하일 ' + order.requestedDate + '.';
      $('#l-company').value = v.company; $('#l-phone').value = v.phone;
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
  function lookup(e) {
    if (e) e.preventDefault();
    var company = $('#l-company').value.trim(), phone = $('#l-phone').value.trim(), msg = $('#lookup-msg');
    if (!company || !phone) { say(msg, '거래처명과 연락처를 적어 주세요.', true); return; }
    if (!api.ready) { say(msg, '아직 주문 조회를 열지 않았어요.', true); return; }
    say(msg, '조회하는 중이에요…');
    api.lookup(company, phone).then(function (list) {
      history = list || [];
      $('#history-wrap').hidden = !history.length;
      say(msg, history.length ? '' : '이 거래처명과 연락처로 접수된 발주가 없어요.', !history.length);
      $('#history-body').innerHTML = history.map(function (o) {
        return '<tr><td class="mono">' + esc(o.no) + (o.customerPo ? '<div class="order-items">귀사 PO ' + esc(o.customerPo) + '</div>' : '') + '</td>' +
          '<td class="mono">' + esc(String(o.createdAt).slice(0, 10)) + '</td><td>' + itemsHtml(o) + '</td>' +
          '<td class="mono">' + won(o.total) + '</td><td class="mono">' + esc(o.requestedDate) + '</td><td>' + pill(o.status) + '</td>' +
          '<td><button type="button" class="btn ghost small" data-reorder="' + esc(o.no) + '">재주문</button></td></tr>';
      }).join('');
    }).catch(function (err) { say(msg, errText(err, '조회하지 못했어요. 잠시 후 다시 눌러 주세요.'), true); });
  }
  function reorder(no) {
    var o = history.filter(function (x) { return x.no === no; })[0]; if (!o) return;
    var n = 0;
    o.items.forEach(function (i) { var p = product(i.model); if (!p) return; n++; cart.push({ code: i.code, model: i.model, len: +i.len, temp: +i.temp, qty: +i.qty, memo: i.memo || '', unit: unitPrice(p, +i.len, +i.temp, +i.qty) }); });
    saveCart(); renderCart(); show('order'); $('#done').hidden = true;
    toast(o.no + '의 품목 ' + n + '개를 현재 단가로 담았습니다');
  }

  // ----- 접수 관리 -----
  function adminLoad() {
    var key = store(KEY.admin), msg = $('#admin-msg');
    $('#key-form').hidden = !!key; $('#admin-wrap').hidden = !key;
    if (!key) return;
    if (!api.ready) { say(msg, '주문 받을 주소(orderUrl)가 아직 없어요. README의 순서대로 구글 시트를 연결해 주세요.', true); return; }
    say(msg, '발주를 불러오는 중이에요…');
    api.list(key).then(function (list) { adminOrders = list || []; say(msg, ''); renderAdmin(); })
      .catch(function (err) {
        store(KEY.admin, null); $('#key-form').hidden = false; $('#admin-wrap').hidden = true;
        say(msg, errText(err, '발주를 불러오지 못했어요.'), true);
      });
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
        '<td><b>' + esc(o.company) + '</b><div class="order-items">' + esc(o.contact) + ' · ' + esc(o.phone) + '</div><div class="order-items">' + esc(o.address) + '</div>' + (o.memo ? '<div class="order-items">요청: ' + esc(o.memo) + '</div>' : '') + '</td>' +
        '<td>' + itemsHtml(o) + '</td><td class="mono">' + won(o.total) + '</td>' +
        '<td class="mono">' + esc(o.requestedDate) + '<div class="order-items">최단 ' + esc(o.eta) + '</div></td>' +
        '<td><select data-status="' + esc(o.no) + '" aria-label="' + esc(o.no) + ' 상태">' + STATUS_LIST.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td></tr>';
    }).join('');
    $('#admin-empty').hidden = list.length > 0;
  }
  function changeStatus(no, status, selectEl) {
    selectEl.disabled = true;
    api.setStatus(store(KEY.admin), no, status).then(function () {
      adminOrders.forEach(function (o) { if (o.no === no) o.status = status; });
      renderAdmin(); toast(no + ' → ' + status);
    }).catch(function (err) { toast(errText(err, '상태를 바꾸지 못했어요.')); renderAdmin(); });
  }

  // ----- 탭 -----
  function show(view) {
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.view === view); });
    ['order', 'history', 'admin'].forEach(function (v) { $('#view-' + v).hidden = v !== view; });
    if (view === 'admin') { $('#tab-admin').hidden = false; adminLoad(); }
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
  });
  ['len', 'temp', 'qty'].forEach(function (id) { $('#' + id).addEventListener('input', function () { if (C) renderSpec(); }); });
  $('#add-btn').addEventListener('click', addToCart);
  $('#cart').addEventListener('change', function (e) {
    var k = e.target.dataset.k; if (k === undefined) return;
    var i = cart[+k], p = product(i.model);
    i.qty = Math.max(C.qty.min, Math.round((+e.target.value || 0) / C.qty.step) * C.qty.step);
    i.unit = unitPrice(p, i.len, i.temp, i.qty); saveCart(); renderCart();
  });
  $('#go-checkout').addEventListener('click', function () { $('#checkout').hidden = false; loadCustomer(); $('#checkout').scrollIntoView({ behavior: 'smooth' }); });
  $('#cancel-checkout').addEventListener('click', function () { $('#checkout').hidden = true; });
  $('#checkout-form').addEventListener('submit', submitOrder);
  $('#done-history').addEventListener('click', function () { show('history'); lookup(); });
  $('#lookup-form').addEventListener('submit', lookup);
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
    if (store(KEY.admin)) $('#tab-admin').hidden = false;
    var first = C.products[0];
    setSpec(first.id, 70, 100, 1000);
    renderCart(); renderRecent(); loadCustomer();
    var c = store(KEY.customer); if (c) { $('#l-company').value = c.company || ''; $('#l-phone').value = c.phone || ''; }
  }).catch(function () {
    $('#models').innerHTML = '<p class="msg err">제품 목록을 불러오지 못했어요. 새로고침해 주세요.</p>';
  });
})();
