// 어떻게든 팔거야: 상품 목록, 가격 제안, 내 제안 확인, 판매자 코너(받은 제안, 내 상품, 올린 상품, 판매 기록),
// 관리자(받은 제안 전체, 샘플·운영 상품 관리, 판매자별 판매 기록)
(function () {
  var MINE_KEY = 'offer-shop-mine';
  var ADMIN_KEY = 'offer-shop-admin-key';
  var TOKEN_KEY = 'anything-shop-gh-token';   // 무엇이든 상점과 같은 GitHub 열쇠를 같이 쓴다
  var SELLER_KEY = 'anything-shop-seller-key'; // 무엇이든 상점과 같은 판매자 로그인을 같이 쓴다
  var won = function (n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; };
  var $ = function (s) { return document.querySelector(s); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }

  var products = {};     // id -> {name, seller, cat, desc, unit, order, closed}
  var order = [];        // 화면에 보일 순서대로 id
  var bids = {};         // id -> {count, top, accepted} (구글 시트에서 받은 요약)
  var loaded = false;
  var baseList = [], sheetList = [];   // products.json(샘플·운영 상품) + 시트의 판매자 상품
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
      if (res && res.ok) {
      bids = res.items || {};
      if (Array.isArray(res.products)) { sheetList = res.products.map(function (p) { return Object.assign({}, p, { fromSheet: true }); }); setProducts(); }
      else renderProducts();
      if (detailId) renderDetail();
    }
    }).catch(function () {});
  }

  fetch('settings.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (j) settings = j;
      // settings.json의 open이 false면 제안을 받지 않는다
      loadBids();
      renderMine();
    }).catch(function () {});

  // ---------- 상품 목록 ----------
  var grid = $('#grid'), status = $('#status'), tpl = $('#product-tpl');

  function setBase(list) { baseList = list; setProducts(); }
  function setProducts() {
    products = {}; order = [];
    baseList.concat(sheetList).forEach(function (d) {
      if (!d || !d.id || typeof d.name !== 'string' || !d.name) return;
      products[d.id] = {
        name: d.name, seller: String(d.seller || ''), cat: String(d.cat || '기타'), desc: String(d.desc || ''),
        unit: String(d.unit || ''), order: Number(d.order) || 0, closed: !!d.closed, sample: d.sample === true, fromSheet: !!d.fromSheet
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
    if (p && p.sample) return '샘플 상품';
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
      li.querySelector('.kind').textContent = p.sample ? '샘플 · ' + p.cat : p.cat;
      li.classList.toggle('is-sample', p.sample);
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
      if (p.sample) { add.textContent = '샘플'; add.disabled = true; }
      li.hidden = !inView(p);
      grid.appendChild(li);
    });
    renderCats();
    // "전체"에는 진짜 상품과 판매자 등록 신청서, "샘플"에는 샘플 상품만 보인다
    if (loaded) status.textContent = order.some(function (id) { return inView(products[id]); }) ? '' : '아직 올라온 상품이 없어요. 샘플 칸에서 어떤 상품을 팔 수 있는지 구경해 보세요.';
    $('#sample-note').hidden = currentCat !== 'sample';

    renderAdminList();
  }

  function inView(p) {
    if (currentCat === 'sample') return p.sample;
    return !p.sample && (currentCat === 'all' || p.cat === currentCat);
  }
  // 분류 버튼은 진짜 상품의 분류만 만든다(샘플은 "샘플" 버튼 하나로 모은다)
  function renderCats() {
    var box = $('#cats'), cats = [], sellers = [], samples = false;
    order.forEach(function (id) {
      var c = products[id].cat, s = products[id].seller;
      if (products[id].sample) samples = true;
      else if (c && cats.indexOf(c) < 0) cats.push(c);
      if (s && sellers.indexOf(s) < 0) sellers.push(s);
    });
    var heads = samples ? ['sample', 'all'] : ['all'];
    if (heads.concat(cats).indexOf(currentCat) < 0) currentCat = 'all';
    box.innerHTML = '';
    heads.concat(cats).forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.cat = c;
      b.textContent = c === 'all' ? '전체' : c === 'sample' ? '샘플' : c;
      if (c === 'sample') b.className = 'cat-sample';
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
    $('#d-closed').hidden = !p.closed || p.sample;
    $('#d-sample').hidden = !p.sample;
    $('#o-submit').disabled = p.closed || p.sample || !isOpen();
  }
  function openDetail(id, from) {
    if (!products[id]) return;
    openPanel($('#detail'), from);
    detailId = id;
    offerForm.oprice.value = ''; offerForm.oqty.value = 1; renderTotal();
    $('#offer-step').hidden = false;
    $('#receipt').hidden = true;
    renderDetail();
    if (!isOpen()) oSay('지금은 제안을 받지 않아요.', true);
    else oSay('');
    if (!products[id].closed && !products[id].sample) offerForm.oprice.focus();
  }
  grid.addEventListener('click', function (e) {
    var card = e.target.closest('.product');
    if (card) openDetail(card.dataset.id, card.querySelector('.detail-link'));
  });

  offerForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var p = products[detailId];
    if (!p || p.closed || p.sample || !isOpen()) return;
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
        // 판매자에게 직접 입금한다. 판매자 계좌는 settings.json의 sellers, 판매자가 없으면 bank(운영자 직접 판매)
        var seller = (products[m.pid] || {}).seller;
        var b = m.bank || (seller ? (settings.sellers || {})[seller] : settings.bank) || {}, bank = li.querySelector('.oc-bank');
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
  var adminTab = 'offers';
  function showTab(name) {
    adminTab = name;
    ['offers', 'products', 'sales'].forEach(function (t) {
      $('#tab-' + t).setAttribute('aria-selected', String(t === name));
      $('#pane-' + t).hidden = t !== name;
    });
    if (name === 'offers') startOffers(); else if (name === 'products') startProducts(); else startAdminSales();
  }
  $('#tab-offers').addEventListener('click', function () { showTab('offers'); });
  $('#tab-products').addEventListener('click', function () { showTab('products'); });
  $('#tab-sales').addEventListener('click', function () { showTab('sales'); });
  function openAdmin(from) { openPanel($('#admin'), from); showTab(adminTab); }
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
      renderOffers($('#offer-groups'), offers, offerFilter);
    }).catch(function (err) {
      $('#key-login').hidden = false; $('#offers-wrap').hidden = true;
      keySay((err && err.message) || '제안을 불러오지 못했어요.', true);
    });
  }
  $('#key-save').addEventListener('click', function () {
    var k = $('#admin-key').value.trim();
    if (!k) { keySay('관리자 열쇠를 적어 주세요.', true); return; }
    store(ADMIN_KEY, k); $('#admin-key').value = '';
    startOffers();
  });
  $('#key-logout').addEventListener('click', function () { store(ADMIN_KEY, null); startOffers(); keySay('로그아웃했어요.'); });

  $('#offer-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]'); if (!b) return;
    offerFilter = b.dataset.f;
    document.querySelectorAll('#offer-filter button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderOffers($('#offer-groups'), offers, offerFilter);
  });

  // 상품별로 묶고, 한 상품 안에서는 높은 단가부터 보여 준다
  function renderOffers(box, offers, offerFilter) {
    var groups = {}, keys = [];
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
      renderOffers($('#offer-groups'), offers, offerFilter);
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
        .then(function (j) { ghSha = j.content && j.content.sha; setBase(list); });
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
    ghLoad().then(function (list) { setBase(list); m.textContent = ''; showLoggedIn(true); })
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
    form.unit.value = p.unit; form.desc.value = p.desc; form.closed.checked = p.closed; form.sample.checked = p.sample;
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
    if (form.sample.checked) data.sample = true;
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

  // 관리자 상품 관리는 products.json(샘플·운영 상품)만 다룬다. 판매자 상품은 판매자 코너에서 판매자가 관리한다.
  function renderAdminList() {
    var ids = order.filter(function (id) { return !products[id].fromSheet; });
    $('#admin-count').textContent = ids.length;
    adminList.innerHTML = '';
    ids.forEach(function (id) {
      var p = products[id], b = bids[id];
      var li = document.createElement('li');
      li.dataset.id = id;
      if (id === editingId) li.className = 'editing';
      li.innerHTML = '<span class="a-name"></span><span class="a-actions"><button type="button" data-edit>수정</button><button type="button" class="del" data-del>삭제</button></span><span class="a-meta"></span>';
      li.querySelector('.a-name').textContent = p.name + (p.sample ? ' (샘플)' : '') + (p.closed ? ' (마감)' : '');
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

  // ---------- 기간별 기록표 (일별·월별·연별) ----------
  // cfg: { rows, date(r) → 'yyyy-MM-dd…', cols: [{ head, of(list) }], heads: [...], line(r) → [[글, 칸 class]], sort(a, b), noun }
  var UNITS = { day: { len: 10, name: '날짜' }, month: { len: 7, name: '월' }, year: { len: 4, name: '연도' } };
  function unitLabel(k, u) { return u === 'month' ? k.replace('-', '년 ') + '월' : u === 'year' ? k + '년' : k; }
  function tr(vals, attrs) {
    var row = document.createElement('tr');
    Object.keys(attrs || {}).forEach(function (k) { row.setAttribute(k, attrs[k]); });
    vals.forEach(function (v) { var td = document.createElement('td'); td.textContent = v[0]; if (v[1]) td.className = v[1]; row.appendChild(td); });
    return row;
  }
  function makePeriod(box, cfg) {
    var unit = 'month', key = null;
    box.innerHTML = '<div class="admin-tabs p-unit" role="group" aria-label="기간">' +
      '<button type="button" data-unit="day">일별</button><button type="button" data-unit="month">월별</button><button type="button" data-unit="year">연별</button></div>' +
      '<table class="sales-table"><thead><tr></tr></thead><tbody class="p-body"></tbody></table>' +
      '<p class="sales-note"></p><h4 class="sales-sub p-title"></h4>' +
      '<table class="sales-table"><thead><tr></tr></thead><tbody class="p-list"></tbody></table>';
    var heads = box.querySelectorAll('thead tr');
    cfg.heads.forEach(function (h) { var th = document.createElement('th'); th.textContent = h[0]; if (h[1]) th.className = h[1]; heads[1].appendChild(th); });
    box.querySelector('.sales-note').textContent = '기간 줄을 누르면 그 기간의 ' + cfg.noun + ' 목록이 아래에 보여요.';
    function render() {
      var U = UNITS[unit], rows = cfg.rows || [];
      box.querySelectorAll('.p-unit button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.unit === unit)); });
      heads[0].innerHTML = '';
      [[U.name]].concat(cfg.cols.map(function (c) { return [c.head, 'num']; })).forEach(function (h) {
        var th = document.createElement('th'); th.textContent = h[0]; if (h[1]) th.className = h[1]; heads[0].appendChild(th);
      });
      var groups = {};
      rows.forEach(function (r) { var k = String(cfg.date(r) || '-').slice(0, U.len); (groups[k] || (groups[k] = [])).push(r); });
      var keys = Object.keys(groups).sort().reverse();
      if (key && !groups[key]) key = null;
      var body = box.querySelector('.p-body'); body.innerHTML = '';
      keys.forEach(function (k) {
        body.appendChild(tr([[unitLabel(k, unit), 'pick']].concat(cfg.cols.map(function (c) { return [c.of(groups[k]), 'num']; })),
          { 'data-key': k, tabindex: '0', 'aria-selected': String(key === k) }));
      });
      if (keys.length) body.appendChild(tr([['전체']].concat(cfg.cols.map(function (c) { return [c.of(rows), 'num']; })), { 'class': 'sum-row' }));
      else body.appendChild(tr([['아직 ' + cfg.noun + ' 기록이 없어요.']]));
      box.querySelector('.p-title').textContent = key ? unitLabel(key, unit) + ' ' + cfg.noun + ' 목록' : cfg.noun + ' 목록 (전체)';
      var list = box.querySelector('.p-list'); list.innerHTML = '';
      rows.filter(function (r) { return !key || String(cfg.date(r) || '-').slice(0, U.len) === key; }).sort(cfg.sort)
        .forEach(function (r) { list.appendChild(tr(cfg.line(r))); });
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-unit]');
      if (b) { unit = b.dataset.unit; key = null; render(); return; }
      var row = e.target.closest('tr[data-key]');
      if (row) { key = key === row.dataset.key ? null : row.dataset.key; render(); }
    });
    box.addEventListener('keydown', function (e) {
      var row = e.target.closest('tr[data-key]');
      if (row && e.key === 'Enter') { key = key === row.dataset.key ? null : row.dataset.key; render(); }
    });
    return { set: function (rows) { cfg.rows = rows; key = null; render(); }, reset: function () { unit = 'month'; key = null; } };
  }
  function countOrders(list) { var o = {}; list.forEach(function (r) { o[r.orderNo] = 1; }); return Object.keys(o).length + '건'; }
  function sumAmount(list) { return won(list.reduce(function (n, r) { return n + (Number(r.amount) || 0); }, 0)); }
  function salesPeriod(box) {
    return makePeriod(box, {
      noun: '판매', date: function (r) { return r.day; },
      cols: [{ head: '주문', of: countOrders }, { head: '금액', of: sumAmount }],
      heads: [['제안번호'], ['날짜'], ['상품'], ['금액', 'num']],
      line: function (r) { return [[r.orderNo], [r.day], [r.items || '-'], [won(r.amount), 'num']]; },
      sort: function (a, b) { return a.orderNo < b.orderNo ? 1 : -1; }
    });
  }
  function apiError(err, fallback) { return err && err.message && !/fetch|network|JSON/i.test(err.message) ? err.message : fallback; }

  // ----- 관리자 판매 기록: 판매자별 합계 → 판매자를 누르면 기간별 현황 -----
  var adminSales = [], adminWho = null, adminPeriod = salesPeriod($('#a-sales-period'));
  function startAdminSales() {
    var m = $('#a-sales-msg');
    $('#a-sales-main').hidden = true; $('#a-sales-detail').hidden = true;
    if (!store(ADMIN_KEY)) { m.textContent = '받은 제안 칸에서 관리자 열쇠로 먼저 로그인해 주세요.'; m.classList.add('err'); return; }
    m.textContent = '판매 기록을 읽는 중이에요…'; m.classList.remove('err');
    apiPost({ action: 'adminSales', key: store(ADMIN_KEY) }).then(function (res) {
      if (!res || !res.ok || !Array.isArray(res.sales)) throw new Error(res && res.error);
      adminSales = res.sales; adminWho = null; m.textContent = '';
      renderAdminSales();
    }).catch(function (err) { m.textContent = apiError(err, '판매 기록을 읽지 못했어요.'); m.classList.add('err'); });
  }
  function renderAdminSales() {
    $('#a-sales-main').hidden = !!adminWho; $('#a-sales-detail').hidden = !adminWho;
    if (adminWho) {
      $('#a-sales-title').textContent = adminWho + ' 판매 현황';
      adminPeriod.set(adminSales.filter(function (r) { return r.seller === adminWho; }));
      return;
    }
    var by = {};
    adminSales.forEach(function (r) { (by[r.seller] || (by[r.seller] = [])).push(r); });
    var names = Object.keys(by).sort(function (a, b) { return by[b].reduce(function (n, r) { return n + r.amount; }, 0) - by[a].reduce(function (n, r) { return n + r.amount; }, 0); });
    var body = $('#a-sales-sellers'); body.innerHTML = '';
    names.forEach(function (n) {
      var last = by[n].reduce(function (d, r) { return r.day > d ? r.day : d; }, '');
      body.appendChild(tr([[n, 'pick'], [countOrders(by[n]), 'num'], [sumAmount(by[n]), 'num'], [last || '-', 'num']], { 'data-seller': n, tabindex: '0' }));
    });
    if (!names.length) body.appendChild(tr([['아직 판매 기록이 없어요.']]));
    $('#a-sales-count').textContent = names.length;
  }
  ['click', 'keydown'].forEach(function (t) {
    $('#a-sales-sellers').addEventListener(t, function (e) {
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      var row = e.target.closest('tr[data-seller]'); if (!row) return;
      adminWho = row.dataset.seller; adminPeriod.reset(); renderAdminSales();
    });
  });
  $('#a-sales-back').addEventListener('click', function () { adminWho = null; renderAdminSales(); });

  // ---------- 판매자 코너 (무엇이든 상점 판매자 계정) ----------
  var sNick = '', sTab = 'offers', sOffers = [], sFilter = '검토 중', sItems = [], sEditing = null, mainUrl = '';
  var sForm = $('#s-form');
  fetch('../settings.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { mainUrl = (j && j.orderUrl) || ''; }).catch(function () {});
  function sSay(t, isErr) { var m = $('#s-msg'); m.textContent = t; m.classList.toggle('err', !!isErr); }
  function fSay(t, isErr) { var m = $('#s-form-msg'); m.textContent = t; m.classList.toggle('err', !!isErr); }
  function sellerPost(body) {
    body.key = store(SELLER_KEY);
    return apiPost(body).then(function (res) {
      if (!res || !res.ok) {
        var e = new Error((res && res.error) || '처리하지 못했어요.');
        if (res && res.error === '다시 로그인해 주세요.') { store(SELLER_KEY, null); refreshEntries(); sShow('login'); }
        throw e;
      }
      return res;
    });
  }
  function refreshEntries() {
    var on = !!store(SELLER_KEY);
    $('#open-seller').hidden = !on; $('#seller-out').hidden = !on; $('#seller-entry').hidden = on;
  }
  refreshEntries();
  function sShow(view) {
    $('#s-login').hidden = view !== 'login';
    $('#s-corner').hidden = view !== 'corner';
    $('#s-title').textContent = view === 'corner' ? '판매자 코너' : '판매자 로그인';
  }
  function openSeller(from) {
    openPanel($('#seller'), from);
    if (!store(SELLER_KEY)) { sShow('login'); sSay(''); return; }
    if (sNick) { sShow('corner'); sOpenTab(sTab); return; }
    sShow(''); sSay('확인하는 중이에요…');
    sellerPost({ action: 'sellerMe' }).then(function (res) { sNick = res.nick; sSay(''); sShow('corner'); sOpenTab('offers'); })
      .catch(function (err) { sSay(apiError(err, '판매자 정보를 확인하지 못했어요. 잠시 뒤 다시 열어 주세요.'), true); });
  }
  $('#open-seller').addEventListener('click', function () { openSeller(this); });
  $('#seller-entry').addEventListener('click', function () { openSeller(this); });
  function sLogout() { store(SELLER_KEY, null); sNick = ''; refreshEntries(); }
  $('#seller-out').addEventListener('click', function () { sLogout(); });
  $('#s-logout').addEventListener('click', function () { sLogout(); sShow('login'); sSay('로그아웃했어요.'); });
  $('#s-go').addEventListener('click', function () {
    var id = $('#s-id').value.trim(), pw = $('#s-pw').value;
    if (!id || !pw) { sSay('아이디와 비밀번호를 적어 주세요.', true); return; }
    if (!mainUrl) { sSay('아직 로그인할 수 없어요. 잠시 뒤 다시 눌러 주세요.', true); return; }
    var btn = $('#s-go'); btn.disabled = true; sSay('로그인하는 중이에요…');
    fetch(mainUrl, { method: 'POST', body: JSON.stringify({ action: 'sellerLogin', loginId: id, password: pw }) }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || !res.key) throw new Error((res && res.error) || '로그인하지 못했어요.');
        store(SELLER_KEY, res.key); sNick = res.nick; $('#s-pw').value = '';
        refreshEntries(); sSay(''); sShow('corner'); sOpenTab('offers');
      }).catch(function (err) { sSay(apiError(err, '로그인하지 못했어요. 인터넷 연결을 확인해 주세요.'), true); })
      .then(function () { btn.disabled = false; });
  });
  $('#s-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#s-go').click(); });

  var sUpPeriod = makePeriod($('#s-up-period'), {
    noun: '올린 상품', date: function (r) { return r.at; },
    cols: [{ head: '올린 상품', of: function (l) { return l.length + '개'; } },
      { head: '게시 중', of: function (l) { return l.filter(function (r) { return r.status !== '내림'; }).length + '개'; } }],
    heads: [['올린 날'], ['상품'], ['상태']],
    line: function (r) { return [[(r.at || '-').slice(0, 10)], [r.name], [r.status === '내림' ? '내림' : r.closed ? '제안 마감' : '게시 중']]; },
    sort: function (a, b) { return a.at < b.at ? 1 : -1; }
  });
  var sSalesPeriod = salesPeriod($('#s-sales-period'));

  function sOpenTab(name) {
    sTab = name;
    document.querySelectorAll('#s-tabs button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.stab === name)); });
    ['offers', 'items', 'uploads', 'sales'].forEach(function (t) { $('#s-pane-' + t).hidden = t !== name; });
    sSay('불러오는 중이에요…');
    var job;
    if (name === 'offers') job = sellerPost({ action: 'sellerOffers' }).then(function (res) { sOffers = res.offers || []; renderOffers($('#s-offer-groups'), sOffers, sFilter); });
    else if (name === 'sales') job = sellerPost({ action: 'sellerSales' }).then(function (res) {
      var list = res.sales || [];
      $('#s-sales-count').textContent = countOrders(list).replace('건', '');
      sSalesPeriod.set(list);
    });
    else job = sellerPost({ action: 'sellerItems' }).then(function (res) {
      sItems = res.items || [];
      $('#s-up-count').textContent = sItems.length;
      if (name === 'uploads') sUpPeriod.set(sItems); else renderSellerItems();
    });
    job.then(function () { sSay(''); }).catch(function (err) { sSay(apiError(err, '불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.'), true); });
  }
  $('#s-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-stab]'); if (b) { fSay(''); sOpenTab(b.dataset.stab); }
  });

  $('#s-offer-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]'); if (!b) return;
    sFilter = b.dataset.f;
    document.querySelectorAll('#s-offer-filter button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderOffers($('#s-offer-groups'), sOffers, sFilter);
  });
  $('#s-offer-groups').addEventListener('click', function (e) {
    var b = e.target.closest('[data-decide]'); if (!b) return;
    var li = b.closest('.offer-card'), no = li.dataset.no;
    li.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
    sellerPost({ action: 'sellerDecide', no: no, status: b.dataset.decide }).then(function (res) {
      sOffers.forEach(function (o) { if (o.no === no) o.status = res.status; });
      renderOffers($('#s-offer-groups'), sOffers, sFilter);
      loadBids();
      sSay(res.status === '수락' ? '팔기로 했어요. 손님은 내 제안에서 입금 계좌를 볼 수 있어요. 연락처로도 알려 주세요.' : '');
    }).catch(function (err) {
      li.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
      sSay(apiError(err, '저장하지 못했어요. 다시 눌러 주세요.'), true);
    });
  });

  function renderSellerItems() {
    var list = $('#s-list'), shown = sItems.filter(function (x) { return x.status !== '내림'; });
    list.innerHTML = '';
    $('#s-count').textContent = shown.length;
    $('#s-empty').hidden = shown.length > 0;
    shown.forEach(function (p) {
      var b = bids[p.id], li = document.createElement('li');
      li.dataset.id = p.id;
      if (p.id === sEditing) li.className = 'editing';
      li.innerHTML = '<span class="a-name"></span><span class="a-actions"><button type="button" data-edit>수정</button><button type="button" class="del" data-del>내리기</button></span><span class="a-meta"></span>';
      li.querySelector('.a-name').textContent = p.name + (p.closed ? ' (마감)' : '');
      li.querySelector('.a-meta').textContent = p.cat + (p.unit ? ' · ' + p.unit : '') + (b && b.count ? ' · 제안 ' + b.count + '건, 최고 ' + won(b.top) : ' · 제안 없음');
      list.appendChild(li);
    });
  }
  function sReset() {
    sEditing = null; sForm.reset();
    $('#s-form-title').textContent = '새 상품 올리기'; $('#s-save').textContent = '상품 올리기'; $('#s-cancel').hidden = true;
    renderSellerItems();
  }
  $('#s-cancel').addEventListener('click', function () { sReset(); fSay(''); });
  $('#s-list').addEventListener('click', function (e) {
    var li = e.target.closest('li'); if (!li) return;
    var p = sItems.filter(function (x) { return x.id === li.dataset.id; })[0]; if (!p) return;
    if (e.target.closest('[data-edit]')) {
      sEditing = p.id;
      sForm.name.value = p.name; sForm.cat.value = p.cat; sForm.unit.value = p.unit; sForm.desc.value = p.desc; sForm.closed.checked = p.closed;
      $('#s-form-title').textContent = '내 상품 고치기'; $('#s-save').textContent = '수정 저장'; $('#s-cancel').hidden = false;
      fSay(''); renderSellerItems(); sForm.name.focus();
      return;
    }
    var del = e.target.closest('[data-del]'); if (!del) return;
    if (!del.classList.contains('confirm')) {
      del.classList.add('confirm'); del.textContent = '정말 내리기';
      setTimeout(function () { if (del.isConnected) { del.classList.remove('confirm'); del.textContent = '내리기'; } }, 3000);
      return;
    }
    del.disabled = true;
    sellerPost({ action: 'sellerRemove', id: p.id }).then(function () {
      p.status = '내림'; if (sEditing === p.id) sReset(); else renderSellerItems();
      fSay('"' + p.name + '"을(를) 내렸어요. 올린 상품 기록에는 남아요.'); loadBids();
    }).catch(function (err) { del.disabled = false; fSay(apiError(err, '내리지 못했어요.'), true); });
  });
  sForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var item = { name: sForm.name.value.trim(), cat: sForm.cat.value.trim(), unit: sForm.unit.value.trim(), desc: sForm.desc.value.trim(), closed: sForm.closed.checked };
    if (!item.name) { fSay('상품 이름을 적어 주세요.', true); sForm.name.focus(); return; }
    if (!item.cat) { fSay('분류를 적어 주세요.', true); sForm.cat.focus(); return; }
    var btn = $('#s-save'); btn.disabled = true; fSay('저장하는 중이에요…');
    var id = sEditing;
    sellerPost({ action: 'sellerSave', id: id || '', item: item }).then(function () {
      fSay(id ? '"' + item.name + '" 수정을 저장했어요.' : '"' + item.name + '"을(를) 올렸어요. 상점에 바로 보여요.');
      sEditing = null; sForm.reset();
      $('#s-form-title').textContent = '새 상품 올리기'; $('#s-save').textContent = '상품 올리기'; $('#s-cancel').hidden = true;
      loadBids();
      return sellerPost({ action: 'sellerItems' }).then(function (res) { sItems = res.items || []; renderSellerItems(); });
    }).catch(function (err) { fSay(apiError(err, '저장하지 못했어요. 다시 눌러 주세요.'), true); })
      .then(function () { btn.disabled = false; });
  });

  // ---------- 시작 ----------
  fetch('products.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (j) { setBase(j.products || []); })
    .catch(function () { status.textContent = '상품 목록을 불러오지 못했어요.'; });
})();
