// 무엇이든 상점: 상품 목록(공유 저장소), 장바구니, 분류 필터, 상품 관리
(function () {
  var CART_KEY = 'anything-shop-cart';
  var won = function (n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; };
  var $ = function (s) { return document.querySelector(s); };

  var products = {};     // id -> {name, seller, cat, price, desc, unit, order}
  // 판매자를 적지 않은 상품은 운영자가 직접 파는 상품으로 표시한다(이용약관 제4조)
  var SHOP_NAME = '무엇이든 상점';
  function sellerOf(p) { return p.seller || SHOP_NAME; }
  var order = [];        // 화면에 보일 순서대로 id
  var loaded = false;
  var currentCat = 'all';
  var db = null, col = null, dbLive = false, artifactApi = null, syncTimer = null;
  var store = null;      // 상품 저장 방식: Claude 저장소(db) 방식일 때만 쓴다

  // 판매자가 직접 올린 상품(구글 시트)은 sellerRows에 따로 두고 운영 상품 목록 뒤에 붙인다
  // 운영 상품은 구글 시트 "운영 상품" 탭을 먼저 쓰고, 아직 없으면 products.json을 쓴다
  var baseRows = [], sellerRows = [], ownFromSheet = false;
  function ownRows(list) { return list.map(function (p) { return { id: p.id, data: p }; }); }
  function setProducts(rows) {
    baseRows = rows;
    products = {}; order = [];
    rows.concat(sellerRows).forEach(function (row) {
      var d = row.data;
      if (!d || typeof d.name !== 'string' || !d.name) return;
      products[row.id] = {
        name: d.name, seller: String(d.seller || ''), cat: String(d.cat || '기타'), price: Number(d.price) || 0,
        desc: String(d.desc || ''), unit: String(d.unit || ''), order: Number(d.order) || 0, sample: d.sample === true,
        fromSeller: d.fromSeller === true
      };
      order.push(row.id);
    });
    order.sort(function (a, b) { return products[a].order - products[b].order; });
    loaded = true;
    if (editingId && !products[editingId]) resetForm();
    renderProducts();
  }

  // 상품을 바꾸면 손님용 공개 파일(products.json)도 새로 올린다
  function syncPublic() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      var note = $('#sync-msg');
      if (!artifactApi) { note.textContent = '손님용 목록에는 아직 반영되지 않았어요. Claude에게 "공개 목록 반영"이라고 말해 주세요.'; return; }
      var list = order.map(function (id) { var p = products[id]; return Object.assign({ id: id }, p); });
      note.textContent = '손님용 목록에 반영하는 중이에요…';
      artifactApi.publish({ 'products.json': { content: JSON.stringify({ products: list }, null, 1), contentType: 'application/json' } })
        .then(function () { note.textContent = '손님용 목록에도 반영했어요.'; })
        .catch(function (err) {
          note.textContent = (err && err.code === 'conflict')
            ? '다른 곳에서 먼저 저장해서 페이지를 새로 불러와요. 다시 한 번 저장해 주세요.'
            : '손님용 목록에는 반영하지 못했어요. Claude에게 "공개 목록 반영"이라고 말해 주세요.';
        });
    }, 1500);
  }

  // ---------- 장바구니 (보는 사람 브라우저에만 저장) ----------
  var cart = {};
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch (e) { cart = {}; }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }

  var list = $('#cart-items'), empty = $('#cart-empty'), totalEl = $('#cart-total');
  var countEl = $('#cart-count'), checkout = $('#checkout'), done = $('#done');

  function renderCart() {
    // 삭제된 상품은 목록이 불러와진 뒤에만 정리한다
    if (loaded) Object.keys(cart).forEach(function (id) { if (!products[id]) delete cart[id]; });
    var ids = Object.keys(cart).filter(function (id) { return products[id]; });
    var total = 0, count = 0;
    list.innerHTML = '';
    ids.forEach(function (id) {
      var p = products[id], q = cart[id];
      total += p.price * q; count += q;
      var li = document.createElement('li');
      li.className = 'item';
      li.dataset.id = id;
      li.innerHTML =
        '<span class="name"></span><span class="sum"></span>' +
        '<span class="qty"><button type="button" data-dec aria-label="하나 빼기">−</button><span></span>' +
        '<button type="button" data-inc aria-label="하나 더">+</button></span>' +
        '<button type="button" class="remove" data-remove>삭제</button>';
      li.querySelector('.name').textContent = p.name;
      li.querySelector('.sum').textContent = won(p.price * q);
      li.querySelector('.qty span').textContent = q;
      list.appendChild(li);
    });
    empty.hidden = ids.length > 0;
    list.hidden = ids.length === 0;
    totalEl.textContent = won(total);
    countEl.textContent = count;
    checkout.disabled = count === 0;
    document.querySelectorAll('#grid .add').forEach(function (b) {
      if (b.disabled) return;
      var q = cart[b.dataset.add];
      b.classList.toggle('added', !!q);
      b.textContent = q ? '담김 ' + q : '담기';
    });
  }

  function changeCart(id, d) {
    if (products[id] && products[id].sample && d > 0) return;
    cart[id] = (cart[id] || 0) + d;
    if (cart[id] <= 0) delete cart[id];
    done.hidden = true;
    saveCart(); renderCart();
  }

  checkout.addEventListener('click', function () { openOrder(checkout); });

  // ---------- 상품 목록 ----------
  var grid = $('#grid'), status = $('#status'), tpl = $('#product-tpl');

  function renderProducts() {
    grid.innerHTML = '';
    order.forEach(function (id) {
      var p = products[id];
      var li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = id;
      li.dataset.cat = p.cat;
      li.querySelector('.kind').textContent = p.sample ? '샘플 · ' + p.cat : p.cat;
      li.classList.toggle('is-sample', p.sample);
      li.querySelector('.detail-link').textContent = p.name;
      var sel = li.querySelector('.seller');
      sel.textContent = '판매자 ' + sellerOf(p);
      li.querySelector('.desc').textContent = p.desc || '';
      li.querySelector('.unit').textContent = p.unit || '';
      li.querySelector('.price').textContent = won(p.price);
      li.querySelector('.add').dataset.add = id;
      // 샘플 상품은 상점을 보여 주기 위한 것이라 담을 수 없다
      if (p.sample) { li.querySelector('.add').textContent = '샘플'; li.querySelector('.add').disabled = true; }
      li.hidden = !inView(p);
      grid.appendChild(li);
    });
    renderCats();
    // "전체"에는 진짜 상품과 판매자 등록 신청서, "샘플"에는 샘플 상품만 보인다
    if (loaded) status.textContent = currentCat === 'all' || order.some(function (id) { return inView(products[id]); }) ? '' : '아직 등록된 상품이 없어요.';
    $('#sample-note').hidden = currentCat !== 'sample';
    $('#empty-cta').hidden = !loaded || currentCat !== 'all' || order.some(function (id) { return inView(products[id]); });
    if (!$('#empty-cta').hidden) status.textContent = '';
    renderCart();
    renderAdminList();
  }

  function inView(p) {
    if (currentCat === 'sample') return p.sample;
    return !p.sample && (currentCat === 'all' || p.cat === currentCat);
  }
  function hasSamples() { return order.some(function (id) { return products[id].sample; }); }
  // 분류 버튼은 진짜 상품의 분류만 만든다(샘플은 "샘플" 버튼 하나로 모은다)
  function catsInUse() {
    var seen = [];
    order.forEach(function (id) { var c = products[id].cat; if (c && !products[id].sample && seen.indexOf(c) < 0) seen.push(c); });
    return seen;
  }

  function renderCats() {
    var box = $('#cats'), cats = catsInUse();
    var heads = hasSamples() ? ['sample', 'all'] : ['all'];
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
    var dl = $('#cat-list'); dl.innerHTML = '';
    cats.forEach(function (c) { var o = document.createElement('option'); o.value = c; dl.appendChild(o); });
    var sl = $('#seller-list'), sellers = []; sl.innerHTML = '';
    order.forEach(function (id) { var s = products[id].seller; if (s && sellers.indexOf(s) < 0) { sellers.push(s); var o = document.createElement('option'); o.value = s; sl.appendChild(o); } });
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
    var first = panel.querySelector('input, [data-close]'); if (first) first.focus();
  }
  function closePanels() {
    document.querySelectorAll('.panel.open').forEach(function (p) { p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); });
    shade.hidden = true;
    if (opener) { opener.focus(); opener = null; }
  }
  $('#open-cart').addEventListener('click', function () { openPanel($('#cart'), this); });
  $('#open-admin').addEventListener('click', function () { openPanel($('#admin'), this); });
  shade.addEventListener('click', closePanels);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !shade.hidden) closePanels(); });

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { closePanels(); return; }
    var add = e.target.closest('[data-add]');
    if (add) {
      changeCart(add.dataset.add, 1);
      var btn = $('#open-cart');
      btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
      return;
    }
    var row = e.target.closest('.item');
    if (row) {
      if (e.target.closest('[data-inc]')) changeCart(row.dataset.id, 1);
      else if (e.target.closest('[data-dec]')) changeCart(row.dataset.id, -1);
      else if (e.target.closest('[data-remove]')) changeCart(row.dataset.id, -cart[row.dataset.id]);
    }
  });

  // ---------- 상품 자세히 보기 ----------
  var detailId = null, detailQty = 1;
  function renderDetail() {
    var p = products[detailId]; if (!p) return;
    $('#d-kind').textContent = p.sample ? '샘플 · ' + p.cat : p.cat;
    $('#d-sample').hidden = !p.sample;
    $('#d-add').disabled = $('#d-buy').disabled = p.sample;
    $('#d-name').textContent = p.name;
    $('#d-seller').textContent = '판매자 ' + sellerOf(p);
    $('#d-desc').textContent = p.desc || '';
    $('#d-unit').textContent = p.unit || '-';
    $('#d-price').textContent = won(p.price);
    $('#d-q').textContent = detailQty;
    $('#d-total').textContent = won(p.price * detailQty);
  }
  function openDetail(id, from) {
    if (!products[id]) return;
    detailId = id; detailQty = 1;
    renderDetail();
    openPanel($('#detail'), from);
  }
  grid.addEventListener('click', function (e) {
    if (e.target.closest('.add')) return;
    var card = e.target.closest('.product');
    if (card) openDetail(card.dataset.id, card.querySelector('.detail-link'));
  });
  $('#d-inc').addEventListener('click', function () { detailQty = Math.min(99, detailQty + 1); renderDetail(); });
  $('#d-dec').addEventListener('click', function () { detailQty = Math.max(1, detailQty - 1); renderDetail(); });
  $('#d-add').addEventListener('click', function () {
    changeCart(detailId, detailQty);
    closePanels();
    var btn = $('#open-cart'); btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
  });
  $('#d-buy').addEventListener('click', function () {
    changeCart(detailId, detailQty);
    openOrder($('#open-cart'));
  });

  // ---------- 주문서 ----------
  // 주문은 구글 시트로 보낸다(settings.json의 orderUrl). 결제는 손님이 판매자 계좌로 직접 입금.
  // 판매자 계좌는 settings.json의 sellers, 판매자가 비어 있는 상품(운영자 직접 판매)은 bank.
  var settings = { orderUrl: '', bank: {}, sellers: {} };
  fetch('settings.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j) settings = j; applyOpen(); loadSellerItems(); }).catch(function () {});

  function loadSellerItems() {
    if (!settings.orderUrl) return Promise.resolve();
    return fetch(settings.orderUrl + '?action=products', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.products)) return;
        sellerRows = j.products.map(function (p, i) {
          return { id: p.id, data: Object.assign({}, p, { fromSeller: true, order: 1000000 + i }) };
        });
        if (Array.isArray(j.own) && !window.claude) { ownFromSheet = true; setProducts(ownRows(j.own)); }
        else if (loaded) setProducts(baseRows);
      }).catch(function () {});
  }

  // settings.json의 open이 false면 "오픈 준비 중" 안내를 띄우고 주문을 받지 않는다
  function isOpen() { return settings.open !== false && !!settings.orderUrl; }
  function applyOpen() { $('#notice').hidden = settings.open !== false; }

  var orderForm = $('#order-form'), oMsg = $('#o-msg');
  function oSay(t, isErr) { oMsg.textContent = t; oMsg.classList.toggle('err', !!isErr); }

  function cartLines() {
    return Object.keys(cart).filter(function (id) { return products[id] && !products[id].sample; }).map(function (id) {
      var p = products[id];
      return { id: id, name: p.name, seller: p.seller, price: p.price, qty: cart[id] };
    });
  }

  function openOrder(from) {
    var lines = cartLines();
    if (!lines.length) return;
    var box = $('#o-items'), total = 0;
    box.innerHTML = '';
    lines.forEach(function (l) {
      total += l.price * l.qty;
      var li = document.createElement('li');
      li.className = 'item';
      li.innerHTML = '<span class="name"></span><span class="sum"></span><span class="meta"></span>';
      li.querySelector('.name').textContent = l.name;
      li.querySelector('.sum').textContent = won(l.price * l.qty);
      li.querySelector('.meta').textContent = won(l.price) + ' × ' + l.qty + ' · 판매자 ' + sellerOf(l);
      box.appendChild(li);
    });
    $('#o-total').textContent = won(total);
    $('#order-step').hidden = false;
    $('#receipt').hidden = true;
    if (!isOpen()) oSay('지금은 오픈 준비 중이라 주문을 받지 않아요. 정식 오픈 후에 주문해 주세요.', true);
    else oSay('');
    $('#o-submit').disabled = !isOpen();
    openPanel($('#order'), from);
  }

  // 판매자마다 입금할 금액과 계좌를 따로 보여 준다
  function renderPayTo(lines, accounts) {
    var box = $('#r-pay'), groups = {}, keys = [];
    lines.forEach(function (l) {
      var k = l.seller || '';
      if (!groups[k]) { groups[k] = 0; keys.push(k); }
      groups[k] += l.price * l.qty;
    });
    box.innerHTML = '';
    keys.forEach(function (k) {
      var b = k ? accounts[k] || (settings.sellers || {})[k] || {} : settings.bank || {};
      var div = document.createElement('div');
      div.innerHTML = '<dt></dt><dd><span class="r-sum"></span><span class="r-acct"></span></dd>';
      div.querySelector('dt').textContent = '판매자 ' + (k || SHOP_NAME);
      div.querySelector('.r-sum').textContent = won(groups[k]);
      div.querySelector('.r-acct').textContent = b.account ? b.name + ' ' + b.account + ' (' + b.holder + ')' : '판매자가 연락드려 계좌를 알려 드려요';
      box.appendChild(div);
    });
  }

  orderForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!isOpen()) return;
    var f = orderForm;
    var data = {
      name: f.oname.value.trim(), phone: f.ophone.value.trim(), place: f.oplace.value.trim(),
      memo: f.omemo.value.trim(), payer: f.opayer.value.trim(), items: cartLines()
    };
    if (!data.name) { oSay('주문하는 분 이름을 적어 주세요.', true); f.oname.focus(); return; }
    if (!/^[0-9+\-\s()]{8,20}$/.test(data.phone)) { oSay('연락처를 숫자로 적어 주세요. 예: 010-1234-5678', true); f.ophone.focus(); return; }
    if (!data.items.length) { oSay('장바구니가 비어 있어요.', true); return; }
    if (!data.payer) data.payer = data.name;

    var btn = $('#o-submit'); btn.disabled = true;
    oSay('주문을 보내는 중이에요…');
    // text/plain으로 보내야 구글 스크립트가 바로 받는다
    fetch(settings.orderUrl, { method: 'POST', body: JSON.stringify(data) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error(res && res.error || 'order failed');
        $('#r-no').textContent = res.orderNo;
        $('#r-total').textContent = won(res.total);
        renderPayTo(data.items, res.accounts || {});
        $('#order-step').hidden = true;
        $('#receipt').hidden = false;
        cart = {}; saveCart(); renderCart();
        f.reset(); oSay('');
      })
      .catch(function () {
        oSay('주문을 보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', true);
      })
      .then(function () { btn.disabled = false; });
  });

  // ---------- 상품 관리 창: 판매자(내 상품)와 사이트 관리자 ----------
  // mode: ''(로그인 전), 'seller'(판매자: 내 상품만), 'admin'(사이트 관리자)
  // 관리자 탭: items(판매자 상품 전체), sellers(판매자), own(샘플·운영 상품 = 시트 "운영 상품" 탭)
  var form = $('#product-form'), msg = $('#form-msg'), editingId = null;
  var adminList = $('#admin-list');
  var mode = '', adminTab = 'items', adminData = { items: [], sellers: [] }, sellerNick = '';

  function say(text, isErr) { msg.textContent = text; msg.classList.toggle('err', !!isErr); }

  // 지금 목록에 보일 상품: [{ id, p }]
  function listed() {
    if (mode === 'seller') {
      return order.filter(function (id) { return products[id].fromSeller && products[id].seller === sellerNick; })
        .map(function (id) { return { id: id, p: products[id] }; });
    }
    if (mode === 'admin' && adminTab === 'items') return adminData.items.map(function (it) { return { id: it.id, p: it }; });
    return order.filter(function (id) { return !products[id].fromSeller; }).map(function (id) { return { id: id, p: products[id] }; });
  }
  function findListed(id) {
    var hit = null;
    listed().forEach(function (x) { if (x.id === id) hit = x.p; });
    return hit;
  }

  function formTitle() {
    if (mode === 'seller') return editingId ? '내 상품 고치기' : '새 상품 올리기';
    if (mode === 'admin' && adminTab === 'items') return '판매자 상품 고치기';
    return editingId ? '상품 수정' : '샘플·운영 상품 등록';
  }

  function startEdit(id) {
    var p = findListed(id); if (!p) return;
    editingId = id;
    form.hidden = false;
    form.name.value = p.name; form.seller.value = p.seller || ''; form.cat.value = p.cat; form.price.value = p.price;
    form.unit.value = p.unit || ''; form.desc.value = p.desc || ''; form.sample.checked = !!p.sample;
    $('#form-title').textContent = formTitle();
    $('#f-save').textContent = '수정 저장';
    $('#f-cancel').hidden = false;
    say('');
    renderAdminList();
    form.scrollIntoView({ block: 'start' });
    form.name.focus();
  }

  function resetForm() {
    editingId = null;
    form.reset();
    if (mode === 'seller') form.seller.value = sellerNick;
    var adminOnlyEdit = mode === 'admin' && adminTab !== 'own';
    form.hidden = !mode || adminOnlyEdit;
    form.seller.readOnly = mode === 'seller' || (mode === 'admin' && adminTab === 'items');
    $('#f-sample-row').hidden = mode !== 'admin';
    $('#form-title').textContent = formTitle();
    $('#f-save').textContent = mode === 'seller' ? '상품 올리기' : '등록하기';
    $('#f-cancel').hidden = true;
    renderAdminList();
  }
  $('#f-cancel').addEventListener('click', function () { resetForm(); say(''); });

  function activeStore() {
    if (mode === 'seller') return sellerStore;
    if (mode === 'admin') return adminTab === 'items' ? adminItemStore : ownStore;
    return store;   // Claude 저장소(db) 방식
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var st = activeStore();
    if (!st) return;
    var data = {
      name: form.name.value.trim(),
      seller: form.seller.value.trim(),
      cat: form.cat.value.trim(),
      price: Math.round(Number(form.price.value)),
      unit: form.unit.value.trim(),
      desc: form.desc.value.trim()
    };
    if (form.sample.checked && mode === 'admin' && adminTab === 'own') data.sample = true;
    if (mode === 'seller') data.seller = sellerNick;
    if (!data.name) { say('상품 이름을 적어 주세요.', true); form.name.focus(); return; }
    if (!data.cat) { say('분류를 적어 주세요.', true); form.cat.focus(); return; }
    if (form.price.value === '' || !(data.price >= 0)) { say('가격을 0 이상의 숫자로 적어 주세요.', true); form.price.focus(); return; }

    var saveBtn = $('#f-save'); saveBtn.disabled = true;
    var wasEdit = !!editingId;
    var job;
    if (wasEdit) {
      var old = findListed(editingId);
      data.order = old && old.order || Date.now();
      job = st.save(editingId, data);
    } else {
      var max = 0; order.forEach(function (id) { if (!products[id].fromSeller) max = Math.max(max, products[id].order || 0); });
      data.order = max + 10;
      job = st.save(null, data);
    }
    job.then(function () {
      resetForm();
      say((wasEdit ? '"' + data.name + '" 수정을 저장했어요.' : '"' + data.name + '"을(를) 올렸어요.') + (st.note || ''));
      if (st.afterWrite) st.afterWrite();
    }).catch(function (err) {
      say(writeError(err), true);
    }).then(function () { saveBtn.disabled = false; });
  });

  function writeError(err) {
    if (err && err.sellerError) return err.sellerError;
    var c = err && err.code;
    if (c === 'invalid_argument') return '저장할 권한이 없어요. 이 페이지의 편집자만 상품을 바꿀 수 있어요.';
    if (c === 'quota_exceeded') return '저장 공간이 가득 찼어요. 쓰지 않는 상품을 지운 뒤 다시 해 주세요.';
    return '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
  }

  function listItem(id, name, meta, buttons, cls) {
    var li = document.createElement('li');
    li.dataset.id = id;
    li.className = (id === editingId ? 'editing ' : '') + (cls || '');
    li.innerHTML = '<span class="a-name"></span><span class="a-actions"></span><span class="a-meta"></span>';
    li.querySelector('.a-name').textContent = name;
    li.querySelector('.a-meta').textContent = meta;
    var box = li.querySelector('.a-actions');
    buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = b[0]; btn.setAttribute(b[1], '');
      if (b[2]) btn.className = b[2];
      box.appendChild(btn);
    });
    adminList.appendChild(li);
  }

  function renderAdminList() {
    adminList.innerHTML = '';
    if (mode === 'admin' && adminTab === 'sellers') {
      $('#admin-list-label').textContent = '판매자';
      $('#admin-count').textContent = adminData.sellers.length;
      adminData.sellers.forEach(function (s) {
        var stopped = s.status === '정지';
        listItem(s.nick, s.nick + (stopped ? ' (정지)' : ''),
          [s.loginId && '아이디 ' + s.loginId, s.realName, s.tel, s.kind, s.at && '가입 ' + s.at].filter(Boolean).join(' · '),
          [[stopped ? '다시 활동' : '정지', 'data-seller-toggle', stopped ? '' : 'del']], stopped ? 'is-off' : '');
      });
      $('#admin-empty').hidden = adminData.sellers.length > 0;
      return;
    }
    var rows = listed();
    $('#admin-list-label').textContent = mode === 'seller' ? '내 상품' : mode === 'admin' && adminTab === 'items' ? '판매자 상품' : '샘플·운영 상품';
    $('#admin-count').textContent = rows.length;
    rows.forEach(function (x) {
      var p = x.p, off = p.status === '내림';
      var meta = (p.sample ? '샘플 · ' : '') + (p.seller ? p.seller + ' · ' : '') + p.cat + ' · ' + won(p.price) + (p.unit ? ' · ' + p.unit : '') +
        (mode === 'admin' && adminTab === 'items' ? ' · ' + (off ? '내림' : '게시 중') : '');
      var buttons;
      if (mode === 'seller') buttons = [['수정', 'data-edit'], ['내리기', 'data-del', 'del']];
      else if (mode === 'admin' && adminTab === 'items') buttons = [['수정', 'data-edit'], [off ? '다시 게시' : '내리기', 'data-toggle'], ['삭제', 'data-del', 'del']];
      else buttons = [['수정', 'data-edit'], ['삭제', 'data-del', 'del']];
      listItem(x.id, p.name, meta, buttons, off ? 'is-off' : '');
    });
    $('#admin-empty').hidden = rows.length > 0;
    $('#admin-empty').textContent = mode === 'seller' ? '아직 올린 상품이 없어요. 아래에서 첫 상품을 올려 보세요.' : '아직 상품이 없어요.';
  }

  adminList.addEventListener('click', function (e) {
    var li = e.target.closest('li'); if (!li) return;
    var id = li.dataset.id;
    if (e.target.closest('[data-edit]')) { startEdit(id); return; }
    var tog = e.target.closest('[data-toggle]');
    if (tog) {
      var it = findListed(id); tog.disabled = true;
      adminPost({ action: 'adminItemStatus', id: id, status: it.status === '내림' ? '게시' : '내림' })
        .then(reloadAdmin).then(loadSellerItems)
        .then(function () { say('"' + it.name + '"을(를) ' + (it.status === '내림' ? '다시 게시했어요.' : '내렸어요.')); })
        .catch(function (err) { tog.disabled = false; say(writeError(err), true); });
      return;
    }
    var st = e.target.closest('[data-seller-toggle]');
    if (st) {
      var s = null; adminData.sellers.forEach(function (x) { if (x.nick === id) s = x; });
      st.disabled = true;
      adminPost({ action: 'adminSellerStatus', nick: id, status: s.status === '정지' ? '활동' : '정지' })
        .then(reloadAdmin).then(loadSellerItems)
        .then(function () { say('판매자 "' + id + '"을(를) ' + (s.status === '정지' ? '다시 활동하게 했어요.' : '정지했어요. 상품도 상점에서 사라져요.')); })
        .catch(function (err) { st.disabled = false; say(writeError(err), true); });
      return;
    }
    var del = e.target.closest('[data-del]');
    if (del) {
      // 한 번 더 눌러야 지워진다
      var label = del.textContent;
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm'); del.textContent = '정말 ' + label;
        setTimeout(function () { if (del.isConnected) { del.classList.remove('confirm'); del.textContent = label; } }, 3000);
        return;
      }
      var p = findListed(id), name = p ? p.name : '';
      var sto = activeStore();
      del.disabled = true;
      sto.remove(id).then(function () {
        if (editingId === id) resetForm();
        say('"' + name + '"을(를) ' + (mode === 'seller' ? '내렸어요.' : '삭제했어요.') + (sto.note || ''));
        if (sto.afterWrite) sto.afterWrite();
      }).catch(function (err) { del.disabled = false; say(writeError(err), true); });
    }
  });

  // ---------- 판매자 로그인과 관리자 로그인 ----------
  // 판매자는 아이디·비밀번호로 로그인하고, 받은 로그인 열쇠를 이 브라우저에 둔다. 상품은 구글 시트(orderUrl)에 저장되어 바로 보인다.
  // 사이트 관리자는 관리자 비밀번호(시트 스크립트의 ADMIN_KEY)로 들어온다. 비밀번호는 이 브라우저에만 저장된다.
  var SELLER_KEY = 'anything-shop-seller-key', ADMIN_KEY = 'anything-shop-admin-key';
  try { localStorage.removeItem('anything-shop-gh-token'); } catch (e) {}   // 예전 GitHub 열쇠는 더 이상 쓰지 않는다
  function adminKey() { try { return localStorage.getItem(ADMIN_KEY) || ''; } catch (e) { return ''; } }
  function sellerKey() { try { return localStorage.getItem(SELLER_KEY) || ''; } catch (e) { return ''; } }
  function keep(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function api(body) {
    if (!settings.orderUrl) return Promise.reject({ sellerError: '지금은 이 기능을 쓸 수 없어요. 잠시 뒤 다시 해 주세요.' });
    return fetch(settings.orderUrl, { method: 'POST', body: JSON.stringify(body) }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw { sellerError: (res && res.error) || '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.' };
        return res;
      }, function () { throw { sellerError: '인터넷 연결을 확인하고 다시 눌러 주세요.' }; });
  }
  function sellerPost(body) { body.key = sellerKey(); return api(body); }
  function adminPost(body) { body.adminKey = adminKey(); return api(body); }

  var sellerStore = {
    note: ' 상점에 바로 보여요.',
    save: function (id, data) { return sellerPost({ action: 'sellerSave', id: id, product: data }).then(loadSellerItems); },
    remove: function (id) { return sellerPost({ action: 'sellerRemove', id: id }).then(loadSellerItems); }
  };
  var adminItemStore = {
    note: ' 상점에 바로 반영돼요.',
    save: function (id, data) { return adminPost({ action: 'adminSave', id: id, product: data }).then(reloadAdmin).then(loadSellerItems); },
    remove: function (id) { return adminPost({ action: 'adminItemDelete', id: id }).then(reloadAdmin).then(loadSellerItems); }
  };
  // 샘플·운영 상품도 시트에 저장되어 상점에 바로 보인다
  function showOwn(res) { ownFromSheet = true; setProducts(ownRows(res.own || [])); }
  var ownStore = {
    note: ' 상점에 바로 반영돼요.',
    save: function (id, data) { return adminPost({ action: 'adminOwnSave', id: id, product: data }).then(showOwn); },
    remove: function (id) { return adminPost({ action: 'adminOwnDelete', id: id }).then(showOwn); }
  };
  function reloadAdmin() {
    return adminPost({ action: 'adminList' }).then(function (res) {
      adminData = { items: res.items || [], sellers: res.sellers || [] };
      if (mode === 'admin') renderAdminList();
    });
  }

  function setupPanels() {
    var panel = $('#admin'), signup = $('#seller-signup');
    var views = ['#login-seller', '#login-admin', '#seller-signup', '#admin-tabs', '#admin-list-wrap', '#product-form', '#gh-logout'];
    function show(view) {
      var on = {
        login: ['#login-seller'], adminLogin: ['#login-admin'], signup: ['#seller-signup'],
        seller: ['#admin-list-wrap', '#product-form', '#gh-logout'], admin: ['#admin-tabs', '#admin-list-wrap', '#product-form', '#gh-logout']
      }[view];
      views.forEach(function (v) { $(v).hidden = on.indexOf(v) < 0; });
      $('#panel-title').textContent = { login: '판매자 로그인', adminLogin: '사이트 관리자', signup: '판매자 되기',
        seller: '내 상품', admin: '사이트 관리자' }[view];
      refreshEntries();
      if (view === 'seller' || view === 'admin') resetForm();
    }
    function loginMsg(t, isErr) { var m = $('#gh-msg'); m.textContent = t; m.classList.toggle('err', !!isErr); }

    function enterSeller(nick) {
      mode = 'seller'; sellerNick = nick;
      loginMsg(''); say('');
      show('seller');
      return loadSellerItems().then(renderAdminList);
    }
    function openSeller(from) {
      openPanel(panel, from);
      if (mode === 'seller') return show('seller');
      if (!sellerKey()) { mode = ''; return show('login'); }
      loginMsg('확인하는 중이에요…');
      sellerPost({ action: 'sellerMe' }).then(function (res) { enterSeller(res.nick); })
        .catch(function (err) { keep(SELLER_KEY, ''); mode = ''; show('login'); loginMsg(writeError(err), true); });
    }
    function enterAdmin() {
      loginMsg('확인하는 중이에요…');
      return adminPost({ action: 'adminList' }).then(function (res) {
        showOwn(res);
        adminData = { items: res.items || [], sellers: res.sellers || [] };
        mode = 'admin'; sellerNick = '';
        loginMsg('');
        show('admin');
      }).catch(function (err) { keep(ADMIN_KEY, ''); mode = ''; show('adminLogin'); loginMsg(writeError(err), true); $('#admin-pw').focus(); });
    }
    function openAdmin(from) {
      openPanel(panel, from);
      if (!adminKey()) { mode = ''; show('adminLogin'); $('#admin-pw').focus(); return; }
      enterAdmin();
    }
    function showSignup() { if (sellerKey()) return openSeller(); openPanel(panel); mode = ''; loginMsg(''); show('signup'); }

    $('#seller-entry').addEventListener('click', function () {
      if (sellerKey()) return openSeller(this);
      openPanel(panel, this); mode = ''; loginMsg(''); show('login'); $('#l-id').focus();
    });
    $('#admin-entry').addEventListener('click', function () { openAdmin(this); });
    $('#open-admin').addEventListener('click', function () { openSeller(this); });
    $('#open-manage').addEventListener('click', function () { openAdmin(this); });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-seller-signup]')) showSignup();
      if (e.target.closest('[data-seller-login]')) openSeller();
    });

    $('#l-go').addEventListener('click', function () {
      var id = $('#l-id').value.trim().toLowerCase(), pw = $('#l-pw').value;
      if (!id || !pw) { loginMsg('아이디와 비밀번호를 적어 주세요.', true); return; }
      loginMsg('확인하는 중이에요…');
      api({ action: 'sellerLogin', loginId: id, password: pw }).then(function (res) {
        keep(SELLER_KEY, res.key);
        $('#l-pw').value = '';
        enterSeller(res.nick);
      }).catch(function (err) { loginMsg(writeError(err), true); });
    });
    $('#l-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#l-go').click(); });
    // 판매자 되기(가입)를 마치면 바로 로그인된다
    document.addEventListener('seller-login', function (e) {
      keep(SELLER_KEY, e.detail.key);
      sellerPost({ action: 'sellerMe' }).then(function (res) { enterSeller(res.nick); say('가입을 마쳤어요. 첫 상품을 올려 보세요.'); })
        .catch(function (err) { show('login'); loginMsg(writeError(err), true); });
    });

    $('#admin-go').addEventListener('click', function () {
      var t = $('#admin-pw').value.trim();
      if (!t) { loginMsg('관리자 비밀번호를 적어 주세요.', true); return; }
      $('#admin-pw').value = '';
      keep(ADMIN_KEY, t);
      enterAdmin();
    });
    $('#admin-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#admin-go').click(); });
    $('#admin-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]'); if (!b) return;
      adminTab = b.dataset.tab;
      document.querySelectorAll('#admin-tabs button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      say('');
      resetForm();
    });
    // 판매자 로그인과 관리자 로그인은 따로 유지된다. 로그아웃은 지금 보고 있는 쪽만 한다.
    function logout(which) {
      var wasAdmin = which ? which === 'admin' : mode === 'admin';
      keep(wasAdmin ? ADMIN_KEY : SELLER_KEY, '');
      mode = ''; sellerNick = '';
      show(wasAdmin ? 'adminLogin' : 'login');
      loginMsg('로그아웃했어요.');
    }
    $('#gh-logout').addEventListener('click', function () { logout(); });

    $('#seller-out').addEventListener('click', function () { logout('seller'); });

    if (location.hash === '#seller') showSignup();
    refreshEntries();
  }

  // 버튼 역할: 판매자 되기 = 가입, 판매자 로그인 = 들어가기(로그아웃 상태에서만 보임), 내 상품 = 로그인한 판매자의 상품 올리기·고치기
  function refreshEntries() {
    var seller = !!sellerKey(), admin = !!adminKey();
    $('#open-admin').hidden = !seller;
    $('#open-admin').textContent = '내 상품';
    $('#open-manage').hidden = !admin;
    $('#signup-entry').hidden = seller;
    $('#seller-entry').hidden = seller;
    $('#seller-out').hidden = !seller;
  }

  // ---------- 시작 ----------
  renderCart();

  if (!window.claude || !window.claude.use) {
    fetch('products.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!ownFromSheet) setProducts(ownRows(j.products));   // 시트 목록이 먼저 왔으면 그쪽이 최신이다
    }).catch(function () { if (!loaded) status.textContent = '상품 목록을 불러오지 못했어요.'; });
    setupPanels();
    return;
  }

  // 로그인하지 않은 손님도 볼 수 있도록 공개 파일(products.json)을 먼저 읽는다
  fetch('products.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (dbLive || !j || !Array.isArray(j.products)) return;
    setProducts(j.products.map(function (p) { return { id: p.id, data: p }; }));
  }).catch(function () {});

  window.claude.use('db').then(function (d) {
    db = d;
    if (!db) return;
    col = db.collection('products');
    store = {
      save: function (id, data) { return id ? col.doc(id).set(data) : col.add(data); },
      remove: function (id) { return col.doc(id).delete(); },
      afterWrite: syncPublic
    };
    col.orderBy('order').onSnapshot(function (snap) {
      // 저장소를 읽을 수 없는 손님에게는 빈 목록이 오므로 공개 파일 목록을 그대로 둔다
      if (snap.empty && !dbLive) return;
      dbLive = true;
      setProducts(snap.docs.map(function (doc) { return { id: doc.id, data: doc.data() || {} }; }));
    }, function () {});
  });

  window.claude.use('artifact').then(function (a) { artifactApi = a; });

  window.claude.use('user').then(function (u) {
    if (!u) return;
    return u.canEdit().then(function (ok) { if (ok) $('#open-admin').hidden = false; });
  }).catch(function () {});
})();
