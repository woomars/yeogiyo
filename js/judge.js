// 벨 판정. 한 번의 판정 대기 시간 동안 모인 벨을 반응 시간으로 비교한다.
(function (root) {
  'use strict';

  function judge(presses, isValidFive) {
    const firstByPlayer = new Map();
    for (const p of [...presses].sort((a, b) => a.seq - b.seq)) {
      if (!firstByPlayer.has(p.playerId)) firstByPlayer.set(p.playerId, p);
    }
    const unique = [...firstByPlayer.values()];
    const right = unique
      .filter((p) => isValidFive(p.version))
      .sort((a, b) => a.reactionMs - b.reactionMs || a.seq - b.seq);
    const wrongIds = unique.filter((p) => !isValidFive(p.version)).map((p) => p.playerId);
    return {
      winnerId: right.length ? right[0].playerId : null,
      wrongIds,
      gapMs: right.length >= 2 ? Math.round(right[1].reactionMs - right[0].reactionMs) : null,
    };
  }

  const api = { judge };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Judge = api;
})(this);
