// 화면 글자 사전(한국어·영어·일본어)과 언어 고르기.
// 언어는 주소의 ?lang= → 저장된 woomars.lang(메뉴 사이트와 같이 씀) → 브라우저 언어 순으로 정한다.
(function (root) {
  'use strict';

  const LANGS = ['ko', 'en', 'ja'];
  const KEY = 'woomars.lang';

  // 받침이 있으면 '이', 없으면 '가'.
  function subject(name) {
    const last = name.charCodeAt(name.length - 1);
    const hangul = last >= 0xac00 && last <= 0xd7a3;
    return name + (hangul && (last - 0xac00) % 28 !== 0 ? '이' : '가');
  }

  const cardsEn = (n) => `${n} ${n === 1 ? 'card' : 'cards'}`;

  const DICT = {
    ko: {
      'meta.title': '여기요!',
      'meta.description': '같은 메뉴가 딱 5개면 벨을 누르는 가족용 반응 속도 카드 게임',
      'start.bell': '여기요!',
      'start.title': '여기요!',
      'start.tagline': '같은 메뉴가 딱 5개면 벨을 누르세요',
      'start.nameLabel': '내 이름',
      'start.namePlaceholder': '예: 아빠',
      'start.create': '방 만들기',
      'start.join': '방 들어가기',
      'start.rules': '간단 규칙',
      'start.creating': '방을 만드는 중…',
      'start.connecting': '연결하는 중…',
      'start.nameInvalid': '이름을 1~8자로 적어 주세요',
      'start.pendingRoom': ({ room }) => `이름을 적고 「방 들어가기」를 누르면 ${room}번 방에 들어가요`,
      'lang.label': '언어',

      'rules.title': '간단 규칙',
      'rules.1': '차례대로 자기 카드를 한 장씩 뒤집어요.',
      'rules.2': '같은 메뉴가 딱 5개면 「여기요!」를 눌러요.',
      'rules.3': '맞히면 펼쳐진 카드를 모두 가져가요.',
      'rules.4': '틀리면 다른 사람 모두에게 한 장씩 줘요.',
      'rules.5': '뒤집을 카드가 없으면 탈락이에요.',
      'rules.example': '= 김밥 5개!',
      'rules.close': '닫기',

      'join.title': '방 번호 입력',
      'join.hint': '방장 화면의 숫자 4자리',
      'join.codeLabel': '방 번호',
      'join.submit': '들어가기',
      'join.back': '뒤로',
      'join.invalid': '숫자 4자리를 입력해 주세요',

      'lobby.code': '방 번호',
      'lobby.qrHint': '카메라로 찍으면 바로 들어옵니다',
      'lobby.addBot': '봇 추가',
      'lobby.timeLimit': '시간 제한 7분',
      'lobby.start': '시작하기',
      'lobby.startN': ({ n }) => `시작하기 (${n}명)`,
      'lobby.stayHint': '게임 중에는 다른 앱으로 넘어가지 마세요',
      'lobby.waitingHost': '방장이 시작하길 기다리는 중',
      'lobby.leave': '나가기',
      'lobby.host': '방장',
      'lobby.ready': '준비됨',
      'lobby.botTag': ({ level }) => `봇 · ${level}`,
      'lobby.remove': ({ name }) => `${name} 빼기`,
      'lobby.me': ' (나)',
      'lobby.empty': '기다리는 중…',

      'level.easy': '하',
      'level.normal': '중',
      'level.hard': '상',
      'bot.name': ({ n, level }) => `로봇${n}(${level})`,

      'menu.gimbap': '김밥',
      'menu.mandu': '만두',
      'menu.tteok': '떡볶이',
      'menu.eomuk': '어묵',
      'card.label': ({ menu, n }) => `${menu} ${n}개`,

      'game.leave': '나가기',
      'game.bell': '여기요!',
      'game.flipMine': '내 차례 · 뒤집기',
      'game.turnOf': ({ name }) => `${name} 차례`,
      'game.wait': '잠시만요',
      'game.timer': ({ time }) => `남은 시간 ${time}`,
      'game.me': '(나)',
      'game.cards': ({ n }) => `${n}장`,
      'game.tagLeft': '나감',
      'game.tagDisconnected': '연결 끊김',
      'game.tagOut': '탈락',
      'game.paused': ({ name, s }) => `${name} 연결 기다리는 중… ${s}초`,
      'game.correct': ({ name }) => `${name} 정답!`,
      'game.firstByHair': ({ name }) => `${subject(name)} 간발의 차이로 먼저!`,
      'game.firstBy': ({ name, gap }) => `${subject(name)} ${gap}초 차이로 먼저!`,
      'game.wrong': ({ names }) => `${names.join(', ')} 땡! 한 장씩 나눠 줘요`,

      'result.title': '게임 끝',
      'result.again': '한 판 더',
      'result.waitHost': '방장이 「한 판 더」를 누르면 다시 시작해요',
      'result.leave': '나가기',
      'result.winner': '우승',
      'result.cards': ({ n }) => `${n}장`,

      'error.retry': '다시 시도',
      'error.ok': '확인',
      'error.not-found': '방을 찾을 수 없어요. 번호를 확인해 주세요',
      'error.timeout': '연결하지 못했어요. 잠시 뒤 다시 시도해 주세요',
      'error.no-internet': '인터넷 연결을 확인해 주세요',
      'error.full': '방이 가득 찼어요',
      'error.started': '이미 게임이 시작됐어요',
      'error.closed': '방장 연결이 끊겨 방이 닫혔어요',
      'error.hostLeftScreen': '방장이 화면을 벗어나서 방이 닫혔어요',

      'net.lost': '연결이 끊겼어요. 다시 연결하는 중…',
      'net.back': '다시 연결됐어요',
      'confirm.hostLeave': '나가면 방이 닫혀요. 나갈까요?',
      'confirm.guestLeave': '게임에서 나갈까요?',
    },

    en: {
      'meta.title': 'Excuse Me!',
      'meta.description': 'A fast-reaction family card game: ring the bell when exactly 5 of the same dish show up',
      'start.bell': 'Excuse me!',
      'start.title': 'Excuse Me!',
      'start.tagline': 'Ring the bell when there are exactly 5 of the same dish',
      'start.nameLabel': 'Your name',
      'start.namePlaceholder': 'e.g. Dad',
      'start.create': 'Create room',
      'start.join': 'Join room',
      'start.rules': 'How to play',
      'start.creating': 'Creating room…',
      'start.connecting': 'Connecting…',
      'start.nameInvalid': 'Enter a name of 1–8 characters',
      'start.pendingRoom': ({ room }) => `Enter your name and tap "Join room" to join room ${room}`,
      'lang.label': 'Language',

      'rules.title': 'How to play',
      'rules.1': 'Take turns flipping your cards one at a time.',
      'rules.2': 'When exactly 5 of the same dish are showing, hit "Excuse me!".',
      'rules.3': 'Get it right and you take all the face-up cards.',
      'rules.4': 'Get it wrong and you give one card to everyone else.',
      'rules.5': "If you have no card left to flip, you're out.",
      'rules.example': '= 5 Gimbap!',
      'rules.close': 'Close',

      'join.title': 'Enter room number',
      'join.hint': "The 4-digit number on the host's screen",
      'join.codeLabel': 'Room number',
      'join.submit': 'Join',
      'join.back': 'Back',
      'join.invalid': 'Enter the 4-digit number',

      'lobby.code': 'Room number',
      'lobby.qrHint': 'Scan with a camera to join right away',
      'lobby.addBot': 'Add bot',
      'lobby.timeLimit': '7-minute time limit',
      'lobby.start': 'Start',
      'lobby.startN': ({ n }) => `Start (${n} ${n === 1 ? 'player' : 'players'})`,
      'lobby.stayHint': "Don't switch to other apps during the game",
      'lobby.waitingHost': 'Waiting for the host to start',
      'lobby.leave': 'Leave',
      'lobby.host': 'Host',
      'lobby.ready': 'Ready',
      'lobby.botTag': ({ level }) => `Bot · ${level}`,
      'lobby.remove': ({ name }) => `Remove ${name}`,
      'lobby.me': ' (you)',
      'lobby.empty': 'Waiting…',

      'level.easy': 'Easy',
      'level.normal': 'Normal',
      'level.hard': 'Hard',
      'bot.name': ({ n, level }) => `Bot ${n} (${level})`,

      'menu.gimbap': 'Gimbap',
      'menu.mandu': 'Mandu',
      'menu.tteok': 'Tteokbokki',
      'menu.eomuk': 'Fish cake',
      'card.label': ({ menu, n }) => `${n} ${menu}`,

      'game.leave': 'Leave',
      'game.bell': 'Excuse me!',
      'game.flipMine': 'Your turn · Flip',
      'game.turnOf': ({ name }) => `${name}'s turn`,
      'game.wait': 'Hold on…',
      'game.timer': ({ time }) => `Time left ${time}`,
      'game.me': ' (you)',
      'game.cards': ({ n }) => cardsEn(n),
      'game.tagLeft': 'Left',
      'game.tagDisconnected': 'Disconnected',
      'game.tagOut': 'Out',
      'game.paused': ({ name, s }) => `Waiting for ${name} to reconnect… ${s}s`,
      'game.correct': ({ name }) => `${name} got it!`,
      'game.firstByHair': ({ name }) => `${name} was first by a hair!`,
      'game.firstBy': ({ name, gap }) => `${name} was first by ${gap}s!`,
      'game.wrong': ({ names }) => `Wrong! ${names.join(', ')} ${names.length === 1 ? 'gives' : 'give'} one card to each player`,

      'result.title': 'Game over',
      'result.again': 'Play again',
      'result.waitHost': 'The game restarts when the host taps "Play again"',
      'result.leave': 'Leave',
      'result.winner': 'Winner',
      'result.cards': ({ n }) => cardsEn(n),

      'error.retry': 'Try again',
      'error.ok': 'OK',
      'error.not-found': "Room not found. Check the number",
      'error.timeout': "Couldn't connect. Try again in a moment",
      'error.no-internet': 'Check your internet connection',
      'error.full': 'The room is full',
      'error.started': 'The game has already started',
      'error.closed': 'Lost connection to the host, so the room closed',
      'error.hostLeftScreen': 'The host left the screen, so the room closed',

      'net.lost': 'Disconnected. Reconnecting…',
      'net.back': 'Reconnected',
      'confirm.hostLeave': 'Leaving will close the room. Leave?',
      'confirm.guestLeave': 'Leave the game?',
    },

    ja: {
      'meta.title': 'すみません！',
      'meta.description': '同じメニューがちょうど5つになったらベルを押す、家族で遊べる反射神経カードゲーム',
      'start.bell': 'すみません！',
      'start.title': 'すみません！',
      'start.tagline': '同じメニューがちょうど5つになったらベルを押そう',
      'start.nameLabel': '名前',
      'start.namePlaceholder': '例：パパ',
      'start.create': 'ルームを作る',
      'start.join': 'ルームに入る',
      'start.rules': '遊び方',
      'start.creating': 'ルームを作成中…',
      'start.connecting': '接続中…',
      'start.nameInvalid': '名前は1〜8文字で入力してください',
      'start.pendingRoom': ({ room }) => `名前を入れて「ルームに入る」を押すと、ルーム${room}に入ります`,
      'lang.label': '言語',

      'rules.title': '遊び方',
      'rules.1': '順番に自分のカードを1枚ずつめくる。',
      'rules.2': '同じメニューがちょうど5つになったら「すみません！」を押す。',
      'rules.3': '正解なら、場に出ているカードを全部もらえる。',
      'rules.4': 'まちがえたら、ほかの全員に1枚ずつ渡す。',
      'rules.5': 'めくるカードがなくなったら脱落。',
      'rules.example': '= キンパ5つ！',
      'rules.close': '閉じる',

      'join.title': 'ルーム番号を入力',
      'join.hint': 'ホスト画面に出ている4桁の数字',
      'join.codeLabel': 'ルーム番号',
      'join.submit': '入る',
      'join.back': '戻る',
      'join.invalid': '4桁の数字を入力してください',

      'lobby.code': 'ルーム番号',
      'lobby.qrHint': 'カメラで読み取るとすぐ参加できます',
      'lobby.addBot': 'ボット追加',
      'lobby.timeLimit': '制限時間7分',
      'lobby.start': 'スタート',
      'lobby.startN': ({ n }) => `スタート（${n}人）`,
      'lobby.stayHint': 'ゲーム中はほかのアプリに切り替えないでください',
      'lobby.waitingHost': 'ホストの開始を待っています',
      'lobby.leave': '退出',
      'lobby.host': 'ホスト',
      'lobby.ready': '準備OK',
      'lobby.botTag': ({ level }) => `ボット・${level}`,
      'lobby.remove': ({ name }) => `${name}を外す`,
      'lobby.me': '（自分）',
      'lobby.empty': '待機中…',

      'level.easy': '弱',
      'level.normal': '中',
      'level.hard': '強',
      'bot.name': ({ n, level }) => `ロボ${n}(${level})`,

      'menu.gimbap': 'キンパ',
      'menu.mandu': 'マンドゥ',
      'menu.tteok': 'トッポッキ',
      'menu.eomuk': 'おでん',
      'card.label': ({ menu, n }) => `${menu}${n}つ`,

      'game.leave': '退出',
      'game.bell': 'すみません！',
      'game.flipMine': '自分の番・めくる',
      'game.turnOf': ({ name }) => `${name}の番`,
      'game.wait': 'お待ちください',
      'game.timer': ({ time }) => `残り ${time}`,
      'game.me': '(自分)',
      'game.cards': ({ n }) => `${n}枚`,
      'game.tagLeft': '退出',
      'game.tagDisconnected': '切断',
      'game.tagOut': '脱落',
      'game.paused': ({ name, s }) => `${name}の再接続を待っています… ${s}秒`,
      'game.correct': ({ name }) => `${name} 正解！`,
      'game.firstByHair': ({ name }) => `${name}がタッチの差で先！`,
      'game.firstBy': ({ name, gap }) => `${name}が${gap}秒差で先！`,
      'game.wrong': ({ names }) => `ブッブー！${names.join('、')}はみんなに1枚ずつ配る`,

      'result.title': 'ゲーム終了',
      'result.again': 'もう一回',
      'result.waitHost': 'ホストが「もう一回」を押すと再スタートします',
      'result.leave': '退出',
      'result.winner': '優勝',
      'result.cards': ({ n }) => `${n}枚`,

      'error.retry': '再試行',
      'error.ok': 'OK',
      'error.not-found': 'ルームが見つかりません。番号を確認してください',
      'error.timeout': '接続できませんでした。少ししてからもう一度試してください',
      'error.no-internet': 'インターネット接続を確認してください',
      'error.full': 'ルームが満員です',
      'error.started': 'ゲームはもう始まっています',
      'error.closed': 'ホストとの接続が切れたため、ルームが閉じました',
      'error.hostLeftScreen': 'ホストが画面を離れたため、ルームが閉じました',

      'net.lost': '接続が切れました。再接続中…',
      'net.back': '再接続しました',
      'confirm.hostLeave': '退出するとルームが閉じます。退出しますか？',
      'confirm.guestLeave': 'ゲームから退出しますか？',
    },
  };

  // 순수 함수: 주소 검색어, 저장값, 브라우저 언어 목록으로 언어를 고른다.
  function detect(search, stored, navLangs) {
    let q = null;
    try { q = new URLSearchParams(search || '').get('lang'); } catch (e) { q = null; }
    if (LANGS.includes(q)) return { lang: q, fromQuery: true };
    if (LANGS.includes(stored)) return { lang: stored, fromQuery: false };
    for (const l of navLangs || []) {
      const s = String(l || '').toLowerCase();
      if (s.startsWith('ko')) return { lang: 'ko', fromQuery: false };
      if (s.startsWith('ja')) return { lang: 'ja', fromQuery: false };
      if (s) break; // 첫 번째 선호 언어만 본다
    }
    return { lang: 'en', fromQuery: false };
  }

  function readStored() {
    try { return root.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function writeStored(lang) {
    try { root.localStorage.setItem(KEY, lang); } catch (e) { /* 저장 불가 */ }
  }

  let lang = 'ko';

  function t(key, params) {
    const table = DICT[lang] || DICT.ko;
    const v = key in table ? table[key] : DICT.ko[key];
    if (v === undefined) return key;
    return typeof v === 'function' ? v(params || {}) : v;
  }

  // data-i18n(글자), data-i18n-placeholder, data-i18n-aria-label 이 붙은 요소를 지금 언어로 바꾼다.
  function apply(doc) {
    doc = doc || root.document;
    if (!doc) return;
    doc.documentElement.lang = lang;
    doc.title = t('meta.title');
    const meta = doc.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('meta.description'));
    doc.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    doc.querySelectorAll('[data-i18n-aria-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)); });
    doc.querySelectorAll('[data-lang]').forEach((el) => { el.setAttribute('aria-pressed', String(el.dataset.lang === lang)); });
  }

  function setLang(next) {
    if (!LANGS.includes(next)) return;
    lang = next;
    writeStored(next);
    apply();
  }

  if (root.document) {
    const nav = root.navigator ? (root.navigator.languages && root.navigator.languages.length ? root.navigator.languages : [root.navigator.language]) : [];
    const found = detect(root.location ? root.location.search : '', readStored(), nav);
    lang = found.lang;
    if (found.fromQuery) writeStored(lang);
    root.document.documentElement.lang = lang;
    if (lang !== 'ko') root.document.title = DICT[lang]['meta.title'];
  }

  const I18n = {
    LANGS, KEY, DICT, detect, t, apply, setLang,
    get lang() { return lang; },
  };

  if (typeof module === 'object' && module.exports) module.exports = I18n;
  else root.I18n = I18n;
})(this);
