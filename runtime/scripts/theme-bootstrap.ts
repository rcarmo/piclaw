import { WEB_THEME_PRESETS, WEB_THEME_ALIASES } from '../src/core/ui-theme-catalogue.js';

/** Background-only projection of the shared catalogue, generated during build. */
export function buildThemeBootstrap(): string {
  const presets = Object.fromEntries(WEB_THEME_PRESETS.map((preset) => [preset.id, {
    mode: preset.mode,
    light: (preset.light || preset.dark)?.bgPrimary,
    dark: (preset.dark || preset.light)?.bgPrimary,
  }]));
  const source = `/* Generated from ui-theme-catalogue by stamp-cache-buster.ts. */
(function () {
  var presets = ${JSON.stringify(presets)};
  var aliases = ${JSON.stringify(WEB_THEME_ALIASES)};
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var id = (read('piclaw_theme') || 'default').trim().toLowerCase();
  id = aliases[id] || id;
  if (!presets[id]) id = 'default';
  var preset = presets[id];
  var preference = read('piclaw_theme_mode');
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var mode = preset.mode === 'auto' ? (preference === 'light' || preference === 'dark' ? preference : systemDark ? 'dark' : 'light') : preset.mode;
  var bg = preset[mode];
  var tint = read('piclaw_tint');
  if (id === 'default' && tint) {
    var tintProbe = document.createElement('span');
    tintProbe.style.color = tint;
    if (tintProbe.style.color) {
      document.head.appendChild(tintProbe);
      var channels = getComputedStyle(tintProbe).color.match(/\\d+(?:\\.\\d+)?/g);
      tintProbe.remove();
      if (channels && channels.length >= 3) {
        bg = '#' + [1,3,5].map(function (start,index) { return Math.round(parseInt(bg.slice(start,start+2),16)*0.92+Number(channels[index])*0.08).toString(16).padStart(2,'0'); }).join('');
      }
    }
  }
  var root = document.documentElement;
  root.dataset.theme = mode; root.dataset.colorTheme = id;
  root.style.colorScheme = mode; root.style.background = bg;
  root.style.setProperty('--bg-primary',bg); root.style.setProperty('--bg',bg);
  ['dynamic-theme-color','theme-color-light','theme-color-dark'].forEach(function(id) {
    var tag = document.getElementById(id); if (tag) tag.setAttribute('content',bg);
  });
  var body = function() { if (document.body) document.body.style.background = root.style.background; };
  if (document.body) body(); else document.addEventListener('DOMContentLoaded', body, {once:true});
})();`;
  return source.split('\n').map(line => line.trimEnd()).join('\n');
}
