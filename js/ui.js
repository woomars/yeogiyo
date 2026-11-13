// 화면 그리기. 방장이 보내 준 view만 보고 그린다.
(function (root) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const SCREENS = ['start', 'rules', 'join', 'lobby', 'game', 'result'];
  const handlers = {};
  const emit = (event, arg) => (handlers[event] || []).forEach((fn) => fn(arg));
  const { t } = root.I18n;

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  // 봇 이름은 방장이 정한 한국어 이름 대신 각자 화면 언어로 보여 준다.
  const display = (p) => (p.botLevel && p.botNo ? t('bot.name', { n: p.botNo, level: t('level.' + p.botLevel) }) : p.name);
  const nameOf = (view, id) => {
    const p = view.players.find((x) => x.id === id);
    return p ? display(p) : '?';
  };

  // ---- 시간 표시: 받은 시각부터 화면에서 직접 줄여 나간다 ----
  let clockView = null;
  let clockAt = 0;
  setInterval(() => { if (clockView) drawClock(); }, 250);

  function drawClock() {
    const v = clockView;
    const passed = performance.now() - clockAt;
    const running = v.phase === 'playing' || v.phase === 'judging' || v.phase === 'result';
    if (v.remainingMs === null) $('#timer').textContent = '';
    else {
      const ms = Math.max(0, v.remainingMs - (running ? passed : 0));
      const s = Math.ceil(ms / 1000);
      $('#timer').textContent = t('game.timer', { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` });
    }
    if (v.phase === 'paused' && v.paused) {
      const left = Math.max(0, Math.ceil((v.paused.msLeft - passed) / 1000));
      showBanner(esc(t('game.paused', { name: nameOf(v, v.paused.playerId), s: left })));
    }
  }

  function showBanner(html) {
    const b = $('#banner');
    b.innerHTML = html;
    b.hidden = false;
  }

  function resultHtml(view) {
    const r = view.result;
    const lines = [];
    if (r.winnerId) {
      const name = nameOf(view, r.winnerId);
      let text;
      if (r.gapMs === null) text = t('game.correct', { name });
      else if (r.gapMs < 10) text = t('game.firstByHair', { name });
      else text = t('game.firstBy', { name, gap: (r.gapMs / 1000).toFixed(2) });
      lines.push(`<span class="ok">${esc(text)}</span>`);
    }
    if (r.wrongIds.length) {
      lines.push(esc(t('game.wrong', { names: r.wrongIds.map((id) => nameOf(view, id)) })));
    }
    return lines.join('<br>');
  }

  // ---- 공개 함수 ----

  function show(screen) {
    for (const s of SCREENS) $('#screen-' + s).hidden = s !== screen;
    if (screen !== 'game') clockView = null;
  }

  function setRole(view) {
    const isHost = view.me === view.hostId;
    document.body.classList.toggle('is-host', isHost);
    document.body.classList.toggle('is-guest', !isHost);
  }

  let lastQr = null;
  function renderLobby(view, code, qrUrl) {
    setRole(view);
    if (code) $('#lobby-code').textContent = code;
    if (qrUrl && qrUrl !== lastQr && root.qrcode) {
      const q = root.qrcode(0, 'M');
      q.addData(qrUrl);
      q.make();
      $('#qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      lastQr = qrUrl;
    }
    const isHost = view.me === view.hostId;
    const rows = view.players.map((p) => {
      const level = p.botLevel ? t('level.' + p.botLevel) : p.bot;
      let tag = t('lobby.ready');
      if (p.id === view.hostId) tag = t('lobby.host');
      else if (p.bot) tag = t('lobby.botTag', { level });
      else if (!p.connected) tag = t('lobby.away');
      let tail = `<small>${esc(tag)}</small>`;
      if (p.bot && isHost) tail += `<button class="x" data-act="remove-bot" data-id="${esc(p.id)}" aria-label="${esc(t('lobby.remove', { name: display(p) }))}">✕</button>`;
      return `<li><span class="dot" style="background:${p.color}"></span>${esc(display(p))}${p.id === view.me ? esc(t('lobby.me')) : ''}${tail}</li>`;
    });
    for (let i = view.players.length; i < 4; i++) rows.push(`<li class="empty">${esc(t('lobby.empty'))}</li>`);
    $('#lobby-players').innerHTML = rows.join('');
    const n = view.players.length;
    document.querySelectorAll('#bot-add .chip').forEach((b) => { b.disabled = n >= 4; });
    const btn = $('#start-btn');
    btn.textContent = t('lobby.startN', { n });
    btn.disabled = n < 2;
  }

  let lastTops = {};
  function renderGame(view) {
    setRole(view);
    const board = $('#board');
    const n = view.players.length;
    board.classList.toggle('two', n === 2);
    const cells = view.players.map((p) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (p.id === view.me) cell.classList.add('me');
      if (p.isTurn) cell.classList.add('turn');
      if (p.out) cell.classList.add('out');
      let tag = '';
      if (p.removed) tag = ' · ' + t('game.tagLeft');
      else if (!p.connected) tag = ' · ' + t('game.tagDisconnected');
      else if (p.out) tag = ' · ' + t('game.tagOut');
      cell.innerHTML = `<div class="who"><b>${esc(display(p))}${p.id === view.me ? esc(t('game.me')) : ''}</b> · ${esc(t('game.cards', { n: p.count }))}<span class="tag">${esc(tag)}</span></div>`;
      const card = root.Cards.render(p.top);
      const key = p.top ? p.top.menu + p.top.count : '';
      if (key && lastTops[p.id] !== undefined && lastTops[p.id] !== key) card.classList.add('pop');
      lastTops[p.id] = key;
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.appendChild(card);
      cell.appendChild(slot);
      return cell;
    });
    if (n === 3) {
      const blank = document.createElement('div');
      blank.className = 'cell blank';
      cells.push(blank);
    }
    board.replaceChildren(...cells);

    const me = view.players.find((p) => p.id === view.me) || {};
    const turn = view.players.find((p) => p.isTurn);
    const flip = $('#flip-btn');
    const myTurn = !!me.isTurn && view.phase === 'playing';
    flip.disabled = !myTurn;
    flip.textContent = myTurn ? t('game.flipMine') : turn ? t('game.turnOf', { name: display(turn) }) : t('game.wait');
    $('#bell').disabled = !(view.phase === 'playing' || view.phase === 'judging') || me.out || me.removed;

    $('#banner').hidden = true;
    if (view.phase === 'result' && view.result) showBanner(resultHtml(view));
    clockView = view;
    clockAt = performance.now();
    drawClock();
  }

  function renderResult(view) {
    setRole(view);
    const ranked = view.players.filter((p) => !p.removed).slice().sort((a, b) => b.count - a.count);
    $('#ranking').innerHTML = ranked.map((p, i) => `<li><span class="rank">${i + 1}</span>`
      + `<span class="dot" style="background:${p.color};width:12px;height:12px;border-radius:50%"></span>${esc(display(p))}`
      + `${view.winners.includes(p.id) ? ` <span class="badge">${esc(t('result.winner'))}</span>` : ''}<small>${esc(t('result.cards', { n: p.count }))}</small></li>`).join('');
  }

  let toastTimer = null;
  function toast(text, ms = 2000) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  let retryFn = null;
  function error(text, opts = {}) {
    $('#error-text').textContent = text;
    retryFn = opts.retry || null;
    $('#error-retry').hidden = !retryFn;
    $('#error').hidden = false;
  }

  function bellPressed() {
    const b = $('#bell');
    b.classList.add('pressed');
    setTimeout(() => b.classList.remove('pressed'), 140);
  }

  function on(event, fn) {
    (handlers[event] = handlers[event] || []).push(fn);
  }

  function setMessage(screen, text) {
    const el = $(screen === 'join' ? '#join-msg' : '#start-msg');
    if (el) el.textContent = text || '';
  }

  // ---- 입력 연결 ----

  function codeValue() {
    return $('#code').value.replace(/\D/g, '').slice(0, 4);
  }

  function drawDigits() {
    const v = codeValue();
    $('#code').value = v;
    document.querySelectorAll('.boxes span').forEach((s, i) => {
      s.textContent = v[i] || '';
      s.classList.toggle('cur', i === Math.min(v.length, 3));
    });
  }

  function bind() {
    document.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-lang]');
      if (pick) return emit('lang', pick.dataset.lang);
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      const act = btn.dataset.act;
      if (act === 'join-submit') emit('join-submit', codeValue());
      else if (act === 'start') emit('start', $('#time-limit').checked);
      else if (act === 'add-bot') emit('add-bot', btn.dataset.level);
      else if (act === 'remove-bot') emit('remove-bot', btn.dataset.id);
      else emit(act);
    });
    $('#name').addEventListener('input', (e) => emit('name-change', e.target.value));
    const code = $('#code');
    code.addEventListener('input', drawDigits);
    code.addEventListener('focus', () => code.parentElement.classList.add('focus'));
    code.addEventListener('blur', () => code.parentElement.classList.remove('focus'));
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') emit('join-submit', codeValue());
    });
    $('#bell').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if ($('#bell').disabled) return;
      bellPressed();
      emit('bell');
    });
    $('#bell').addEventListener('contextmenu', (e) => e.preventDefault());
    $('#error-ok').addEventListener('click', () => { $('#error').hidden = true; });
    $('#error-retry').addEventListener('click', () => {
      $('#error').hidden = true;
      if (retryFn) retryFn();
    });
    drawExamples();
    drawDigits();
  }

  // 규칙 화면의 예시 카드
  function drawExamples() {
    $('#ex-a').replaceWith(Object.assign(root.Cards.render({ menu: 'gimbap', count: 2 }), { className: 'card ex-card', id: 'ex-a' }));
    $('#ex-b').replaceWith(Object.assign(root.Cards.render({ menu: 'gimbap', count: 3 }), { className: 'card ex-card', id: 'ex-b' }));
  }

  // 언어를 바꾼 뒤 정적 글자와 예시 카드를 다시 그린다.
  function setLang(lang) {
    root.I18n.setLang(lang);
    drawExamples();
  }

  function clearCode() {
    $('#code').value = '';
    drawDigits();
  }

  bind();

  root.UI = {
    show, renderLobby, renderGame, renderResult, toast, error, bellPressed, on, setMessage, clearCode, setLang,
    focusCode: () => $('#code').focus(),
    setName: (name) => { $('#name').value = name; },
    getName: () => $('#name').value,
  };
})(this);
