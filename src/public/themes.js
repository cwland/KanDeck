/**
 * 22 app-level theme presets: 11 light-based + 11 dark-based, paired by accent
 * so the 🌓 button can flip between a theme's light/dark twin.
 * Each theme sets the base (light|dark) and an accent that tints the chrome.
 */
(function () {
  const ACCENTS = [
    { key: 'navy',   name: 'Navy',   c: '#0b3b66' },
    { key: 'blue',   name: 'Blue',   c: '#0079bf' },
    { key: 'green',  name: 'Green',  c: '#2f9e44' },
    { key: 'purple', name: 'Purple', c: '#7048e8' },
    { key: 'teal',   name: 'Teal',   c: '#0ca678' },
    { key: 'orange', name: 'Orange', c: '#e8590c' },
    { key: 'pink',   name: 'Pink',   c: '#e64980' },
    { key: 'red',    name: 'Red',    c: '#e03131' },
    { key: 'indigo', name: 'Indigo', c: '#4c6ef5' },
    { key: 'cyan',   name: 'Cyan',   c: '#1098ad' },
    { key: 'slate',  name: 'Slate',  c: '#5c7cfa' },
  ];

  const themes = [];
  ACCENTS.forEach((a, i) => {
    themes.push({ id: `light-${a.key}`, name: a.name, dark: false, accent: a.c, pair: i });
  });
  ACCENTS.forEach((a, i) => {
    themes.push({ id: `dark-${a.key}`, name: a.name, dark: true, accent: a.c, pair: i });
  });

  window.THEMES = themes;
  window.DEFAULT_THEME = 'light-navy';
})();
