// PeerJS 연결. 방장은 방을 열고, 참가자는 방 번호로 들어온다.
// 양쪽이 1초마다 신호를 보내고, 5초 동안 아무것도 오지 않으면 끊긴 것으로 본다.
(function (root) {
  'use strict';

  const TIMING = { HEARTBEAT_MS: 1000, PEER_LOSS_MS: 5000, JOIN_TIMEOUT_MS: 10000 };
  const PREFIX = 'yeogiyo-';
  const CONN_OPTIONS = { reliable: true, serialization: 'json' };

  const randomCode = () => String(1000 + Math.floor(Math.random() * 9000));

  function netError(code) {
    const e = new Error(code);
    e.code = code;
    return e;
  }

  function mapPeerError(err) {
    if (err && err.type === 'peer-unavailable') return 'not-found';
    return 'no-internet';
  }

  // 연결 하나를 지켜본다: 신호 보내기, 메시지 전달, 끊김 감지, 왕복 지연 재기.
  function watch(conn, onMessage, onLost, onRtt = () => {}) {
    let last = Date.now();
    let dead = false;
    const timer = setInterval(() => {
      if (conn.open) {
        try { conn.send({ t: 'hb', ts: Date.now() }); } catch (e) { /* 다음 확인에서 끊김으로 처리 */ }
      }
      if (Date.now() - last > TIMING.PEER_LOSS_MS) lost();
    }, TIMING.HEARTBEAT_MS);

    function stop() {
      if (dead) return false;
      dead = true;
      clearInterval(timer);
      try { conn.close(); } catch (e) { /* 이미 닫힘 */ }
      return true;
    }
    function lost() {
      if (stop()) onLost();
    }

    conn.on('data', (msg) => {
      last = Date.now();
      if (!msg) return;
      if (msg.t === 'hb') {
        if (conn.open && typeof msg.ts === 'number') {
          try { conn.send({ t: 'hbr', ts: msg.ts }); } catch (e) { /* 무시 */ }
        }
        return;
      }
      if (msg.t === 'hbr') {
        if (typeof msg.ts === 'number') onRtt(Date.now() - msg.ts);
        return;
      }
      onMessage(msg);
    });
    conn.on('close', lost);
    conn.on('error', lost);
    return { stop };
  }

  function createRoom(handlers) {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const tryOpen = () => {
        attempts += 1;
        const code = randomCode();
        const peer = new root.Peer(PREFIX + code, { debug: 0 });
        const conns = new Map(); // guest peer id -> { conn, w }
        let opened = false;

        peer.on('open', () => {
          if (opened) return; // 중개 서버에 다시 붙을 때도 open이 온다
          opened = true;
          resolve({
            code,
            send(peerId, msg) {
              const c = conns.get(peerId);
              if (c && c.conn.open) c.conn.send(msg);
            },
            close() {
              // 바로 정리한다. 아이폰은 화면을 벗어나면 타이머가 멈추므로 미루지 않는다.
              // closed 메시지가 못 나가도 참가자는 끊김을 알아채고, 방이 없으니 바로 끝낸다.
              for (const c of conns.values()) c.w.stop();
              conns.clear();
              peer.destroy();
            },
          });
        });

        peer.on('connection', (conn) => {
          conn.on('open', () => {
            const id = conn.peer;
            const old = conns.get(id);
            if (old) old.w.stop();
            const w = watch(
              conn,
              (msg) => handlers.onMessage(id, msg),
              () => {
                if (conns.get(id) && conns.get(id).conn === conn) conns.delete(id);
                handlers.onDisconnect(id);
              },
              (rtt) => handlers.onLatency && handlers.onLatency(id, rtt),
            );
            conns.set(id, { conn, w });
            handlers.onConnect(id);
          });
        });

        // 중개 서버와만 끊겼을 때는 다시 붙는다. 이미 연결된 사람과는 계속 통신된다.
        peer.on('disconnected', () => {
          setTimeout(() => {
            if (!peer.destroyed && peer.disconnected) {
              try { peer.reconnect(); } catch (e) { /* 다음 disconnected에서 재시도 */ }
            }
          }, 1000);
        });

        peer.on('error', (err) => {
          if (opened) return;
          peer.destroy();
          if (err && err.type === 'unavailable-id' && attempts < 5) tryOpen();
          else reject(netError(mapPeerError(err)));
        });
      };

      tryOpen();
    });
  }

  function joinRoom(code, handlers) {
    return new Promise((resolve, reject) => {
      const peer = new root.Peer({ debug: 0 });
      let settled = false;

      const fail = (reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(netError(reason));
      };
      const timer = setTimeout(() => fail('timeout'), TIMING.JOIN_TIMEOUT_MS);

      peer.on('error', (err) => fail(mapPeerError(err)));

      peer.on('open', () => {
        if (settled) return;
        const conn = peer.connect(PREFIX + code, CONN_OPTIONS);
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          let ended = false;
          const end = (reason) => {
            if (ended) return;
            ended = true;
            w.stop();
            peer.destroy();
            if (reason) handlers.onClose(reason);
          };
          const w = watch(
            conn,
            (msg) => (msg.t === 'closed' ? end('closed') : handlers.onMessage(msg)),
            () => end('host-lost'),
          );
          resolve({
            send(msg) {
              if (conn.open) conn.send(msg);
            },
            close() {
              end(null);
            },
          });
        });
      });
    });
  }

  root.Net = { TIMING, createRoom, joinRoom };
})(this);
