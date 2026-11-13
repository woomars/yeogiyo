// 시작점. 화면 버튼, 방 만들기/들어가기, 재접속, 화면 켜짐 유지를 연결한다.
(function (root) {
  'use strict';

  const { UI, Net, Client, HostSession, Sound, I18n } = root;
  const { t } = I18n;
  const NAME_KEY = 'yeogiyo.name';
  const tokenKey = (code) => 'yeogiyo.token.' + code;
  const RETRY_MS = 3000;
  const GAME_PHASES = new Set(['playing', 'judging', 'result', 'paused']);

  const ERROR_CODES = new Set(['not-found', 'timeout', 'no-internet', 'full', 'started', 'closed']);
  const errorText = (code) => t('error.' + (ERROR_CODES.has(code) ? code : 'no-internet'));

  function storage(kind) {
    return {
      get(key) { try { return root[kind].getItem(key); } catch (e) { return null; } },
      set(key, value) { try { root[kind].setItem(key, value); } catch (e) { /* 저장 불가 */ } },
    };
  }
  const local = storage('localStorage');
  const session = storage('sessionStorage');

  // 지금 들어가 있는 방
  let mode = null; // 'host' | 'guest' | null
  let code = null;
  let host = null; // HostSession (방장만)
  let room = null; // Net.createRoom 결과 (방장만)
  let conn = null; // Net.joinRoom 결과 (참가자만)
  let client = null;
  let busy = false;
  let pendingRoom = null;
  let reconnect = null; // { deadline, timer, trying }
  let wakeLock = null;

  // ---- 공통 ----

  function validName() {
    const name = UI.getName().trim();
    if (name.length >= 1 && name.length <= 8) return name;
    UI.show('start');
    UI.setMessage('start', t('start.nameInvalid'));
    return null;
  }

  function inGame() {
    return !!(client && client.view && GAME_PHASES.has(client.view.phase));
  }

  function onView(view) {
    if (view.phase === 'lobby') {
      UI.show('lobby');
      const qr = mode === 'host' ? `${location.origin}${location.pathname}?room=${code}` : null;
      UI.renderLobby(view, mode === 'host' ? code : null, qr);
    } else if (view.phase === 'over') {
      UI.show('result');
      UI.renderResult(view);
    } else {
      UI.show('game');
      UI.renderGame(view);
    }
    // 방에 있는 동안(대기실, 게임, 결과)은 화면이 꺼지지 않게 한다.
    requestWake();
  }

  function endRoom(message) {
    if (reconnect) clearTimeout(reconnect.timer);
    reconnect = null;
    if (conn) conn.close();
    if (host) {
      host.close();
      host.dispose();
    }
    if (room) room.close();
    mode = code = host = room = conn = client = null;
    releaseWake();
    history.replaceState(null, '', location.pathname);
    UI.show('start');
    UI.setMessage('start', '');
    if (message) UI.error(message);
  }

  // ---- 방장 ----

  async function createRoom() {
    const name = validName();
    if (!name || busy) return;
    busy = true;
    UI.setMessage('start', t('start.creating'));
    try {
      room = await Net.createRoom({
        onConnect: (id) => host && host.handleConnect(id),
        onMessage: (id, msg) => host && host.handleMessage(id, msg),
        onDisconnect: (id) => host && host.handleDisconnect(id),
        onLatency: (id, rtt) => host && host.setLatency(id, rtt),
      });
    } catch (e) {
      busy = false;
      UI.setMessage('start', '');
      UI.error(errorText(e.code), { retry: createRoom });
      return;
    }
    busy = false;
    UI.setMessage('start', '');
    mode = 'host';
    code = room.code;
    // 이 방의 객체를 붙잡아 둔다. 방이 바뀐 뒤 옛 방의 메시지가 새 방으로 새지 않게.
    const myRoom = room;
    let myClient = null;
    const deliver = (msg) => queueMicrotask(() => myClient && myClient.receive(msg));
    const myHost = new HostSession({
      hostPeerId: 'local',
      rng: Math.random,
      clock: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) },
      send: (peerId, msg) => (peerId === 'local' ? deliver(msg) : myRoom.send(peerId, msg)),
    });
    myClient = Client.create({
      send: (msg) => queueMicrotask(() => myHost.handleMessage('local', msg)),
      onView,
    });
    host = myHost;
    client = myClient;
    host.handleMessage('local', { t: 'hello', name, token: null });
  }

  function hostSend(msg) {
    if (host) host.handleMessage('local', msg);
  }

  // ---- 참가자 ----

  function guestHandlers() {
    return {
      onMessage: (msg) => client && client.receive(msg),
      onClose: (reason) => (reason === 'closed' ? endRoom(errorText('closed')) : startReconnect()),
    };
  }

  function sendHello() {
    conn.send({ t: 'hello', name: UI.getName().trim(), token: session.get(tokenKey(code)) });
  }

  async function joinRoom(roomCode) {
    const name = validName();
    if (!name || busy) return;
    busy = true;
    pendingRoom = null;
    UI.setMessage('join', t('start.connecting'));
    UI.setMessage('start', t('start.connecting'));
    try {
      conn = await Net.joinRoom(roomCode, guestHandlers());
    } catch (e) {
      busy = false;
      UI.setMessage('join', '');
      UI.setMessage('start', '');
      UI.error(errorText(e.code), e.code === 'no-internet' ? { retry: () => joinRoom(roomCode) } : {});
      return;
    }
    busy = false;
    UI.setMessage('join', '');
    UI.setMessage('start', '');
    mode = 'guest';
    code = roomCode;
    client = Client.create({
      send: (msg) => conn && conn.send(msg),
      onView,
      onWelcome: (w) => session.set(tokenKey(code), w.token),
      onReject: (reason) => endRoom(ERROR_CODES.has(reason) ? errorText(reason) : undefined),
    });
    history.replaceState(null, '', `${location.pathname}?room=${roomCode}`);
    sendHello();
  }

  // 방장과 끊겼다. 내 쪽 문제일 수도 있으니 30초 동안 3초마다 다시 붙어 본다.
  // 방장 쪽 방이 아예 없어졌으면(not-found) 바로 끝낸다.
  function startReconnect() {
    conn = null;
    if (reconnect || !mode) return;
    reconnect = { deadline: Date.now() + HostSession.TIMING.RECONNECT_MS, timer: null, trying: false };
    UI.toast(t('net.lost'), HostSession.TIMING.RECONNECT_MS);
    tryReconnect();
  }

  async function tryReconnect() {
    if (!reconnect || reconnect.trying) return;
    clearTimeout(reconnect.timer);
    reconnect.trying = true;
    const myCode = code;
    try {
      const c = await Net.joinRoom(myCode, guestHandlers());
      if (!reconnect || code !== myCode) return c.close();
      conn = c;
      reconnect = null;
      UI.toast(t('net.back'));
      sendHello();
    } catch (e) {
      if (!reconnect) return;
      reconnect.trying = false;
      if (e.code === 'not-found' || Date.now() >= reconnect.deadline) endRoom(errorText('closed'));
      else reconnect.timer = setTimeout(tryReconnect, RETRY_MS);
    }
  }

  // ---- 나가기 ----

  function leave() {
    if (mode === 'host') {
      // 봇만 있으면 묻지 않고 나간다.
      const others = client && client.view ? client.view.players.some((p) => p.id !== client.view.me && !p.bot) : false;
      if (others && !confirm(t('confirm.hostLeave'))) return;
      endRoom(null);
    } else if (mode === 'guest') {
      if (inGame() && !confirm(t('confirm.guestLeave'))) return;
      const c = conn;
      conn = null;
      if (c) {
        c.send({ t: 'leave' });
        setTimeout(() => c.close(), 300);
      }
      endRoom(null);
    } else {
      UI.show('start');
    }
  }

  // ---- 화면 켜짐 유지 ----

  function requestWake() {
    if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    wakeLock = 'pending';
    navigator.wakeLock.request('screen').then((lock) => {
      if (!mode) {
        lock.release().catch(() => {});
        wakeLock = null;
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    }).catch(() => { wakeLock = null; });
  }

  function releaseWake() {
    if (wakeLock && wakeLock !== 'pending') wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // 방장이 화면을 벗어나면 방을 닫는다(설계: 방장 연결이 끊기면 방이 닫힘).
      if (mode === 'host' && inGame()) endRoom(t('error.hostLeftScreen'));
      return;
    }
    if (mode) requestWake();
    if (reconnect) tryReconnect();
  });

  root.addEventListener('pagehide', () => {
    if (mode === 'host') endRoom(null);
  });

  // 아이폰은 손을 뗄 때(touchend, click)를 사용자 동작으로 보므로 여러 이벤트에서 소리를 연다.
  // 화면 켜짐 유지도 사용자 동작 때 다시 요청한다.
  for (const ev of ['pointerdown', 'touchend', 'click']) {
    document.addEventListener(ev, () => {
      Sound.unlock();
      if (mode) requestWake();
    }, { passive: true });
  }

  // ---- 버튼 연결 ----

  UI.on('name-change', (name) => local.set(NAME_KEY, name.trim()));
  UI.on('create', createRoom);
  UI.on('join-open', () => {
    if (!validName()) return;
    if (pendingRoom) return joinRoom(pendingRoom);
    UI.setMessage('start', '');
    UI.setMessage('join', '');
    UI.clearCode();
    UI.show('join');
    UI.focusCode();
  });
  UI.on('join-submit', (value) => {
    if (!/^\d{4}$/.test(value)) return UI.setMessage('join', t('join.invalid'));
    joinRoom(value);
  });
  UI.on('back', () => UI.show('start'));
  UI.on('rules-open', () => UI.show('rules'));
  UI.on('rules-close', () => UI.show('start'));
  UI.on('start', (timeLimit) => hostSend({ t: 'start', timeLimit }));
  UI.on('again', () => hostSend({ t: 'again' }));
  UI.on('add-bot', (level) => hostSend({ t: 'add-bot', level }));
  UI.on('remove-bot', (id) => hostSend({ t: 'remove-bot', id }));
  UI.on('flip', () => client && client.flip());
  UI.on('bell', () => client && client.ring());
  UI.on('leave', leave);
  // 언어는 시작 화면에서만 바꾼다(경기 중에는 고르는 곳이 없다).
  UI.on('lang', (lang) => {
    UI.setLang(lang);
    UI.setMessage('start', pendingRoom ? t('start.pendingRoom', { room: pendingRoom }) : '');
    UI.setMessage('join', '');
  });

  // ---- 처음 열 때 ----

  UI.setName(local.get(NAME_KEY) || '');
  const roomParam = new URLSearchParams(location.search).get('room');
  UI.show('start');
  if (roomParam && /^\d{4}$/.test(roomParam)) {
    if (UI.getName().trim()) joinRoom(roomParam);
    else {
      pendingRoom = roomParam;
      UI.setMessage('start', t('start.pendingRoom', { room: roomParam }));
    }
  }
})(this);
