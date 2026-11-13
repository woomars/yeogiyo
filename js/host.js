// 방장 핸드폰에서 도는 게임 진행. 모든 상태와 판정을 여기서 갖는다.
// 시계, 난수, 전송 함수는 밖에서 넣어 주므로 Node에서 테스트할 수 있다.
(function (root) {
  'use strict';

  const Game = typeof require === 'function' ? require('./game.js') : root.Game;
  const Judge = typeof require === 'function' ? require('./judge.js') : root.Judge;

  const COLORS = ['#d7301f', '#2f7fd1', '#31a46b', '#e0a526'];
  const MAX_PLAYERS = 4;
  const TIMING = {
    JUDGE_WINDOW_MS: 300,
    RESULT_MS: 2000,
    RECONNECT_MS: 30000,
    TIME_LIMIT_MS: 420000,
  };
  // 시간 제한이 흐르는 단계. 대기실, 멈춤, 끝에서는 멈춘다.
  const CLOCK_PHASES = new Set(['playing', 'judging', 'result']);
  const MAX_WINDOW_MS = 1000;

  // 봇 난이도. 반응(ms)은 합 5가 나온 뒤 벨을 누르기까지, 놓침은 합 5를 못 보고 지나갈 확률,
  // 헛벨은 합이 4나 6일 때 잘못 누를 확률, 뒤집기(ms)는 자기 차례에 카드를 뒤집기까지.
  const BOT_LEVELS = {
    easy: { label: '하', react: [1100, 1700], miss: 0.25, wrong: 0.1, flip: [900, 1500] },
    normal: { label: '중', react: [750, 1100], miss: 0.08, wrong: 0.04, flip: [700, 1200] },
    hard: { label: '상', react: [450, 700], miss: 0, wrong: 0, flip: [600, 1000] },
  };
  const RTT_SAMPLES = 10;

  const randomToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const cleanName = (name) => String(name || '').trim().slice(0, 8) || '이름 없음';

  // 어느 메뉴든 합이 4나 6이면 헷갈리기 쉽다(헛벨을 누를 만한 판).
  function nearFive(cards) {
    const sums = {};
    for (const k of cards) if (k) sums[k.menu] = (sums[k.menu] || 0) + k.count;
    return Object.values(sums).some((v) => v === 4 || v === 6);
  }

  class HostSession {
    constructor({ hostPeerId, rng, clock, send, makeToken = randomToken }) {
      this.hostPeerId = hostPeerId;
      this.rng = rng;
      this.clock = clock;
      this.send = send;
      this.makeToken = makeToken;
      this.members = []; // { id, name, peerId, token, connected, bot } bot: 난이도(사람은 null)
      this.nextId = 2;
      this.phase = 'lobby';
      this.timeLimit = true;
      this.game = null;
      this.result = null;
      this.presses = [];
      this.pressSeq = 0;
      this.judgeTimer = null;
      this.resultTimer = null;
      this.pending = new Map(); // memberId -> { timer, deadline } 끊긴 사람의 복귀 대기
      this.timeLeft = TIMING.TIME_LIMIT_MS;
      this.runningSince = null;
      this.limitTimer = null;
      this.disposed = false;
    }

    // 방을 닫을 때 부른다. 남은 타이머를 모두 멈추고 더는 아무것도 보내지 않는다.
    dispose() {
      this.disposed = true;
      for (const h of [this.judgeTimer, this.resultTimer, this.limitTimer]) if (h !== null) this.clock.clearTimeout(h);
      for (const { timer } of this.pending.values()) this.clock.clearTimeout(timer);
      this.pending.clear();
      for (const m of this.members) if (m.bot) this.stopBot(m);
      this.judgeTimer = this.resultTimer = this.limitTimer = null;
    }

    // net.js가 잰 왕복 지연. 판정 대기 시간을 가장 느린 사람에 맞춘다.
    setLatency(peerId, rttMs) {
      const m = this.memberByPeer(peerId);
      if (!m || !Number.isFinite(rttMs)) return;
      m.rtts = (m.rtts || []).concat(rttMs).slice(-RTT_SAMPLES);
    }

    judgeWindowMs() {
      let worst = 0;
      for (const m of this.members) {
        if (m.connected && m.rtts) worst = Math.max(worst, ...m.rtts);
      }
      return Math.min(MAX_WINDOW_MS, Math.max(TIMING.JUDGE_WINDOW_MS, Math.round(worst / 2) + 200));
    }

    memberByPeer(peerId) {
      return this.members.find((m) => m.peerId === peerId && m.connected);
    }

    handleConnect() {
      // 이름(hello)을 받을 때까지는 아무것도 하지 않는다.
    }

    handleMessage(peerId, msg) {
      if (this.disposed || !msg || typeof msg.t !== 'string') return;
      if (msg.t === 'hello') return this.onHello(peerId, msg);
      const m = this.memberByPeer(peerId);
      if (!m) return;
      const isHost = peerId === this.hostPeerId;
      switch (msg.t) {
        case 'start': if (isHost) this.onStart(msg); break;
        case 'flip': this.onFlip(m); break;
        case 'ring': this.onRing(m, msg); break;
        case 'again': if (isHost) this.onAgain(); break;
        case 'add-bot': if (isHost) this.onAddBot(msg); break;
        case 'remove-bot': if (isHost) this.onRemoveBot(msg); break;
        case 'leave': if (!isHost) this.onLeave(m); break;
        default: break;
      }
    }

    handleDisconnect(peerId) {
      if (this.disposed) return;
      const m = this.memberByPeer(peerId);
      if (!m || peerId === this.hostPeerId) return;
      if (!this.inGame()) return this.removeFromLobby(m);
      m.connected = false;
      if (this.phase === 'over') return this.broadcast();
      this.flushTransient();
      if (this.game.over) {
        this.endGame();
        return this.broadcast();
      }
      const deadline = this.clock.now() + TIMING.RECONNECT_MS;
      const timer = this.clock.setTimeout(() => this.expire(m), TIMING.RECONNECT_MS);
      this.pending.set(m.id, { timer, deadline });
      this.setPhase('paused');
      this.broadcast();
    }

    close() {
      if (this.disposed) return;
      for (const m of this.members) {
        if (m.connected && !m.bot && m.peerId !== this.hostPeerId) this.send(m.peerId, { t: 'closed' });
      }
    }

    inGame() {
      return this.phase !== 'lobby';
    }

    // ---- 메시지 처리 ----

    onHello(peerId, msg) {
      if (this.memberByPeer(peerId)) return;
      const known = msg.token ? this.members.find((m) => m.token === msg.token) : null;
      if (known && this.inGame()) return this.reattach(known, peerId);
      if (this.phase !== 'lobby') return this.send(peerId, { t: 'reject', reason: 'started' });
      if (this.members.length >= MAX_PLAYERS) return this.send(peerId, { t: 'reject', reason: 'full' });
      const id = peerId === this.hostPeerId ? 'p1' : 'p' + this.nextId++;
      const m = { id, name: cleanName(msg.name), peerId, token: this.makeToken(), connected: true, bot: null };
      if (id === 'p1') this.members.unshift(m);
      else this.members.push(m);
      this.send(peerId, { t: 'welcome', playerId: id, token: m.token });
      this.broadcast();
    }

    // 같은 기기가 다시 들어왔다. 끊긴 걸 아직 몰랐던 경우에도 새 연결로 바꿔 끼운다.
    reattach(m, peerId) {
      const p = this.game.players.find((x) => x.id === m.id);
      if (p.removed) return this.send(peerId, { t: 'reject', reason: 'started' });
      m.peerId = peerId;
      m.connected = true;
      const wait = this.pending.get(m.id);
      if (wait) {
        this.clock.clearTimeout(wait.timer);
        this.pending.delete(m.id);
      }
      this.send(peerId, { t: 'welcome', playerId: m.id, token: m.token });
      this.resumeIfReady();
      this.broadcast();
    }

    onStart(msg) {
      if (this.phase !== 'lobby' || this.members.length < 2) return;
      this.timeLimit = !!msg.timeLimit;
      this.timeLeft = TIMING.TIME_LIMIT_MS;
      this.game = Game.newGame(this.members.map((m) => m.id), this.rng);
      this.result = null;
      this.setPhase('playing');
      this.broadcast();
    }

    onFlip(m) {
      if (this.phase !== 'playing') return;
      if (!Game.flip(this.game, m.id).ok) return;
      this.afterGameChange();
      this.broadcast();
    }

    onRing(m, msg) {
      if (this.phase !== 'playing' && this.phase !== 'judging') return;
      if (!this.game) return;
      const g = this.game;
      const p = g.players.find((x) => x.id === m.id);
      if (!p || p.out || p.removed) return;
      const version = Number(msg.version);
      const reactionMs = Number(msg.reactionMs);
      if (!Number.isInteger(version) || version > g.version || Game.isStale(g, version)) return;
      this.presses.push({
        playerId: m.id,
        version,
        reactionMs: Number.isFinite(reactionMs) && reactionMs >= 0 ? reactionMs : Infinity,
        seq: this.pressSeq++,
      });
      if (this.phase === 'playing') {
        this.setPhase('judging');
        this.judgeTimer = this.clock.setTimeout(() => this.settle(), this.judgeWindowMs());
        this.broadcast();
      }
    }

    onAddBot(msg) {
      if (this.phase !== 'lobby' || this.members.length >= MAX_PLAYERS) return;
      const level = BOT_LEVELS[msg.level] ? msg.level : 'normal';
      const used = new Set(this.members.map((m) => m.name));
      let n = 1;
      while (used.has(`로봇${n}(${BOT_LEVELS[level].label})`) || this.members.some((m) => m.bot && m.botNo === n)) n++;
      this.members.push({
        id: 'p' + this.nextId++,
        name: `로봇${n}(${BOT_LEVELS[level].label})`,
        botNo: n,
        peerId: null,
        token: null,
        connected: true,
        bot: level,
      });
      this.broadcast();
    }

    onRemoveBot(msg) {
      if (this.phase !== 'lobby') return;
      const m = this.members.find((x) => x.bot && x.id === msg.id);
      if (m) this.removeFromLobby(m);
    }

    onAgain() {
      if (this.phase !== 'over') return;
      this.members = this.members.filter((m) => m.connected);
      this.game = null;
      this.result = null;
      this.setPhase('lobby');
      this.broadcast();
    }

    onLeave(m) {
      if (!this.inGame()) return this.removeFromLobby(m);
      m.connected = false;
      if (this.phase !== 'over') {
        this.flushTransient();
        Game.removePlayer(this.game, m.id);
        this.afterGameChange();
      }
      this.broadcast();
    }

    removeFromLobby(m) {
      if (m.bot) this.stopBot(m);
      this.members = this.members.filter((x) => x !== m);
      this.broadcast();
    }

    // ---- 봇 ----
    // 화면 정보를 보낼 때마다(=상태가 바뀔 때마다) 봇이 할 일을 정한다. 실제 행동은 타이머로 나중에 한다.

    between([lo, hi]) {
      return lo + (hi - lo) * this.rng();
    }

    stopBot(m) {
      const b = m.brain;
      if (!b) return;
      if (b.flipTimer !== null) this.clock.clearTimeout(b.flipTimer);
      if (b.ringTimer !== null) this.clock.clearTimeout(b.ringTimer);
      b.flipTimer = b.ringTimer = null;
    }

    driveBots() {
      const g = this.game;
      for (const m of this.members) {
        if (!m.bot) continue;
        if (!m.brain || m.brain.game !== g) {
          this.stopBot(m);
          m.brain = { game: g, flipTimer: null, ringTimer: null, fiveSeen: null, seenAt: 0, lookedAt: -1 };
        }
        const b = m.brain;
        const p = g && g.players.find((x) => x.id === m.id);
        const active = !!(p && !p.out && !p.removed && !g.over);
        const level = BOT_LEVELS[m.bot];

        // 뒤집기: 내 차례이고 진행 중일 때만 시간을 잰다. 그 밖에는 걸어 둔 걸 거둔다.
        const myTurn = active && this.phase === 'playing' && g.players[g.turn] === p;
        if (!myTurn && b.flipTimer !== null) {
          this.clock.clearTimeout(b.flipTimer);
          b.flipTimer = null;
        } else if (myTurn && b.flipTimer === null) {
          b.flipTimer = this.clock.setTimeout(() => {
            b.flipTimer = null;
            if (this.phase === 'playing') this.onFlip(m);
          }, this.between(level.flip));
        }

        // 벨: 진행 중이거나 판정 대기 중일 때만 누른다.
        const canRing = active && (this.phase === 'playing' || this.phase === 'judging');
        if (!canRing) {
          if (b.ringTimer !== null) this.clock.clearTimeout(b.ringTimer);
          b.ringTimer = null;
          continue;
        }
        if (b.ringTimer !== null || b.lookedAt === g.version) continue;
        b.lookedAt = g.version;
        if (Game.isValidFive(g, g.version)) {
          // 같은 합 5는 한 번만 본다.
          if (b.fiveSeen === g.fiveStart) continue;
          b.fiveSeen = g.fiveStart;
          b.seenAt = this.clock.now();
          if (this.rng() < level.miss) continue;
          b.ringTimer = this.clock.setTimeout(() => {
            b.ringTimer = null;
            // 그새 합 5가 사라졌으면 지금 판을 다시 본다.
            if (!Game.isValidFive(g, g.version)) return this.driveBots();
            this.botRing(m, b.seenAt);
          }, this.between(level.react));
        } else if (this.phase === 'playing' && level.wrong > 0 && nearFive(Game.topCards(g)) && this.rng() < level.wrong) {
          b.seenAt = this.clock.now();
          b.ringTimer = this.clock.setTimeout(() => {
            b.ringTimer = null;
            this.botRing(m, b.seenAt);
          }, this.between(level.react));
        }
      }
    }

    botRing(m, seenAt) {
      if (this.disposed || this.game !== (m.brain && m.brain.game)) return;
      this.onRing(m, { version: this.game.version, reactionMs: this.clock.now() - seenAt });
    }

    // ---- 벨 판정 ----

    // 판정 대기 시간이 끝나면 벌칙을 먼저, 그다음 정답자가 카드를 가져간다.
    settle(showResult = true) {
      if (this.judgeTimer !== null) this.clock.clearTimeout(this.judgeTimer);
      this.judgeTimer = null;
      const g = this.game;
      const r = Judge.judge(this.presses, (v) => Game.isValidFive(g, v));
      this.presses = [];
      for (const id of r.wrongIds) Game.penalize(g, id);
      if (r.winnerId) Game.collect(g, r.winnerId);
      if (!showResult) return;
      this.result = r;
      this.setPhase('result');
      this.broadcast();
      this.resultTimer = this.clock.setTimeout(() => this.endResult(), TIMING.RESULT_MS);
    }

    endResult() {
      if (this.resultTimer !== null) this.clock.clearTimeout(this.resultTimer);
      this.resultTimer = null;
      this.result = null;
      this.setPhase('playing');
      this.afterGameChange();
      this.broadcast();
    }

    // 판정 중이거나 결과 표시 중이면 즉시 마무리한다(멈춤, 나가기, 시간 종료 전에).
    flushTransient() {
      if (this.phase === 'judging') this.settle(false);
      if (this.resultTimer !== null) this.clock.clearTimeout(this.resultTimer);
      this.resultTimer = null;
      this.result = null;
      if (this.phase === 'judging' || this.phase === 'result') this.setPhase('playing');
    }

    // ---- 끊김과 시간 ----

    expire(m) {
      this.pending.delete(m.id);
      Game.removePlayer(this.game, m.id);
      this.resumeIfReady();
      this.broadcast();
    }

    resumeIfReady() {
      if (this.phase === 'paused' && this.pending.size === 0) {
        Game.refresh(this.game);
        this.setPhase('playing');
      }
      this.afterGameChange();
    }

    afterGameChange() {
      if (this.game && this.game.over && this.phase !== 'result') this.endGame();
    }

    endGame() {
      for (const { timer } of this.pending.values()) this.clock.clearTimeout(timer);
      this.pending.clear();
      this.setPhase('over');
    }

    onTimeUp() {
      this.limitTimer = null;
      this.flushTransient();
      this.runningSince = null;
      this.timeLeft = 0;
      Game.timeUp(this.game);
      this.endGame();
      this.broadcast();
    }

    // 단계를 바꾸면서 시간 제한 시계를 멈추거나 다시 흐르게 한다.
    setPhase(next) {
      const wasRunning = this.runningSince !== null;
      const runs = this.timeLimit && CLOCK_PHASES.has(next);
      if (wasRunning && !runs) {
        this.timeLeft = Math.max(0, this.timeLeft - (this.clock.now() - this.runningSince));
        this.runningSince = null;
        this.clock.clearTimeout(this.limitTimer);
        this.limitTimer = null;
      } else if (!wasRunning && runs && this.timeLeft > 0) {
        this.runningSince = this.clock.now();
        this.limitTimer = this.clock.setTimeout(() => this.onTimeUp(), this.timeLeft);
      }
      this.phase = next;
    }

    remainingMs() {
      if (!this.timeLimit || this.phase === 'lobby') return null;
      const used = this.runningSince === null ? 0 : this.clock.now() - this.runningSince;
      return Math.max(0, this.timeLeft - used);
    }

    pausedInfo() {
      if (this.phase !== 'paused') return null;
      let first = null;
      for (const [playerId, w] of this.pending) {
        if (!first || w.deadline < first.deadline) first = { playerId, deadline: w.deadline };
      }
      return first && { playerId: first.playerId, msLeft: Math.max(0, first.deadline - this.clock.now()) };
    }

    // ---- 화면 정보 ----

    viewFor(playerId) {
      const g = this.game;
      const tops = g ? Game.topCards(g) : [];
      const players = this.members.map((m, seat) => {
        const i = g ? g.players.findIndex((p) => p.id === m.id) : -1;
        const p = i >= 0 ? g.players[i] : null;
        return {
          id: m.id,
          name: m.name,
          color: COLORS[seat],
          connected: m.connected,
          bot: m.bot ? BOT_LEVELS[m.bot].label : null,
          // 각자 화면 언어로 봇 이름을 그리도록 난이도 키와 번호도 보낸다.
          botLevel: m.bot || null,
          botNo: m.bot ? m.botNo : null,
          out: p ? p.out : false,
          removed: p ? p.removed : false,
          count: p ? Game.cardCount(p) : 0,
          top: p ? tops[i] : null,
          isTurn: !!(p && !g.over && g.turn === i),
        };
      });
      return {
        phase: this.phase,
        me: playerId,
        hostId: 'p1',
        timeLimit: this.timeLimit,
        players,
        version: g ? g.version : 0,
        fiveStart: g ? g.fiveStart : null,
        centerCount: g ? g.center.length : 0,
        remainingMs: this.remainingMs(),
        result: this.result,
        paused: this.pausedInfo(),
        winners: g ? g.winners.slice() : [],
      };
    }

    broadcast() {
      if (this.disposed) return;
      for (const m of this.members) {
        if (m.connected && !m.bot) this.send(m.peerId, { t: 'view', view: this.viewFor(m.id) });
      }
      this.driveBots();
    }
  }

  HostSession.TIMING = TIMING;
  HostSession.COLORS = COLORS;
  HostSession.BOT_LEVELS = BOT_LEVELS;

  if (typeof module === 'object' && module.exports) module.exports = HostSession;
  else root.HostSession = HostSession;
})(this);
