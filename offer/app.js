// 어떻게든 팔거야: 상품 목록, 가격 제안, 내 제안 확인, 판매자(받은 제안 수락/거절, 상품 관리)
(function () {
  var MINE_KEY = 'offer-shop-mine';
  var ADMIN_KEY = 'offer-shop-admin-key';
  var TOKEN_KEY = 'anything-shop-gh-token';   // 무엇이든 상점과 같은 GitHub 열쇠를 같이 쓴다
  var won = function (n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; };
  var $ = function (s) { return document.querySelector(s); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }

  var products = {};     // id -> {name, seller, cat, desc, unit, order, closed}
  var order = [];        // 화면에 보일 순서대로 id
  var bids = {};         // id -> {count, top, accepted} (구글 시트에서 받은 요약)
  var loaded = false;
  var currentCat = 'all';

  // ---------- 설정과 제안 서버 ----------
  // 제안은 판매자의 구글 시트로 보낸다(settings.json의 offerUrl). 결제는 수락 뒤 계좌 입금.
  var settings = { offerUrl: '', bank: {} };
  function isOpen() { return settings.open !== false && !!settings.offerUrl; }

  function apiGet(params) {
    var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(settings.offerUrl + '?' + qs, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  // text/plain으로 보내야 구글 스크립트가 바로 받는다
  function apiPost(body) {
    return fetch(settings.offerUrl, { method: 'POST', body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  function loadBids() {
    if (!settings.offerUrl) return;
    apiGet({ action: 'summary' }).then(function (res) {
      if (res && res.ok) { bids = res.items || {}; renderProducts(); if (detailId) renderDetail(); }
    }).catch(function () {});
  }

  fetch('settings.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (j) settings = j;
      // settings.json의 open이 false면 "오픈 준비 중" 안내를 띄우고 제안을 받지 않는다
      $('#notice').hidden = settings.open !== false;
      loadBids();
      renderMine();
    }).catch(function () {});

  // ---------- 상품 목록 ----------
  var grid = $('#grid'), status = $('#status'), tpl = $('#product-tpl');

  function setProducts(list) {
    products = {}; order = [];
    list.forEach(function (d) {
      if (!d || !d.id || typeof d.name !== 'string' || !d.name) return;
      products[d.id] = {
        name: d.name, seller: String(d.seller || ''), cat: String(d.cat || '기타'), desc: String(d.desc || ''),
        unit: String(d.unit || ''), order: Number(d.order) || 0, closed: !!d.closed
      };
      order.push(d.id);
    });
    order.sort(function (a, b) { return products[a].order - products[b].order; });
    loaded = true;
    if (editingId && !products[editingId]) resetForm();
    renderProducts();
  }

  function bidText(id) {
    var b = bids[id], p = products[id];
    if (p && p.closed) return b && b.accepted ? '제안 마감 · 거래 ' + b.accepted + '건' : '제안 마감';
    if (!b || !b.count) return '첫 제안을 기다려요';
    return '제안 ' + b.count + '건 · 최고 ' + won(b.top);
  }

  function renderProducts() {
    grid.innerHTML = '';
    order.forEach(function (id) {
      var p = products[id];
      var li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = id;
      li.classList.toggle('closed', p.closed);
      li.querySelector('.kind').textContent = p.cat;
      li.querySelector('.detail-link').textContent = p.name;
      var sel = li.querySelector('.seller');
      sel.textContent = p.seller ? '판매자 ' + p.seller : '';
      sel.hidden = !p.seller;
      li.querySelector('.desc').textContent = p.desc || '';
      li.querySelector('.unit').textContent = p.unit || '';
      li.querySelector('.bids').textContent = bidText(id);
      var add = li.querySelector('.add');
      add.dataset.offer = id;
      if (p.closed) { add.textContent = '마감'; add.disabled = true; }
      li.hidden = currentCat !== 'all' && p.cat !== currentCat;
      grid.appendChild(li);
    });
    if (loaded) status.textContent = order.length ? '' : '아직 등록된 상품이 없어요.';
    renderCats();
    renderAdminList();
  }

  function renderCats() {
    var box = $('#cats'), cats = [], sellers = [];
    order.forEach(function (id) {
      var c = products[id].cat, s = products[id].seller;
      if (c && cats.indexOf(c) < 0) cats.push(c);
      if (s && sellers.indexOf(s) < 0) sellers.push(s);
    });
    if (currentCat !== 'all' && cats.indexOf(currentCat) < 0) currentCat = 'all';
    box.innerHTML = '';
    ['all'].concat(cats).forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.cat = c;
      b.textContent = c === 'all' ? '전체' : c;
      b.setAttribute('aria-pressed', String(c === currentCat));
      box.appendChild(b);
    });
    fillList($('#cat-list'), cats);
    fillList($('#seller-list'), sellers);
  }
  function fillList(dl, values) {
    dl.innerHTML = '';
    values.forEach(function (v) { var o = document.createElement('option'); o.value = v; dl.appendChild(o); });
  }

  $('#cats').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cat]');
    if (!b) return;
    currentCat = b.dataset.cat;
    renderProducts();
  });

  // ---------- 패널 열고 닫기 ----------
  var shade = $('#shade'), opener = null;
  function openPanel(panel, from) {
    closePanels();
    opener = from || null;
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); shade.hidden = false;
    var first = panel.querySelector('input:not([type=checkbox]), [data-close]'); if (first) first.focus();
  }
  function closePanels() {
    document.querySelectorAll('.panel.open').forEach(function (p) { p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); });
    shade.hidden = true;
    detailId = null;
    if (opener) { opener.focus(); opener = null; }
  }
  shade.addEventListener('click', closePanels);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !shade.hidden) closePanels(); });
  document.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closePanels(); });

  // ---------- 상품 자세히 보기 + 가격 제안 ----------
  var detailId = null, offerForm = $('#offer-form'), oMsg = $('#o-msg');
  function oSay(t, isErr) { oMsg.textContent = t; oMsg.classList.toggle('err', !!isErr); }

  function offerNumbers() {
    var price = Math.floor(Number(offerForm.oprice.value) || 0);
    var qty = Math.max(1, Math.min(99, Math.floor(Number(offerForm.oqty.value) || 1)));
    return { price: price, qty: qty };
  }
  function renderTotal() {
    var n = offerNumbers();
    $('#o-total').textContent = won(n.price * n.qty);
  }
  offerForm.oprice.addEventListener('input', renderTotal);
  offerForm.oqty.addEventListener('input', renderTotal);

  function renderDetail() {
    var p = products[detailId]; if (!p) return;
    $('#d-kind').textContent = p.cat;
    $('#d-name').textContent = p.name;
    $('#d-seller').textContent = p.seller ? '판매자 ' + p.seller : '';
    $('#d-seller').hidden = !p.seller;
    $('#d-desc').textContent = p.desc || '';
    $('#d-unit').textContent = p.unit || '-';
    $('#d-bids').textContent = bidText(detailId);
    $('#d-closed').hidden = !p.closed;
    $('#o-submit').disabled = p.closed || !isOpen();
  }
  function openDetail(id, from) {
    if (!products[id]) return;
    openPanel($('#detail'), from);
    detailId = id;
    offerForm.oprice.value = ''; offerForm.oqty.value = 1; renderTotal();
    $('#offer-step').hidden = false;
    $('#receipt').hidden = true;
    renderDetail();
    if (!isOpen()) oSay('지금은 오픈 준비 중이라 제안을 받지 않아요. 정식 오픈 후에 제안해 주세요.', true);
    else oSay('');
    if (!products[id].closed) offerForm.oprice.focus();
  }
  grid.addEventListener('click', function (e) {
    var card = e.target.closest('.product');
    if (card) openDetail(card.dataset.id, card.querySelector('.detail-link'));
  });

  offerForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var p = products[detailId];
    if (!p || p.closed || !isOpen()) return;
    var f = offerForm, n = offerNumbers();
    var data = {
      id: detailId, price: n.price, qty: n.qty,
      name: f.oname.value.trim(), phone: f.ophone.value.trim(), place: f.oplace.value.trim(), memo: f.omemo.value.trim()
    };
    if (!(n.price >= 100)) { oSay('한 개당 가격을 100원 이상으로 적어 주세요.', true); f.oprice.focus(); return; }
    if (n.price > 100000000) { oSay('제안 가격은 1억 원까지 적을 수 있어요.', true); f.oprice.focus(); return; }
    if (!data.name) { oSay('제안하는 분 이름을 적어 주세요.', true); f.oname.focus(); return; }
    if (!/^[0-9+\-\s()]{8,20}$/.test(data.phone)) { oSay('연락처를 숫자로 적어 주세요. 예: 010-1234-5678', true); f.ophone.focus(); return; }

    var btn = $('#o-submit'); btn.disabled = true;
    oSay('제안을 보내는 중이에요…');
    var pid = detailId;
    apiPost(data).then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.error || '제안을 보내지 못했어요.');
      $('#r-no').textContent = res.no;
      $('#r-product').textContent = p.name;
      $('#r-total').textContent = won(res.price) + ' × ' + res.qty + ' = ' + won(res.total);
      $('#offer-step').hidden = true;
      $('#receipt').hidden = false;
      remember({ no: res.no, phone: data.phone, product: p.name, pid: pid, price: res.price, qty: res.qty, total: res.total, status: '검토 중' });
      f.reset(); oSay('');
      loadBids();
    }).catch(function (err) {
      oSay(err && err.message && !/fetch|network/i.test(err.message) ? err.message : '제안을 보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', true);
    }).then(function () { btn.disabled = false; });
  });

  // ---------- 내 제안 (보낸 기기에 제안번호와 연락처를 기억) ----------
  var mine = [];
  try { mine = JSON.parse(store(MINE_KEY) || '[]') || []; } catch (e) { mine = []; }
  function saveMine() { store(MINE_KEY, JSON.stringify(mine.slice(0, 50))); $('#mine-count').textContent = mine.length; }
  function remember(o) {
    mine = mine.filter(function (m) { return m.no !== o.no; });
    mine.unshift(o);
    saveMine(); renderMine();
  }
  $('#mine-count').textContent = mine.length;

  var STATUS_NOTE = {
    '검토 중': '판매자가 제안을 살펴보고 있어요.',
    '수락': '판매자가 제안을 수락했어요. 아래 계좌로 입금해 주세요.',
    '거절': '판매자가 이번 제안은 거절했어요. 다른 가격으로 다시 제안할 수 있어요.',
    '취소': '제안을 취소했어요.'
  };
  function statusClass(s) { return { '수락': 'yes', '거절': 'no', '취소': 'off' }[s] || 'wait'; }

  function renderMine() {
    var box = $('#mine-list');
    box.innerHTML = '';
    $('#mine-empty').hidden = mine.length > 0;
    mine.forEach(function (m) {
      var li = document.createElement('li');
      li.className = 'offer-card';
      li.dataset.no = m.no;
      li.innerHTML = '<div class="oc-top"><span class="oc-name"></span><span class="badge"></span></div>' +
        '<span class="oc-meta"></span><p class="oc-note"></p><p class="oc-bank" hidden></p>' +
        '<div class="oc-actions"><button type="button" class="link" data-cancel hidden>제안 취소</button><button type="button" class="link" data-forget>목록에서 지우기</button></div>';
      li.querySelector('.oc-name').textContent = m.product;
      var badge = li.querySelector('.badge');
      badge.textContent = m.status || '확인 중';
      badge.className = 'badge ' + statusClass(m.status);
      li.querySelector('.oc-meta').textContent = '제안번호 ' + m.no + ' · ' + won(m.price) + ' × ' + m.qty + ' = ' + won(m.total);
      li.querySelector('.oc-note').textContent = STATUS_NOTE[m.status] || '';
      if (m.status === '수락') {
        var b = settings.bank || {}, bank = li.querySelector('.oc-bank');
        bank.hidden = false;
        bank.textContent = b.account ? '입금 계좌 ' + b.name + ' ' + b.account + ' (' + b.holder + ') · ' + won(m.total) : '판매자가 연락드려 계좌를 알려 드려요.';
      }
      li.querySelector('[data-cancel]').hidden = m.status !== '검토 중';
      box.appendChild(li);
    });
  }

  function refreshMine() {
    if (!settings.offerUrl) return;
    mine.forEach(function (m) {
      apiGet({ action: 'mine', no: m.no, phone: m.phone }).then(function (res) {
        if (!res || !res.ok) return;
        Object.assign(m, res.offer);
        saveMine(); renderMine();
      }).catch(function () {});
    });
  }

  $('#open-mine').addEventListener('click', function () { renderMine(); openPanel($('#mine'), this); refreshMine(); });

  $('#mine-list').addEventListener('click', function (e) {
    var li = e.target.closest('.offer-card'); if (!li) return;
    var m = mine.filter(function (x) { return x.no === li.dataset.no; })[0]; if (!m) return;
    if (e.target.closest('[data-forget]')) { mine = mine.filter(function (x) { return x !== m; }); saveMine(); renderMine(); return; }
    var c = e.target.closest('[data-cancel]');
    if (c) {
      if (!c.classList.contains('confirm')) { c.classList.add('confirm'); c.textContent = '정말 취소'; return; }
      c.disabled = true;
      apiPost({ action: 'cancel', no: m.no, phone: m.phone }).then(function (res) {
        if (!res || !res.ok) throw new Error(res && res.error);
        m.status = res.status; saveMine(); renderMine(); loadBids();
      }).catch(function (err) {
        c.disabled = false;
        li.querySelector('.oc-note').textContent = (err && err.message) || '취소하지 못했어요. 다시 눌러 주세요.';
      });
    }
  });

  $('#lookup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, no = f.lno.value.trim(), phone = f.lphone.value.trim(), msg = $('#l-msg');
    msg.classList.remove('err');
    if (!no || !phone) { msg.textContent = '제안번호와 연락처를 모두 적어 주세요.'; msg.classList.add('err'); return; }
    if (!settings.offerUrl) { msg.textContent = '아직 제안을 받지 않고 있어요.'; msg.classList.add('err'); return; }
    msg.textContent = '찾는 중이에요…';
    apiGet({ action: 'mine', no: no, phone: phone }).then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.error);
      var o = res.offer;
      remember({ no: o.no, phone: phone, product: o.product, price: o.price, qty: o.qty, total: o.total, status: o.status });
      f.reset(); msg.textContent = '';
    }).catch(function (err) {
      msg.textContent = (err && err.message) || '찾지 못했어요.'; msg.classList.add('err');
    });
  });

  // ---------- 판매자 화면 ----------
  function showTab(name) {
    ['offers', 'products'].forEach(function (t) {
      $('#tab-' + t).setAttribute('aria-selected', String(t === name));
      $('#pane-' + t).hidden = t !== name;
    });
    if (name === 'offers') startOffers(); else startProducts();
  }
  $('#tab-offers').addEventListener('click', function () { showTab('offers'); });
  $('#tab-products').addEventListener('click', function () { showTab('products'); });
  function openAdmin(from) { openPanel($('#admin'), from); showTab($('#tab-products').getAttribute('aria-selected') === 'true' ? 'products' : 'offers'); }
  $('#admin-entry').addEventListener('click', function () { openAdmin(this); });
  $('#open-admin').addEventListener('click', function () { openAdmin(this); });
  if (store(ADMIN_KEY) || store(TOKEN_KEY)) $('#open-admin').hidden = false;

  // ----- 받은 제안: 판매자 열쇠(ADMIN_KEY)로 구글 시트의 제안을 읽고 수락/거절한다 -----
  var offers = [], offerFilter = '검토 중';
  function keySay(t, isErr) { var m = $('#key-msg'); m.textContent = t; m.classList.toggle('err', !!isErr); }

  function startOffers() {
    if (!settings.offerUrl) {
      $('#key-login').hidden = true; $('#offers-wrap').hidden = true;
      keySay('아직 제안 받을 주소(offerUrl)가 없어요. README의 순서대로 구글 시트를 연결해 주세요.', true);
      return;
    }
    if (!store(ADMIN_KEY)) { $('#key-login').hidden = false; $('#offers-wrap').hidden = true; keySay(''); return; }
    keySay('받은 제안을 불러오는 중이에요…');
    apiGet({ action: 'list', key: store(ADMIN_KEY) }).then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.error);
      offers = res.offers || [];
      $('#key-login').hidden = true; $('#offers-wrap').hidden = false; $('#open-admin').hidden = false;
      keySay('');
      renderOffers();
    }).catch(function (err) {
      $('#key-login').hidden = false; $('#offers-wrap').hidden = true;
      keySay((err && err.message) || '제안을 불러오지 못했어요.', true);
    });
  }
  $('#key-save').addEventListener('click', function () {
    var k = $('#admin-key').value.trim();
    if (!k) { keySay('판매자 열쇠를 적어 주세요.', true); return; }
    store(ADMIN_KEY, k); $('#admin-key').value = '';
    startOffers();
  });
  $('#key-logout').addEventListener('click', function () { store(ADMIN_KEY, null); startOffers(); keySay('로그아웃했어요.'); });

  $('#offer-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]'); if (!b) return;
    offerFilter = b.dataset.f;
    document.querySelectorAll('#offer-filter button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderOffers();
  });

  // 상품별로 묶고, 한 상품 안에서는 높은 단가부터 보여 준다
  function renderOffers() {
    var box = $('#offer-groups'), groups = {}, keys = [];
    box.innerHTML = '';
    offers.forEach(function (o) {
      if (offerFilter !== 'all' && o.status !== offerFilter) return;
      if (!groups[o.pid]) { groups[o.pid] = []; keys.push(o.pid); }
      groups[o.pid].push(o);
    });
    if (!keys.length) {
      var p = document.createElement('p'); p.className = 'empty';
      p.textContent = offerFilter === '검토 중' ? '답을 기다리는 제안이 없어요.' : '해당하는 제안이 없어요.';
      box.appendChild(p); return;
    }
    keys.forEach(function (pid) {
      var list = groups[pid].sort(function (a, b) { return b.price - a.price; });
      var sec = document.createElement('section'); sec.className = 'offer-group';
      var h = document.createElement('h3');
      h.textContent = (products[pid] ? products[pid].name : list[0].product) + ' · ' + list.length + '건';
      sec.appendChild(h);
      var ul = document.createElement('ul'); ul.className = 'offers';
      list.forEach(function (o) {
        var li = document.createElement('li');
        li.className = 'offer-card';
        li.dataset.no = o.no;
        li.innerHTML = '<div class="oc-top"><span class="oc-price"></span><span class="badge"></span></div>' +
          '<span class="oc-meta"></span><span class="oc-who"></span><p class="oc-note"></p>' +
          '<div class="oc-actions"></div>';
        li.querySelector('.oc-price').textContent = won(o.price) + (o.qty > 1 ? ' × ' + o.qty + ' = ' + won(o.total) : '');
        var badge = li.querySelector('.badge'); badge.textContent = o.status; badge.className = 'badge ' + statusClass(o.status);
        li.querySelector('.oc-meta').textContent = '제안번호 ' + o.no + ' · ' + when(o.at);
        li.querySelector('.oc-who').textContent = o.name + ' · ' + o.phone + (o.place ? ' · ' + o.place : '');
        li.querySelector('.oc-note').textContent = o.memo ? '“' + o.memo + '”' : '';
        var act = li.querySelector('.oc-actions');
        if (o.status === '검토 중') {
          act.innerHTML = '<button type="button" class="yes" data-decide="수락">팔기</button><button type="button" data-decide="거절">안 팔기</button>';
        } else if (o.status !== '취소') {
          act.innerHTML = '<button type="button" class="link" data-decide="검토 중">결정 되돌리기</button>';
        }
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
  }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  $('#offer-groups').addEventListener('click', function (e) {
    var b = e.target.closest('[data-decide]'); if (!b) return;
    var li = b.closest('.offer-card'), no = li.dataset.no;
    li.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
    apiPost({ action: 'decide', key: store(ADMIN_KEY), no: no, status: b.dataset.decide }).then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.error);
      offers.forEach(function (o) { if (o.no === no) o.status = res.status; });
      renderOffers();
      loadBids();
      keySay(res.status === '수락' ? '팔기로 했어요. 손님은 내 제안에서 입금 계좌를 볼 수 있어요. 연락처로도 알려 주세요.' : '');
    }).catch(function (err) {
      li.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
      keySay((err && err.message) || '저장하지 못했어요. 다시 눌러 주세요.', true);
    });
  });

  // ----- 상품 관리: 저장소의 offer/products.json을 GitHub 열쇠로 직접 고친다 -----
  // 열쇠는 관리자 브라우저에만 저장되고 GitHub 말고는 다른 곳으로 보내지 않는다.
  var GH = { owner: 'ljh0283ljh0283ljh0283-blip', repo: 'anything-shop', path: 'offer/products.json', branch: 'main' };
  var ghSha = null, form = $('#product-form'), msg = $('#form-msg'), editingId = null, adminList = $('#admin-list');
  function say(text, isErr) { msg.textContent = text; msg.classList.toggle('err', !!isErr); }

  function ghApi(method, body) {
    var url = 'https://api.github.com/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path +
      (method === 'GET' ? '?ref=' + GH.branch + '&t=' + Date.now() : '');
    return fetch(url, {
      method: method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + store(TOKEN_KEY), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.message || 'GitHub error'); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function ghLoad() {
    return ghApi('GET').then(function (j) {
      ghSha = j.sha;
      var text = decodeURIComponent(escape(atob(String(j.content).replace(/\n/g, ''))));
      return JSON.parse(text).products || [];
    });
  }
  // 저장할 때마다 최신 파일을 다시 읽고 고친 뒤 올린다
  function ghChange(fn, message) {
    return ghLoad().then(function (list) {
      list = fn(list);
      var text = JSON.stringify({ products: list }, null, 1) + '\n';
      return ghApi('PUT', { message: message, content: btoa(unescape(encodeURIComponent(text))), sha: ghSha, branch: GH.branch })
        .then(function (j) { ghSha = j.content && j.content.sha; setProducts(list); });
    });
  }
  function writeError(err) {
    if (err && err.status === 401) return 'GitHub 열쇠(토큰)가 맞지 않아요. 다시 로그인해 주세요.';
    if (err && (err.status === 403 || err.status === 404)) return '이 열쇠(토큰)로는 저장소에 쓸 수 없어요. anything-shop 저장소의 Contents 쓰기 권한을 확인해 주세요.';
    if (err && err.status === 409) return '다른 곳에서 먼저 저장했어요. 다시 한 번 눌러 주세요.';
    return '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
  }

  function showLoggedIn(on) {
    $('#gh-login').hidden = on;
    form.hidden = !on;
    $('#admin-list-wrap').hidden = !on;
    if (on) $('#open-admin').hidden = false;
  }
  function startProducts() {
    var m = $('#gh-msg');
    if (!store(TOKEN_KEY)) { showLoggedIn(false); return; }
    m.textContent = '확인하는 중이에요…'; m.classList.remove('err');
    ghLoad().then(function (list) { setProducts(list); m.textContent = ''; showLoggedIn(true); })
      .catch(function (err) { showLoggedIn(false); m.textContent = writeError(err); m.classList.add('err'); });
  }
  $('#gh-save').addEventListener('click', function () {
    var t = $('#gh-token').value.trim(), m = $('#gh-msg');
    if (!t) { m.textContent = '열쇠(토큰)를 붙여 넣어 주세요.'; m.classList.add('err'); return; }
    store(TOKEN_KEY, t); $('#gh-token').value = '';
    startProducts();
  });
  $('#gh-logout').addEventListener('click', function () {
    store(TOKEN_KEY, null); showLoggedIn(false);
    $('#gh-msg').textContent = '로그아웃했어요.'; $('#gh-msg').classList.remove('err');
  });

  function startEdit(id) {
    var p = products[id]; if (!p) return;
    editingId = id;
    form.name.value = p.name; form.seller.value = p.seller; form.cat.value = p.cat;
    form.unit.value = p.unit; form.desc.value = p.desc; form.closed.checked = p.closed;
    $('#form-title').textContent = '상품 수정';
    $('#f-save').textContent = '수정 저장';
    $('#f-cancel').hidden = false;
    say('');
    renderAdminList();
    $('#admin .panel-body').scrollTop = 0;
    form.name.focus();
  }
  function resetForm() {
    editingId = null;
    form.reset();
    $('#form-title').textContent = '새 상품 등록';
    $('#f-save').textContent = '등록하기';
    $('#f-cancel').hidden = true;
    renderAdminList();
  }
  $('#f-cancel').addEventListener('click', function () { resetForm(); say(''); });

  // 판매자는 가격을 적지 않는다. 이름, 분류, 설명만 올린다.
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {
      name: form.name.value.trim(), seller: form.seller.value.trim(), cat: form.cat.value.trim(),
      desc: form.desc.value.trim(), unit: form.unit.value.trim()
    };
    if (form.closed.checked) data.closed = true;
    if (!data.name) { say('상품 이름을 적어 주세요.', true); form.name.focus(); return; }
    if (!data.cat) { say('분류를 적어 주세요.', true); form.cat.focus(); return; }

    var saveBtn = $('#f-save'); saveBtn.disabled = true;
    var id = editingId;
    var job = ghChange(function (list) {
      if (id) return list.map(function (p) { return p.id === id ? Object.assign({ id: id, order: p.order }, data) : p; });
      var max = 0; list.forEach(function (p) { max = Math.max(max, Number(p.order) || 0); });
      return list.concat([Object.assign({ id: 'p' + Date.now().toString(36), order: max + 10 }, data)]);
    }, (id ? '제안 상품 수정: ' : '제안 상품 등록: ') + data.name);
    job.then(function () {
      resetForm();
      say((id ? '"' + data.name + '" 수정을 저장했어요.' : '"' + data.name + '"을(를) 등록했어요.') + ' 사이트에는 1~2분 뒤에 반영돼요.');
    }).catch(function (err) { say(writeError(err), true); })
      .then(function () { saveBtn.disabled = false; });
  });

  function renderAdminList() {
    $('#admin-count').textContent = order.length;
    adminList.innerHTML = '';
    order.forEach(function (id) {
      var p = products[id], b = bids[id];
      var li = document.createElement('li');
      li.dataset.id = id;
      if (id === editingId) li.className = 'editing';
      li.innerHTML = '<span class="a-name"></span><span class="a-actions"><button type="button" data-edit>수정</button><button type="button" class="del" data-del>삭제</button></span><span class="a-meta"></span>';
      li.querySelector('.a-name').textContent = p.name + (p.closed ? ' (마감)' : '');
      li.querySelector('.a-meta').textContent = (p.seller ? p.seller + ' · ' : '') + p.cat + (p.unit ? ' · ' + p.unit : '') +
        (b && b.count ? ' · 제안 ' + b.count + '건, 최고 ' + won(b.top) : '');
      adminList.appendChild(li);
    });
  }

  adminList.addEventListener('click', function (e) {
    var li = e.target.closest('li'); if (!li) return;
    var id = li.dataset.id;
    if (e.target.closest('[data-edit]')) { startEdit(id); return; }
    var del = e.target.closest('[data-del]');
    if (!del) return;
    // 한 번 더 눌러야 지워진다
    if (!del.classList.contains('confirm')) {
      del.classList.add('confirm'); del.textContent = '정말 삭제';
      setTimeout(function () { if (del.isConnected) { del.classList.remove('confirm'); del.textContent = '삭제'; } }, 3000);
      return;
    }
    var name = products[id] ? products[id].name : id;
    del.disabled = true;
    ghChange(function (list) { return list.filter(function (p) { return p.id !== id; }); }, '제안 상품 삭제: ' + name)
      .then(function () { if (editingId === id) resetForm(); say('"' + name + '"을(를) 삭제했어요. 사이트에는 1~2분 뒤에 반영돼요.'); })
      .catch(function (err) { del.disabled = false; say(writeError(err), true); });
  });

  // ---------- 시작 ----------
  fetch('products.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (j) { setProducts(j.products || []); })
    .catch(function () { status.textContent = '상품 목록을 불러오지 못했어요.'; });
})();
