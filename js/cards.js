// 카드 그리기. 메뉴 그림을 주사위 눈처럼 배치한다.
(function (root) {
  'use strict';

  const { t } = root.I18n;
  // 3×3 칸 번호(1~9)에 그림을 놓는다.
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9] };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function symbol(menu) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#sym-' + menu);
    svg.appendChild(use);
    return svg;
  }

  function render(card) {
    const el = document.createElement('div');
    el.className = 'card';
    if (!card) {
      el.classList.add('empty');
      return el;
    }
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', t('card.label', { menu: t('menu.' + card.menu), n: card.count }));
    for (const slot of PIPS[card.count]) {
      const s = symbol(card.menu);
      s.style.gridRow = String(Math.ceil(slot / 3));
      s.style.gridColumn = String(((slot - 1) % 3) + 1);
      el.appendChild(s);
    }
    return el;
  }

  root.Cards = { render };
})(this);
