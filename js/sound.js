// 소리와 진동. 음원 파일 없이 Web Audio로 합성한다.
(function (root) {
  'use strict';

  let ctx = null;
  let noiseBuf = null;

  function audio() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    return ctx;
  }

  function tone(freq, startIn, duration, type = 'sine', peak = 0.25, slideTo = null) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + startIn;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  // 카드가 스치는 "삭" 소리. 걸러 낸 잡음을 짧게 낸다.
  function swish(startIn, duration, from, to, peak) {
    const c = audio();
    if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + startIn;
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    src.buffer = noiseBuf;
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  const notes = (list, step, duration, type, peak) =>
    list.forEach((f, i) => tone(f, i * step, duration, type, peak));

  let primed = false;

  root.Sound = {
    // 터치할 때마다 부른다. 멈춘(suspended/interrupted) 상태면 다시 켜고,
    // 처음 한 번은 소리 없는 짧은 음을 재생해 아이폰의 오디오를 연다.
    unlock() {
      const c = audio();
      if (!c) return;
      if (c.state !== 'running') c.resume().catch(() => {});
      if (!primed) {
        primed = true;
        try {
          const src = c.createBufferSource();
          src.buffer = c.createBuffer(1, 1, 22050);
          src.connect(c.destination);
          src.start(0);
        } catch (e) { primed = false; }
      }
    },
    // 벨 "딩동"
    ding() {
      tone(1318.5, 0, 0.35);
      tone(1046.5, 0.15, 0.55);
    },
    // 틀린 벨 "부-"
    buzz() {
      tone(146.8, 0, 0.28, 'square', 0.1);
    },
    // 대기실에 누가 들어옴 "뽁"
    join() {
      tone(520, 0, 0.12, 'sine', 0.2, 880);
    },
    // 게임 시작 "도미솔도"
    start() {
      notes([523.3, 659.3, 784, 1046.5], 0.1, 0.22, 'triangle', 0.2);
    },
    // 카드 뒤집기 "삭"
    flip() {
      swish(0, 0.09, 5000, 1800, 0.12);
    },
    // 내가 카드를 가져감 "착착착"
    collect() {
      swish(0, 0.07, 3000, 1500, 0.1);
      swish(0.07, 0.07, 3000, 1500, 0.1);
      swish(0.14, 0.07, 3000, 1500, 0.1);
      notes([784, 988, 1174.7, 1568], 0.06, 0.18, 'triangle', 0.16);
    },
    // 다른 사람이 카드를 가져감
    miss() {
      swish(0, 0.18, 3500, 900, 0.1);
    },
    // 내 카드가 다 떨어짐 "띠로리"
    out() {
      notes([587.3, 554.4, 523.3], 0.18, 0.2, 'triangle', 0.15);
      tone(493.9, 0.54, 0.5, 'triangle', 0.15, 440);
    },
    // 누군가 연결이 끊겨 멈춤
    pause() {
      tone(440, 0, 0.18, 'sine', 0.15);
      tone(330, 0.18, 0.3, 'sine', 0.15);
    },
    // 내가 우승 "빰빠밤 빰!"
    fanfare() {
      notes([523.3, 659.3, 784, 1046.5], 0.11, 0.12, 'square', 0.07);
      tone(784, 0.5, 0.12, 'square', 0.07);
      tone(1046.5, 0.65, 0.8, 'square', 0.07);
      tone(523.3, 0.65, 0.8, 'triangle', 0.15);
      tone(659.3, 0.65, 0.8, 'triangle', 0.12);
    },
    // 게임 끝(우승 못 함)
    end() {
      notes([784, 659.3, 523.3], 0.15, 0.25, 'triangle', 0.15);
      tone(392, 0.45, 0.6, 'triangle', 0.15);
    },
    vibrate(ms) {
      if (root.navigator && typeof root.navigator.vibrate === 'function') {
        try { root.navigator.vibrate(ms); } catch (e) { /* 지원 안 함 */ }
      }
    },
  };
})(this);
