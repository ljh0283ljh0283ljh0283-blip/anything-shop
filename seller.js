// 판매자 되기 신청서. <section id="seller-signup" data-shop="상점 이름" data-settings="settings.json 경로"> 안에 그린다.
// 신청은 settings.json의 orderUrl(구글 시트)로 보내고, 시트의 "판매자 신청" 탭에 쌓인다.
// 신청하면 바로 판매자 열쇠가 나오고, "seller-key" 이벤트로 상품 관리 창에 알려 바로 상품을 올리게 한다.
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
      '<p>물건도, 재능도, 시간도 괜찮아요. 신청하면 바로 판매자 열쇠가 나오고, 그 열쇠로 상품을 올리면 곧바로 상점에 보여요.</p>' +
      '<ul class="su-points"><li>판매 수수료 없음</li><li>손님이 판매자 계좌로 직접 입금</li></ul>' +
    '</div>' +
    '<form class="form su-form" id="su-form" novalidate>' +
      '<div class="row">' +
        '<div><label for="su-nick">상점에 보일 판매자 이름</label><input id="su-nick" name="nick" maxlength="20" required placeholder="예: 다육이네"></div>' +
        '<div><label for="su-name">실명</label><input id="su-name" name="name" maxlength="20" required autocomplete="name"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div><label for="su-phone">연락처</label><input id="su-phone" name="phone" maxlength="20" required inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></div>' +
        '<div><label for="su-email">이메일 (선택)</label><input id="su-email" name="email" type="email" maxlength="60" autocomplete="email"></div>' +
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
        '이용 목적: 판매자 확인과 연락, 손님에게 입금 계좌 안내<br>' +
        '보관 기간: 판매를 그만두면 지체 없이 파기하고, 등록되지 않은 신청은 확인 후 바로 파기<br>' +
        '동의하지 않을 수 있지만, 그러면 판매자로 등록할 수 없어요.</p>' +
      '</details>' +
      '<label class="check"><input id="su-agree-terms" name="agreeTerms" type="checkbox" required> <span><a href="' + terms + '" target="_blank" rel="noopener">이용약관</a>에 동의해요</span></label>' +
      '<label class="check"><input id="su-agree-privacy" name="agreePrivacy" type="checkbox" required> 개인정보 수집·이용에 동의해요</label>' +
      '<p class="form-msg" id="su-msg" role="status"></p>' +
      '<button class="primary" id="su-submit" type="submit">판매자 신청하기</button>' +
    '</form>' +
    '<div class="su-done" id="su-done" hidden>' +
      '<p class="r-title">판매자가 되셨어요</p>' +
      '<p>아래 판매자 열쇠로 내 상품을 올리고 고칠 수 있어요. 열쇠는 이 브라우저에 저장되지만, 다른 기기에서 쓰려면 꼭 적어 두세요.</p>' +
      '<p class="su-key"><span>판매자 열쇠</span><strong id="su-key"></strong></p>' +
      '<button class="primary" id="su-go" type="button">이 열쇠로 상품 올리기</button>' +
    '</div>';

  var form = document.getElementById('su-form'), msg = document.getElementById('su-msg'), lastKey = '';
  document.getElementById('su-go').addEventListener('click', function () {
    document.dispatchEvent(new CustomEvent('seller-key', { detail: { key: lastKey } }));
  });
  function say(t, isErr) { msg.textContent = t; msg.classList.toggle('err', !!isErr); }

  form.addEventListener('change', function (e) {
    if (e.target.name === 'kind') document.getElementById('su-biz-row').hidden = e.target.value !== '사업자';
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form;
    var data = {
      type: 'seller', shop: shop,
      nick: f.nick.value.trim(), realName: f.name.value.trim(), tel: f.phone.value.trim(), email: f.email.value.trim(),
      kind: f.kind.value, biz: f.kind.value === '사업자' ? f.biz.value.trim() : '',
      what: f.what.value.trim(), bank: f.bank.value.trim(), acct: f.acct.value.trim(), holder: f.holder.value.trim()
    };
    if (!data.nick) { say('상점에 보일 판매자 이름을 적어 주세요.', true); f.nick.focus(); return; }
    if (!data.realName) { say('실명을 적어 주세요.', true); f.name.focus(); return; }
    if (!/^[0-9+\-\s()]{8,20}$/.test(data.tel)) { say('연락처를 숫자로 적어 주세요. 예: 010-1234-5678', true); f.phone.focus(); return; }
    if (data.kind === '사업자' && !/^[0-9\-]{10,12}$/.test(data.biz)) { say('사업자등록번호를 적어 주세요.', true); f.biz.focus(); return; }
    if (!data.what) { say('팔고 싶은 것을 적어 주세요.', true); f.what.focus(); return; }
    if (!data.bank || !data.acct || !data.holder) { say('입금받을 계좌의 은행, 계좌번호, 예금주를 모두 적어 주세요.', true); (data.bank ? data.acct ? f.holder : f.acct : f.bank).focus(); return; }
    if (!f.agreeTerms.checked || !f.agreePrivacy.checked) { say('이용약관과 개인정보 수집·이용에 동의해 주세요.', true); return; }
    if (!url) { say('지금은 신청을 받을 수 없어요. 잠시 뒤 다시 시도해 주세요.', true); return; }

    var btn = document.getElementById('su-submit'); btn.disabled = true;
    say('신청을 보내는 중이에요…');
    // text/plain으로 보내야 구글 스크립트가 바로 받는다
    fetch(url, { method: 'POST', body: JSON.stringify(data) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && !res.ok && res.error) { say(res.error, true); return; }
        if (!res || !res.ok || !res.key) throw new Error('seller signup failed');
        form.hidden = true;
        box.querySelector('.su-intro').hidden = true;
        document.getElementById('su-key').textContent = res.key;
        document.getElementById('su-done').hidden = false;
        lastKey = res.key;
      })
      .catch(function () { say('신청을 보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', true); })
      .then(function () { btn.disabled = false; });
  });
})();
