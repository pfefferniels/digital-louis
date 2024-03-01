/**
 * Inserts for every notehead which is not a
 * semibreve a semibreve below, in its shadow.
 */
export const insertShadowSemibreves = () => {
  const semibreveId = Array
    .from(document.querySelectorAll('defs symbol'))
    .map(symbol => symbol.getAttribute('id'))
    .filter(symbolId => symbolId !== null)
    .find(symbolId => symbolId!.startsWith('E0A2'));

  document.querySelectorAll('.note use')
    .forEach(use => {
      if (use.getAttribute('xlink:href')?.startsWith('#E0A4') ||
        use.getAttribute('xlink:href')?.startsWith('#E0A3')) {
        const parentEl = use.parentElement;
        if (!parentEl || parentEl.querySelector('.shadow-semibreve')) return;

        use.classList.add('not-semibreve');

        const shadowEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        shadowEl.setAttribute('x', use.getAttribute('x')!);
        shadowEl.setAttribute('y', use.getAttribute('y')!);
        shadowEl.setAttribute('width', use.getAttribute('width')!);
        shadowEl.setAttribute('height', use.getAttribute('height')!);
        const underlay = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        underlay.setAttribute('x', '-60');
        underlay.setAttribute('y', '-120');
        underlay.setAttribute('width', '600');
        underlay.setAttribute('height', '600');
        underlay.setAttribute('fill', 'white');
        underlay.setAttribute('fill-opacity', '0');
        const viewBox = document.querySelector(`#${semibreveId}`)?.getAttribute('viewBox');
        shadowEl.setAttribute('viewBox', viewBox!);
        shadowEl.setAttribute('overflow', 'inherit');
        shadowEl.setAttribute('class', 'shadow-semibreve');
        shadowEl.setAttribute('opacity', '0');
        const path = document.querySelector(`#${semibreveId} path`)?.cloneNode();
        shadowEl.appendChild(underlay!);
        shadowEl.appendChild(path!);
        parentEl.appendChild(shadowEl);
      }
    });
};
