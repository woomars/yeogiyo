// 핸드폰 한 대의 게임 상태. 화면에 판이 뜬 시각을 재서 벨의 반응 시간을 계산한다.
(function (root) {
  'use strict';

  const RING_PHASES = new Set(['playing', 'judging']);

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
    let lastResult = null;
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
        if (view.phase === 'result' && view.result) {
          const key = JSON.stringify(view.result) + view.version;
          if (key !== lastResult) {
            lastResult = key;
            if (view.result.wrongIds.includes(view.me)) {
              sound.buzz();
              sound.vibrate(200);
            }
          }
        }
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

  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Client = api;
})(this);
