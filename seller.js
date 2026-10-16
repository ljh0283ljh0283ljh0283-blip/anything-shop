// 판매자 되기 신청서. <section id="seller-signup" data-shop="상점 이름" data-settings="settings.json 경로"> 안에 그린다.
// 신청은 settings.json의 orderUrl(구글 시트)로 보내고, 시트의 "판매자 신청" 탭에 쌓인다.
// 판매자 되기는 회원가입이다: 아이디와 비밀번호를 정하고, 가입하면 바로 로그인되어("seller-login" 이벤트) 상품을 올린다.
(function () {
  var box = document.getElementById('seller-signup');
  if (!box) return;
  var shop = box.dataset.shop || '무엇이든 상점';
  var url = '';
  fetch(box.dataset.settings || 'settings.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { url = j && j.orderUrl || ''; })
    .catch(function () {});

  var terms = box.dataset.terms || 'terms/';
  box.innerHTML =
    '<div class="su-intro">' +
      '<p>물건도, 재능도, 시간도 괜찮아요. 가입하면 바로 상품을 올릴 수 있고, 올린 상품은 곧바로 상점에 보여요.</p>' +
      '<ul class="su-points"><li>판매 수수료 없음</li><li>손님이 판매자 계좌로 직접 입금</li></ul>' +
    '</div>' +
    '<form class="form su-form" id="su-form" novalidate>' +
      '<label for="su-id">아이디</label><input id="su-id" name="loginId" maxlength="20" required autocomplete="username" autocapitalize="off" placeholder="한글·영어·숫자, 띄어쓰기 가능 2~20자">' +
      '<label for="su-pw">비밀번호</label><input id="su-pw" name="password" type="password" maxlength="64" required autocomplete="new-password" placeholder="영어와 숫자를 섞어 6자 이상">' +
      '<label for="su-pw2">비밀번호 확인</label><input id="su-pw2" name="password2" type="password" maxlength="64" required autocomplete="new-password">' +
      '<div class="row">' +
        '<div><label for="su-nick">상점에 보일 판매자 이름</label><input id="su-nick" name="nick" maxlength="20" required placeholder="예: 다육이네"></div>' +
        '<div><label for="su-name">실명</label><input id="su-name" name="name" maxlength="20" required autocomplete="name"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div><label for="su-phone">연락처</label><input id="su-phone" name="phone" maxlength="20" required inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></div>' +
        '<div><label for="su-email">이메일</label><input id="su-email" name="email" type="email" maxlength="60" required autocomplete="email" placeholder="아이디·비밀번호 찾기에 써요"></div>' +
      '</div>' +
      '<fieldset class="su-kind"><legend>판매자 구분</legend>' +
        '<label class="check"><input type="radio" name="kind" value="개인" checked> 개인</label>' +
        '<label class="check"><input type="radio" name="kind" value="사업자"> 사업자</label>' +
      '</fieldset>' +
      '<div id="su-biz-row" hidden><label for="su-biz">사업자등록번호</label><input id="su-biz" name="biz" maxlength="12" inputmode="numeric" placeholder="000-00-00000"></div>' +
      '<label for="su-what">팔고 싶은 것</label>' +
      '<textarea id="su-what" name="what" rows="3" maxlength="400" required placeholder="상품 이름, 내용, 생각한 가격이나 단위를 자유롭게 적어 주세요"></textarea>' +
      '<label>손님이 입금할 계좌 (본인 명의)</label>' +
      '<div class="su-bank">' +
        '<input id="su-bank" name="bank" maxlength="15" required placeholder="은행" aria-label="은행">' +
        '<input id="su-acct" name="acct" maxlength="30" required inputmode="numeric" placeholder="계좌번호" aria-label="계좌번호">' +
        '<input id="su-holder" name="holder" maxlength="20" required placeholder="예금주" aria-label="예금주">' +
      '</div>' +
      '<details class="su-privacy"><summary>개인정보 수집·이용 안내</summary>' +
        '<p>수집 항목: 판매자 이름, 실명, 연락처, 이메일, 사업자등록번호, 입금 계좌<br>' +
        '이용 목적: 판매자 확인과 연락, 아이디·비밀번호 찾기, 손님에게 입금 계좌 안내<br>' +
        '보관 기간: 판매를 그만두면 지체 없이 파기하고, 등록되지 않은 신청은 확인 후 바로 파기<br>' +
        '동의하지 않을 수 있지만, 그러면 판매자로 등록할 수 없어요.</p>' +
      '</details>' +
      '<label class="check"><input id="su-agree-terms" name="agreeTerms" type="checkbox" required> <span><a href="' + terms + '" target="_blank" rel="noopener">이용약관</a>에 동의해요</span></label>' +
      '<label class="check"><input id="su-agree-privacy" name="agreePrivacy" type="checkbox" required> 개인정보 수집·이용에 동의해요</label>' +
      '<p class="form-msg" id="su-msg" role="status"></p>' +
      '<button class="primary" id="su-submit" type="submit">가입하고 상품 올리기</button>' +
    '</form>';

  var form = document.getElementById('su-form'), msg = document.getElementById('su-msg');
  function say(t, isErr) { msg.textContent = t; msg.classList.toggle('err', !!isErr); }
  // 틀린 칸 바로 아래에 알려 주고 그 칸으로 옮겨 간다
  function bad(field, t) {
    say(t, true);
    var box = field.closest('.su-bank') || field, note = document.createElement('p');
    note.className = 'field-err'; note.textContent = t;
    box.insertAdjacentElement('afterend', note);
    field.scrollIntoView({ block: 'center' }); field.focus();
  }

  form.addEventListener('change', function (e) {
    if (e.target.name === 'kind') document.getElementById('su-biz-row').hidden = e.target.value !== '사업자';
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form;
    form.querySelectorAll('.field-err').forEach(function (n) { n.remove(); });
    var data = {
      type: 'seller', shop: shop, loginId: f.loginId.value.trim().replace(/\s+/g, ' ').toLowerCase(), password: f.password.value,
      nick: f.nick.value.trim(), realName: f.name.value.trim(), tel: f.phone.value.trim(), email: f.email.value.trim(),
      kind: f.kind.value, biz: f.kind.value === '사업자' ? f.biz.value.trim() : '',
      what: f.what.value.trim(), bank: f.bank.value.trim(), acct: f.acct.value.trim(), holder: f.holder.value.trim()
    };
    if (!/^[가-힣a-z0-9_ ]{2,20}$/.test(data.loginId)) { bad(f.loginId, '아이디는 한글, 영어, 숫자, 띄어쓰기로 2~20자로 적어 주세요. 기호는 쓸 수 없어요.'); return; }
    if (data.password.length < 6 || !/[a-zA-Z]/.test(data.password) || !/[0-9]/.test(data.password)) { bad(f.password, '비밀번호는 영어와 숫자를 섞어 6자 이상으로 적어 주세요.'); return; }
    if (data.password !== f.password2.value) { bad(f.password2, '비밀번호 확인이 맞지 않아요.'); return; }
    if (!data.nick) { bad(f.nick, '상점에 보일 판매자 이름을 적어 주세요.'); return; }
    if (!data.realName) { bad(f.name, '실명을 적어 주세요.'); return; }
    if (!/^[0-9+\-\s()]{8,20}$/.test(data.tel)) { bad(f.phone, '연락처를 숫자로 적어 주세요. 예: 010-1234-5678'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { bad(f.email, '아이디·비밀번호를 찾을 때 쓸 이메일을 적어 주세요.'); return; }
    if (data.kind === '사업자' && !/^[0-9\-]{10,12}$/.test(data.biz)) { bad(f.biz, '사업자등록번호를 적어 주세요.'); return; }
    if (!data.what) { bad(f.what, '팔고 싶은 것을 적어 주세요.'); return; }
    if (!data.bank || !data.acct || !data.holder) { bad(data.bank ? data.acct ? f.holder : f.acct : f.bank, '입금받을 계좌의 은행, 계좌번호, 예금주를 모두 적어 주세요.'); return; }
    if (!f.agreeTerms.checked || !f.agreePrivacy.checked) { say('이용약관과 개인정보 수집·이용에 동의해 주세요.', true); return; }
    if (!url) { say('지금은 가입을 받을 수 없어요. 잠시 뒤 다시 시도해 주세요.', true); return; }

    var btn = document.getElementById('su-submit'); btn.disabled = true;
    say('가입하는 중이에요…');
    // text/plain으로 보내야 구글 스크립트가 바로 받는다
    fetch(url, { method: 'POST', body: JSON.stringify(data) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && !res.ok && res.error) { say(res.error, true); return; }
        if (!res || !res.ok || !res.key) throw new Error('seller signup failed');
        form.reset(); say('');
        // 가입하면 바로 로그인해서 상품 등록 화면으로 간다
        document.dispatchEvent(new CustomEvent('seller-login', { detail: { key: res.key } }));
      })
      .catch(function () { say('가입하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', true); })
      .then(function () { btn.disabled = false; });
  });
})();
