// 무엇이든 상점: 상품 목록(공유 저장소), 장바구니, 분류 필터, 상품 관리
(function () {
  var CART_KEY = 'anything-shop-cart';
  var won = function (n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; };
  var $ = function (s) { return document.querySelector(s); };

  var products = {};     // id -> {name, seller, cat, price, desc, unit, order}
  var order = [];        // 화면에 보일 순서대로 id
  var loaded = false;
  var currentCat = 'all';
  var db = null, col = null, dbLive = false, artifactApi = null, syncTimer = null;
  var store = null;      // 상품 저장 방식: Claude 저장소(db) 또는 GitHub(products.json)

  function setProducts(rows) {
    products = {}; order = [];
    rows.forEach(function (row) {
      var d = row.data;
      if (!d || typeof d.name !== 'string' || !d.name) return;
      products[row.id] = {
        name: d.name, seller: String(d.seller || ''), cat: String(d.cat || '기타'), price: Number(d.price) || 0,
        desc: String(d.desc || ''), unit: String(d.unit || ''), order: Number(d.order) || 0
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
      var q = cart[b.dataset.add];
      b.classList.toggle('added', !!q);
      b.textContent = q ? '담김 ' + q : '담기';
    });
  }

  function changeCart(id, d) {
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
      li.querySelector('.kind').textContent = p.cat;
      li.querySelector('.detail-link').textContent = p.name;
      var sel = li.querySelector('.seller');
      sel.textContent = p.seller ? '판매자 ' + p.seller : '';
      sel.hidden = !p.seller;
      li.querySelector('.desc').textContent = p.desc || '';
      li.querySelector('.unit').textContent = p.unit || '';
      li.querySelector('.price').textContent = won(p.price);
      li.querySelector('.add').dataset.add = id;
      li.hidden = currentCat !== 'all' && p.cat !== currentCat;
      grid.appendChild(li);
    });
    if (loaded) status.textContent = order.length ? '' : '아직 등록된 상품이 없어요.';
    renderCats();
    renderCart();
    renderAdminList();
  }

  function catsInUse() {
    var seen = [];
    order.forEach(function (id) { var c = products[id].cat; if (c && seen.indexOf(c) < 0) seen.push(c); });
    return seen;
  }

  function renderCats() {
    var box = $('#cats'), cats = catsInUse();
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
    $('#d-kind').textContent = p.cat;
    $('#d-name').textContent = p.name;
    $('#d-seller').textContent = p.seller ? '판매자 ' + p.seller : '';
    $('#d-seller').hidden = !p.seller;
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
  // 주문은 판매자의 구글 시트로 보낸다(settings.json의 orderUrl). 결제는 계좌 입금.
  var settings = { orderUrl: '', bank: {} };
  fetch('settings.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j) settings = j; applyOpen(); }).catch(function () {});

  // settings.json의 open이 false면 "오픈 준비 중" 안내를 띄우고 주문을 받지 않는다
  function isOpen() { return settings.open !== false && !!settings.orderUrl; }
  function applyOpen() { $('#notice').hidden = settings.open !== false; }

  var orderForm = $('#order-form'), oMsg = $('#o-msg');
  function oSay(t, isErr) { oMsg.textContent = t; oMsg.classList.toggle('err', !!isErr); }

  function cartLines() {
    return Object.keys(cart).filter(function (id) { return products[id]; }).map(function (id) {
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
      li.querySelector('.meta').textContent = won(l.price) + ' × ' + l.qty + (l.seller ? ' · 판매자 ' + l.seller : '');
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
        var b = settings.bank || {};
        $('#r-no').textContent = res.orderNo;
        $('#r-total').textContent = won(res.total);
        $('#r-bank').textContent = b.account ? (b.name + ' ' + b.account + ' (' + b.holder + ')') : '판매자가 연락드려 알려 드려요';
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

  // ---------- 상품 관리 (편집 권한이 있는 사람에게만 보임) ----------
  var form = $('#product-form'), msg = $('#form-msg'), editingId = null;
  var adminList = $('#admin-list');

  function say(text, isErr) { msg.textContent = text; msg.classList.toggle('err', !!isErr); }

  function startEdit(id) {
    var p = products[id]; if (!p) return;
    editingId = id;
    form.name.value = p.name; form.seller.value = p.seller || ''; form.cat.value = p.cat; form.price.value = p.price;
    form.unit.value = p.unit || ''; form.desc.value = p.desc || '';
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

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!store) return;
    var data = {
      name: form.name.value.trim(),
      seller: form.seller.value.trim(),
      cat: form.cat.value.trim(),
      price: Math.round(Number(form.price.value)),
      unit: form.unit.value.trim(),
      desc: form.desc.value.trim()
    };
    if (!data.name) { say('상품 이름을 적어 주세요.', true); form.name.focus(); return; }
    if (!data.cat) { say('분류를 적어 주세요.', true); form.cat.focus(); return; }
    if (form.price.value === '' || !(data.price >= 0)) { say('가격을 0 이상의 숫자로 적어 주세요.', true); form.price.focus(); return; }

    var saveBtn = $('#f-save'); saveBtn.disabled = true;
    var wasEdit = !!editingId;
    var job;
    if (wasEdit) {
      data.order = products[editingId] ? products[editingId].order : Date.now();
      job = store.save(editingId, data);
    } else {
      var max = 0; order.forEach(function (id) { max = Math.max(max, products[id].order || 0); });
      data.order = max + 10;
      job = store.save(null, data);
    }
    job.then(function () {
      resetForm();
      say((wasEdit ? '"' + data.name + '" 수정을 저장했어요.' : '"' + data.name + '"을(를) 등록했어요.') + (store.note || ''));
      if (store.afterWrite) store.afterWrite();
    }).catch(function (err) {
      say(writeError(err), true);
    }).then(function () { saveBtn.disabled = false; });
  });

  function writeError(err) {
    var c = err && err.code;
    if (err && err.status === 401) return 'GitHub 열쇠(토큰)가 맞지 않아요. 관리자 로그인을 다시 해 주세요.';
    if (err && (err.status === 403 || err.status === 404)) return '이 열쇠(토큰)로는 저장소에 쓸 수 없어요. anything-shop 저장소의 Contents 쓰기 권한을 확인해 주세요.';
    if (err && err.status === 409) return '다른 곳에서 먼저 저장했어요. 다시 한 번 눌러 주세요.';
    if (c === 'invalid_argument') return '저장할 권한이 없어요. 이 페이지의 편집자만 상품을 바꿀 수 있어요.';
    if (c === 'quota_exceeded') return '저장 공간이 가득 찼어요. 쓰지 않는 상품을 지운 뒤 다시 해 주세요.';
    return '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
  }

  function renderAdminList() {
    $('#admin-count').textContent = order.length;
    adminList.innerHTML = '';
    order.forEach(function (id) {
      var p = products[id];
      var li = document.createElement('li');
      li.dataset.id = id;
      if (id === editingId) li.className = 'editing';
      li.innerHTML = '<span class="a-name"></span><span class="a-actions"><button type="button" data-edit>수정</button><button type="button" class="del" data-del>삭제</button></span><span class="a-meta"></span>';
      li.querySelector('.a-name').textContent = p.name;
      li.querySelector('.a-meta').textContent = (p.seller ? p.seller + ' · ' : '') + p.cat + ' · ' + won(p.price) + (p.unit ? ' · ' + p.unit : '');
      adminList.appendChild(li);
    });
  }

  adminList.addEventListener('click', function (e) {
    var li = e.target.closest('li'); if (!li) return;
    var id = li.dataset.id;
    if (e.target.closest('[data-edit]')) { startEdit(id); return; }
    var del = e.target.closest('[data-del]');
    if (del) {
      // 한 번 더 눌러야 지워진다
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm'); del.textContent = '정말 삭제';
        setTimeout(function () { if (del.isConnected) { del.classList.remove('confirm'); del.textContent = '삭제'; } }, 3000);
        return;
      }
      var name = products[id] ? products[id].name : '';
      del.disabled = true;
      store.remove(id).then(function () {
        if (editingId === id) resetForm();
        say('"' + name + '"을(를) 삭제했어요.' + (store.note || ''));
        if (store.afterWrite) store.afterWrite();
      }).catch(function (err) { del.disabled = false; say(writeError(err), true); });
    }
  });

  // ---------- 내 웹사이트(GitHub Pages)용 상품 관리 ----------
  // 상품은 저장소의 products.json에 있다. 관리자는 GitHub 열쇠(토큰)로 로그인해서 이 파일을 직접 고친다.
  // 열쇠는 관리자 브라우저에만 저장되고 다른 곳으로 보내지 않는다(GitHub 말고는).
  var GH = { owner: 'ljh0283ljh0283ljh0283-blip', repo: 'anything-shop', path: 'products.json', branch: 'main' };
  var TOKEN_KEY = 'anything-shop-gh-token', ghSha = null;

  function ghToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function ghApi(method, body) {
    var url = 'https://api.github.com/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path +
      (method === 'GET' ? '?ref=' + GH.branch + '&t=' + Date.now() : '');
    return fetch(url, {
      method: method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + ghToken(), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
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
  function ghWrite(list, message) {
    var text = JSON.stringify({ products: list }, null, 1) + '\n';
    return ghApi('PUT', { message: message, content: btoa(unescape(encodeURIComponent(text))), sha: ghSha, branch: GH.branch })
      .then(function (j) { ghSha = j.content && j.content.sha; });
  }
  // 저장할 때마다 최신 파일을 다시 읽고 고친 뒤 올린다
  function ghChange(fn, message) {
    return ghLoad().then(function (list) {
      list = fn(list);
      return ghWrite(list, message).then(function () {
        setProducts(list.map(function (p) { return { id: p.id, data: p }; }));
      });
    });
  }

  function setupGitHubAdmin() {
    var login = $('#gh-login'), entry = $('#admin-entry');
    if (!login || !entry) return;
    entry.hidden = false;
    store = {
      note: ' 사이트에는 1~2분 뒤에 반영돼요.',
      save: function (id, data) {
        return ghChange(function (list) {
          if (id) {
            return list.map(function (p) { return p.id === id ? Object.assign({ id: id }, data) : p; });
          }
          var newId = 'p' + Date.now().toString(36);
          return list.concat([Object.assign({ id: newId }, data)]);
        }, (id ? '상품 수정: ' : '상품 등록: ') + data.name);
      },
      remove: function (id) {
        var name = products[id] ? products[id].name : id;
        return ghChange(function (list) { return list.filter(function (p) { return p.id !== id; }); }, '상품 삭제: ' + name);
      }
    };

    function showLoggedIn(on) {
      login.hidden = on;
      $('#product-form').hidden = !on;
      $('#admin-list-wrap').hidden = !on;
      $('#gh-logout').hidden = !on;
      $('#open-admin').hidden = !on;
    }
    function tryLogin() {
      var msg = $('#gh-msg');
      msg.textContent = '확인하는 중이에요…'; msg.classList.remove('err');
      return ghLoad().then(function (list) {
        setProducts(list.map(function (p) { return { id: p.id, data: p }; }));
        msg.textContent = '';
        showLoggedIn(true);
      }).catch(function (err) {
        showLoggedIn(false);
        msg.textContent = writeError(err); msg.classList.add('err');
      });
    }

    entry.addEventListener('click', function () {
      openPanel($('#admin'), entry);
      if (ghToken()) tryLogin(); else showLoggedIn(false);
    });
    $('#gh-save').addEventListener('click', function () {
      var t = $('#gh-token').value.trim();
      if (!t) { $('#gh-msg').textContent = '열쇠(토큰)를 붙여 넣어 주세요.'; $('#gh-msg').classList.add('err'); return; }
      try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
      $('#gh-token').value = '';
      tryLogin();
    });
    $('#gh-logout').addEventListener('click', function () {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      showLoggedIn(false);
      $('#gh-msg').textContent = '로그아웃했어요.'; $('#gh-msg').classList.remove('err');
    });
    if (ghToken()) { $('#open-admin').hidden = false; }
    $('#open-admin').addEventListener('click', function () { if (ghToken()) tryLogin(); });
  }

  // ---------- 시작 ----------
  renderCart();

  if (!window.claude || !window.claude.use) {
    fetch('products.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      setProducts(j.products.map(function (p) { return { id: p.id, data: p }; }));
    }).catch(function () { status.textContent = '상품 목록을 불러오지 못했어요.'; });
    setupGitHubAdmin();
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
