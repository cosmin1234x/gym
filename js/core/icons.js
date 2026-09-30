/* FORGE icon set — original 24×24 line icons (2px stroke, round caps/joins).
   F.icons[name] -> trusted SVG markup string; F.icon(name, opts) -> SVGElement. */
(function (F) {
  'use strict';

  // Inner markup per icon. Elements inherit stroke styling from the <svg>;
  // tiny solid details opt in with fill="currentColor" stroke="none".
  const DOT = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r || 1.35}" fill="currentColor" stroke="none"/>`;

  const PATHS = {
    home: '<path d="M3.5 11 12 3.8l8.5 7.2"/><path d="M5.5 9.6V20h4.6v-5.6h3.8V20h4.6V9.6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' + DOT(8.5, 14.5) + DOT(12, 14.5) + DOT(15.5, 14.5),
    dumbbell: '<rect x="4.6" y="6.5" width="3.4" height="11" rx="1.2"/><rect x="16" y="6.5" width="3.4" height="11" rx="1.2"/><path d="M2.2 10v4M21.8 10v4M8 12h8"/>',
    play: '<path d="M7.5 5.2v13.6L19 12z"/>',
    pause: '<rect x="6.2" y="5" width="3.8" height="14" rx="1.2"/><rect x="14" y="5" width="3.8" height="14" rx="1.2"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.2"/>',
    chart: '<path d="M3.5 20.5h17"/><path d="m4.5 16 4.8-4.8 3.7 3 6.5-6.7"/><path d="M15 7.3h4.6v4.6"/>',
    droplet: '<path d="M12 3.2c3.4 4.1 6.2 7.4 6.2 11a6.2 6.2 0 0 1-12.4 0c0-3.6 2.8-6.9 6.2-11z"/><path d="M9 14.6a3 3 0 0 0 2.6 2.8"/>',
    book: '<path d="M12 6.6C10.2 5.2 7.8 4.6 4 4.6v13.9c3.8 0 6.2.6 8 2 1.8-1.4 4.2-2 8-2V4.6c-3.8 0-6.2.6-8 2z"/><path d="M12 6.6v13.9"/>',
    settings: '<path d="M19.08 12.59l2.05 1.19-1.42 3.41-2.29-.6-.83.83.6 2.29-3.41 1.42-1.19-2.05h-1.18l-1.19 2.05-3.41-1.42.6-2.29-.83-.83-2.29.6-1.42-3.41 2.05-1.19v-1.18L2.87 10.22l1.42-3.41 2.29.6.83-.83-.6-2.29 3.41-1.42 1.19 2.05h1.18l1.19-2.05 3.41 1.42-.6 2.29.83.83 2.29-.6 1.42 3.41-2.05 1.19z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="m4.5 12.6 4.8 4.8L19.5 7.2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    'chevron-left': '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    'chevron-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    'chevron-up': '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
    'chevron-down': '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
    trash: '<path d="M4 6.5h16M9.5 6.5v-2h5v2"/><path d="m6 6.5 1 13.1a1.6 1.6 0 0 0 1.6 1.4h6.8a1.6 1.6 0 0 0 1.6-1.4l1-13.1"/><path d="M10 10.5v6.2M14 10.5v6.2"/>',
    edit: '<path d="M4 20l.9-4.6L15.8 4.5a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L8.6 19.1z"/><path d="m14 6.3 3.7 3.7"/>',
    grip: DOT(9, 6, 1.5) + DOT(15, 6, 1.5) + DOT(9, 12, 1.5) + DOT(15, 12, 1.5) + DOT(9, 18, 1.5) + DOT(15, 18, 1.5),
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.8 4.8"/>',
    filter: '<path d="M4 5h16l-6.2 7.6v6.1L10.2 20.5v-7.9z"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.8M9.8 2.8h4.4M12 3v3M18.3 6.8l1.4-1.4"/>',
    flame: '<path d="M12 21.2c3.9 0 6.9-2.8 6.9-6.7 0-3.1-1.7-5.3-3.4-7.1-.3 1.6-1 2.8-2.2 3.5.1-3.1-1.3-5.9-4-7.7.2 3-1.6 5-3.1 6.8C5.2 11.2 5.1 12.9 5.1 14.5c0 3.9 3 6.7 6.9 6.7z"/><path d="M12 21.2a2.9 2.9 0 0 1-2.9-2.9c0-1.6 1.1-2.6 1.9-3.6.4 1 1 1.6 1.8 1.9.3-.8.3-1.6.1-2.5 1.3 1 2 2.3 2 4.2a2.9 2.9 0 0 1-2.9 2.9z"/>',
    trophy: '<path d="M7.5 4h9v5.5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.4v1.4A3.6 3.6 0 0 0 8 11M16.5 6h3.1v1.4A3.6 3.6 0 0 1 16 11M12 14v3.4M8.5 20.5h7M9.6 20.5c0-1.7 1-3.1 2.4-3.1s2.4 1.4 2.4 3.1"/>',
    star: '<path d="M12 3.6l2.41 5.98 6.43.45-4.94 4.14 1.57 6.25L12 17l-5.47 3.42 1.57-6.25-4.94-4.14 6.43-.45z"/>',
    note: '<path d="M5 4.5h14v9.6l-5.4 5.4H5z"/><path d="M13.6 19.5v-5.4H19M8.5 9h7M8.5 12.5h4"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.1 2"/>',
    undo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h10.2a5 5 0 0 1 0 10H11"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>',
    upload: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 19.5h15"/>',
    moon: '<path d="M19.6 14.6A8 8 0 0 1 9.4 4.4a8 8 0 1 0 10.2 10.2z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M5.4 18.6l1.4-1.4M17.2 6.8l1.4-1.4"/>',
    monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4"/>' + DOT(12, 7.9, 1.3),
    // pull-up bar with a hanging athlete
    bar: '<path d="M2.5 4.5h19M4.5 2.5v4M19.5 2.5v4"/><path d="M8.6 4.5v4.8a2.6 2.6 0 0 0 2.6 2.6h1.6a2.6 2.6 0 0 0 2.6-2.6V4.5"/><circle cx="12" cy="8.4" r="1.5"/><path d="M12 12v4.6M12 16.6l-2.2 4.4M12 16.6l2.2 4.4"/>',
    // flat bench, side view
    bench: '<rect x="2.8" y="8.2" width="18.4" height="3.8" rx="1.6"/><path d="M6.5 12v7.5M17.5 12v7.5M4 19.5h5M15 19.5h5M12 12v3.5"/>',
    bolt: '<path d="M13.2 2.8 5.5 13.4h6.1L10.8 21.2l7.7-10.6h-6.1z"/>',
    heart: '<path d="M12 20.3 4.8 13.2a4.6 4.6 0 0 1 6.5-6.5l.7.7.7-.7a4.6 4.6 0 0 1 6.5 6.5z"/>',
    'arrow-up': '<path d="M12 19.5v-15M6 10.5l6-6 6 6"/>',
    'arrow-down': '<path d="M12 4.5v15M6 13.5l6 6 6-6"/>',
    more: DOT(5.5, 12, 1.7) + DOT(12, 12, 1.7) + DOT(18.5, 12, 1.7),
    repeat: '<path d="m17 3.5 3 3-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12"/><path d="m7 20.5-3-3 3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>',
    target: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.8"/>' + DOT(12, 12, 1.5),
    glass: '<path d="M6 4h12l-1.5 15.1a1.7 1.7 0 0 1-1.7 1.5H9.2a1.7 1.7 0 0 1-1.7-1.5z"/><path d="M6.8 11c1.7-.9 3.5-.9 5.2 0s3.5.9 5.2 0"/>',
    bottle: '<path d="M10 2.8h4"/><path d="M10.6 2.8v2.9L8.3 8.5a3 3 0 0 0-.8 2V19a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2v-8.5a3 3 0 0 0-.8-2l-2.3-2.8V2.8"/><path d="M7.5 13.2h9"/>',
    sparkle: '<path d="M10.5 3c.6 4.3 2.7 6.4 7 7-4.3.6-6.4 2.7-7 7-.6-4.3-2.7-6.4-7-7 4.3-.6 6.4-2.7 7-7z"/><path d="M18.5 15.5v5M16 18h5"/>',
    'check-circle': '<circle cx="12" cy="12" r="8.6"/><path d="m8.3 12.3 2.5 2.5 4.9-5.1"/>',
    // bumper plate: rim, face and hub
    plate: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="1.8"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/>' + DOT(4.8, 6.5, 1.4) + DOT(4.8, 12, 1.4) + DOT(4.8, 17.5, 1.4),
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>',
    cloud: '<path d="M7 18.5h10.4a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.5 9.1 4.8 4.8 0 0 0 7 18.5z"/>',
    'cloud-off': '<path d="M9.2 6.2A6 6 0 0 1 18 10.55a4 4 0 0 1 2.1 6.7M16.5 18.5H7a4.8 4.8 0 0 1-.9-9.5"/><path d="m3.5 3.5 17 17"/>',
    device: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M11 18.3h2"/>',
    pin: '<path d="M9 3.5h6M10 3.5v5.6L7 13h10l-3-3.9V3.5M12 13v7.5"/>',
    tag: '<path d="M3.5 12.3V4.6a1.1 1.1 0 0 1 1.1-1.1h7.7l8.2 8.2a1.4 1.4 0 0 1 0 2l-6.8 6.8a1.4 1.4 0 0 1-2 0z"/><circle cx="8.2" cy="8.2" r="1.5"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
    skip: '<path d="M5.5 5.5v13l9.5-6.5z"/><path d="M18.5 5.5v13"/>',
    bed: '<path d="M3 5.5v14M3 15h18M21 19.5v-7a3 3 0 0 0-3-3h-7.5V15"/><circle cx="6.8" cy="11.6" r="1.9"/>',
    // calisthenics athlete, arms overhead
    body: '<circle cx="12" cy="4.6" r="2"/><path d="M5.5 5.8 12 9.4l6.5-3.6M12 9.4v5.6M12 15l-3.6 6M12 15l3.6 6"/>',
    scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 10a4 4 0 0 1 8 0"/><path d="m12 10 1.6-2.3"/>',
    // moods: miserable → ecstatic
    'mood-1': '<circle cx="12" cy="12" r="9"/><path d="M7.4 9.5 10 8.3M16.6 9.5 14 8.3"/><path d="M8.2 17c.9-1.6 2.2-2.4 3.8-2.4s2.9.8 3.8 2.4"/>' + DOT(9, 11.8, 1.2) + DOT(15, 11.8, 1.2),
    'mood-2': '<circle cx="12" cy="12" r="9"/><path d="M8.8 16.2c2-.9 4.4-1.2 6.6-.6"/>' + DOT(9, 10, 1.3) + DOT(15, 10, 1.3),
    'mood-3': '<circle cx="12" cy="12" r="9"/><path d="M8.8 15.4h6.4"/>' + DOT(9, 10, 1.3) + DOT(15, 10, 1.3),
    'mood-4': '<circle cx="12" cy="12" r="9"/><path d="M8.3 14c.9 1.6 2.2 2.4 3.7 2.4s2.8-.8 3.7-2.4"/>' + DOT(9, 10, 1.3) + DOT(15, 10, 1.3),
    'mood-5': '<circle cx="12" cy="12" r="9"/><path d="M7.4 9.9c.5-1.1 1.2-1.6 1.9-1.6s1.4.5 1.9 1.6M12.8 9.9c.5-1.1 1.2-1.6 1.9-1.6s1.4.5 1.9 1.6"/><path d="M7.6 13h8.8a4.4 4.4 0 0 1-8.8 0z"/>'
  };

  // Neutral fallback for unknown names: a hollow rounded tile with a centre dot.
  const FALLBACK = '<rect x="4.5" y="4.5" width="15" height="15" rx="4"/>' + DOT(12, 12, 1.6);

  const wrap = inner =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';

  const icons = {};
  Object.keys(PATHS).forEach(name => { icons[name] = wrap(PATHS[name]); });

  // Parsed templates, cloned per call (parsing SVG strings every render is wasteful).
  const cache = new Map();
  function template(name) {
    const key = Object.prototype.hasOwnProperty.call(icons, name) ? name : '';
    let node = cache.get(key);
    if (!node) {
      const tpl = document.createElement('template');
      tpl.innerHTML = key ? icons[key] : wrap(FALLBACK);
      node = tpl.content.firstElementChild;
      cache.set(key, node);
    }
    return node;
  }

  /**
   * Create an icon element.
   * @param {string} name  icon name (unknown → fallback glyph, never throws)
   * @param {{size?: number, cls?: string, label?: string}} [opts]
   * @returns {SVGElement}
   */
  function icon(name, opts) {
    const o = opts || {};
    const size = Number(o.size) > 0 ? Number(o.size) : 20;
    const el = document.importNode(template(String(name == null ? '' : name)), true);
    el.setAttribute('width', size);
    el.setAttribute('height', size);
    el.setAttribute('class', ('icon icon-' + String(name || 'unknown').replace(/[^\w-]/g, '') + ' ' + (o.cls || '')).trim());
    el.setAttribute('focusable', 'false');
    if (o.label) {
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', String(o.label));
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
    return el;
  }

  F.icons = icons;
  F.icon = icon;
})(window.Forge = window.Forge || {});
