// 핸드폰 한 대의 게임 상태. 화면에 판이 뜬 시각을 재서 벨의 반응 시간을 계산한다.
(function (root) {
  'use strict';

  const RING_PHASES = new Set(['playing', 'judging']);

  // 이전 화면과 새 화면을 비교해 낼 소리를 고른다. 같은 화면이 다시 와도 소리는 한 번만 난다.
  // iRang: 이번 판정에서 내가 벨을 눌렀는지(눌렀으면 이미 내 쪽에서 딩동이 났다).
  function cues(prev, view, iRang = false) {
    if (!prev) return [];
    const out = [];
    const id = view.me;
    const was = prev.players.find((p) => p.id === id);
    const now = view.players.find((p) => p.id === id);
    const entered = (phase) => prev.phase !== phase && view.phase === phase;

    if (prev.phase === 'lobby' && view.phase === 'lobby' && view.players.length > prev.players.length) out.push('join');
    if (prev.phase === 'lobby' && view.phase === 'playing') out.push('start');
    if (prev.phase === 'playing' && view.phase === 'playing' && view.version > prev.version) out.push('flip');
    if (prev.phase === 'playing' && view.phase === 'judging' && !iRang) out.push('ding');

    const becameOut = !!(was && now && !was.out && now.out && view.phase !== 'over');
    if (entered('result') && view.result) {
      const r = view.result;
      if (r.wrongIds.includes(id)) out.push(becameOut ? 'out' : 'buzz');
      else if (r.winnerId === id) out.push('collect');
      else if (r.winnerId) out.push('miss');
    } else if (becameOut) out.push('out');

    if (entered('paused')) out.push('pause');
    if (entered('over')) out.push(view.winners.includes(id) ? 'fanfare' : 'end');
    return out;
  }

  function create({
    send,
    onView,
    onWelcome = () => {},
    onReject = () => {},
    raf = (fn) => root.requestAnimationFrame(fn),
    now = () => root.performance.now(),
    sound = root.Sound,
  }) {
    let view = null;
    let playerId = null;
    let iRang = false;
    const renderedAt = {};

    function me() {
      return view && view.players.find((p) => p.id === view.me);
    }

    function receive(msg) {
      if (!msg) return;
      if (msg.t === 'welcome') {
        playerId = msg.playerId;
        onWelcome(msg);
      } else if (msg.t === 'reject') {
        onReject(msg.reason);
      } else if (msg.t === 'view') {
        const prev = view;
        view = msg.view;
        const v = view.version;
        // 새 판(대기실을 거치거나 판 번호가 처음으로 돌아감)이면 이전 판의 기록을 버린다.
        if (view.phase === 'lobby' || (prev && v < prev.version)) {
          for (const k of Object.keys(renderedAt)) delete renderedAt[k];
        }
        onView(view);
        // 화면이 실제로 그려진 다음 프레임의 시각을 그 판이 보인 시각으로 삼는다.
        raf(() => {
          if (renderedAt[v] === undefined) renderedAt[v] = now();
          for (const k of Object.keys(renderedAt)) if (k < v - 50) delete renderedAt[k];
        });
        for (const name of cues(prev, view, iRang)) {
          if (typeof sound[name] === 'function') sound[name]();
          if (name === 'buzz' || name === 'out') sound.vibrate(200);
        }
        if (!RING_PHASES.has(view.phase)) iRang = false;
      }
    }

    function flip() {
      const m = me();
      if (view && view.phase === 'playing' && m && m.isTurn) send({ t: 'flip' });
    }

    function ring() {
      const m = me();
      if (!view || !RING_PHASES.has(view.phase) || !m || m.out || m.removed) return;
      const t = now();
      const start = renderedAt[view.fiveStart] ?? renderedAt[view.version] ?? t;
      send({ t: 'ring', version: view.version, reactionMs: Math.max(0, t - start) });
      iRang = true;
      sound.ding();
      sound.vibrate(30);
    }

    return {
      receive,
      flip,
      ring,
      get view() { return view; },
      get playerId() { return playerId; },
    };
  }

  const api = { create, cues };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Client = api;
})(this);
