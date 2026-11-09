// 소리와 진동. 음원 파일 없이 Web Audio로 합성한다.
(function (root) {
  'use strict';

  let ctx = null;

  function audio() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    return ctx;
  }

  function tone(freq, startIn, duration, type = 'sine', peak = 0.25) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + startIn;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

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
    ding() {
      tone(1318.5, 0, 0.35);
      tone(1046.5, 0.15, 0.55);
    },
    buzz() {
      tone(146.8, 0, 0.28, 'square', 0.1);
    },
    vibrate(ms) {
      if (root.navigator && typeof root.navigator.vibrate === 'function') {
        try { root.navigator.vibrate(ms); } catch (e) { /* 지원 안 함 */ }
      }
    },
  };
})(this);
