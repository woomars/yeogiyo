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
  const RTT_SAMPLES = 10;

  const randomToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const cleanName = (name) => String(name || '').trim().slice(0, 8) || '이름 없음';

  class HostSession {
    constructor({ hostPeerId, rng, clock, send, makeToken = randomToken }) {
      this.hostPeerId = hostPeerId;
      this.rng = rng;
      this.clock = clock;
      this.send = send;
      this.makeToken = makeToken;
      this.members = []; // { id, name, peerId, token, connected }
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
        if (m.connected && m.peerId !== this.hostPeerId) this.send(m.peerId, { t: 'closed' });
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
      const m = { id, name: cleanName(msg.name), peerId, token: this.makeToken(), connected: true };
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
      this.members = this.members.filter((x) => x !== m);
      this.broadcast();
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
        if (m.connected) this.send(m.peerId, { t: 'view', view: this.viewFor(m.id) });
      }
    }
  }

  HostSession.TIMING = TIMING;
  HostSession.COLORS = COLORS;

  if (typeof module === 'object' && module.exports) module.exports = HostSession;
  else root.HostSession = HostSession;
})(this);
