// 「여기요!」 게임 규칙. DOM과 네트워크에 의존하지 않는다.
(function (root) {
  'use strict';

  const MENUS = ['gimbap', 'mandu', 'tteok', 'eomuk'];
  const COUNT_DIST = { 1: 5, 2: 3, 3: 3, 4: 2, 5: 1 };

  function createDeck() {
    const deck = [];
    for (const menu of MENUS) {
      for (const count of [1, 2, 3, 4, 5]) {
        for (let i = 0; i < COUNT_DIST[count]; i++) deck.push({ menu, count });
      }
    }
    return deck;
  }

  function shuffle(cards, rng) {
    const out = cards.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function newGame(playerIds, rng) {
    const deck = shuffle(createDeck(), rng);
    const n = playerIds.length;
    const each = Math.floor(deck.length / n);
    const players = playerIds.map((id, i) => ({
      id, deck: deck.slice(i * each, (i + 1) * each), pile: [], out: false, removed: false,
    }));
    return {
      players,
      center: deck.slice(n * each),
      turn: Math.floor(rng() * n),
      version: 0,
      since: 0,
      five: { 0: false },
      fiveStart: null,
      over: false,
      winners: [],
    };
  }

  function topCards(state) {
    return state.players.map((p) => (p.removed || p.pile.length === 0 ? null : p.pile[p.pile.length - 1]));
  }

  function hasFive(cards) {
    const sums = {};
    for (const k of cards) if (k) sums[k.menu] = (sums[k.menu] || 0) + k.count;
    return Object.values(sums).some((v) => v === 5);
  }

  const cardCount = (p) => p.deck.length + p.pile.length;
  const isActive = (p) => !p.out && !p.removed;
  const indexOf = (state, id) => state.players.findIndex((p) => p.id === id);

  // 보드가 바뀔 때마다 판 번호를 올리고 합 5 여부를 기록한다.
  function bump(state) {
    state.version += 1;
    const five = hasFive(topCards(state));
    state.five[state.version] = five;
    if (!five) state.fiveStart = null;
    else if (state.fiveStart === null) state.fiveStart = state.version;
  }

  function checkOver(state) {
    if (state.over) return;
    const active = state.players.filter(isActive);
    if (active.length <= 1) {
      state.over = true;
      state.winners = active.map((p) => p.id);
    }
  }

  // 다음 차례로 넘긴다. 카드가 없는 사람에게 차례가 오면 탈락시키고 건너뛴다.
  function advanceTurn(state, from = state.turn) {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      // 한 명만 남았으면 그 사람이 이긴다. 그 사람까지 탈락시키지 않는다.
      if (state.players.filter(isActive).length <= 1) return;
      const i = (from + step) % n;
      const p = state.players[i];
      if (!isActive(p)) continue;
      if (p.deck.length === 0) { p.out = true; continue; }
      state.turn = i;
      return;
    }
  }

  // 지정한 사람부터 차례를 시작한다. 그 사람이 뛸 수 없으면 다음 사람으로.
  function setTurn(state, index) {
    const p = state.players[index];
    if (isActive(p) && p.deck.length > 0) state.turn = index;
    else advanceTurn(state, index);
  }

  function flip(state, playerId) {
    if (state.over) return { ok: false, reason: 'over' };
    const i = indexOf(state, playerId);
    if (i !== state.turn) return { ok: false, reason: 'not-turn' };
    const p = state.players[i];
    p.pile.push(p.deck.shift());
    bump(state);
    advanceTurn(state);
    checkOver(state);
    return { ok: true };
  }

  const isValidFive = (state, version) => version >= state.since && state.five[version] === true;
  const isStale = (state, version) => version < state.since;

  function collect(state, winnerId) {
    const i = indexOf(state, winnerId);
    const winner = state.players[i];
    for (const p of state.players) {
      winner.deck.push(...p.pile);
      p.pile = [];
    }
    winner.deck.push(...state.center);
    state.center = [];
    bump(state);
    state.since = state.version;
    state.five = { [state.version]: false };
    state.fiveStart = null;
    setTurn(state, i);
    checkOver(state);
  }

  // 틀린 벨: 자기 다음 순서부터 탈락하지 않은 사람에게 한 장씩 준다.
  function penalize(state, playerId) {
    const i = indexOf(state, playerId);
    const p = state.players[i];
    const n = state.players.length;
    const got = [];
    for (let step = 1; step < n && p.deck.length > 0; step++) {
      const q = state.players[(i + step) % n];
      if (!isActive(q)) continue;
      q.deck.push(p.deck.shift());
      got.push(q.id);
    }
    if (p.deck.length === 0) {
      p.out = true;
      if (state.turn === i) advanceTurn(state);
    }
    checkOver(state);
    return got;
  }

  function removePlayer(state, playerId) {
    const i = indexOf(state, playerId);
    const p = state.players[i];
    p.out = true;
    p.removed = true;
    const others = state.players.filter(isActive);
    const each = others.length ? Math.floor(p.deck.length / others.length) : 0;
    for (const q of others) q.deck.push(...p.deck.splice(0, each));
    state.center.push(...p.deck, ...p.pile);
    p.deck = [];
    p.pile = [];
    bump(state);
    if (state.turn === i) advanceTurn(state);
    checkOver(state);
  }

  // 멈췄다가 다시 시작할 때: 보드는 그대로지만 새 판 번호로 반응 시간을 다시 잰다.
  function refresh(state) {
    state.fiveStart = null;
    bump(state);
  }

  function timeUp(state) {
    state.over = true;
    const active = state.players.filter(isActive);
    const best = Math.max(...active.map(cardCount));
    state.winners = active.filter((p) => cardCount(p) === best).map((p) => p.id);
  }

  const api = {
    MENUS, createDeck, shuffle, newGame, topCards, hasFive, flip, cardCount,
    isValidFive, isStale, collect, penalize, removePlayer, timeUp, refresh,
  };
  api._internal = { bump, checkOver, advanceTurn, setTurn, isActive, indexOf };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Game = api;
})(this);
