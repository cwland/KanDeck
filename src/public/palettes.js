/**
 * 20 preset palettes (spec 2.4). Each has an `accent` (board chrome / buttons)
 * and a set of vibrant `colors` for card/tag color-coding.
 *
 * Contrast is guaranteed at render time: app.js picks black or white text for
 * any swatch/accent based on relative luminance, so every pairing meets
 * WCAG 2.1 AA (>= 4.5:1) regardless of which vibrant color is chosen.
 */
window.PALETTES = [
  { name: 'Trello Classic', accent: '#0079bf', colors: ['#61bd4f','#f2d600','#ff9f1a','#eb5a46','#c377e0','#0079bf','#00c2e0','#ff78cb'] },
  { name: 'Sunset', accent: '#e8590c', colors: ['#ff6b6b','#ff922b','#ffd43b','#f06595','#e64980','#fa5252','#ffa94d','#c92a2a'] },
  { name: 'Ocean', accent: '#1864ab', colors: ['#3bc9db','#22b8cf','#4dabf7','#228be6','#1971c2','#15aabf','#1098ad','#0b7285'] },
  { name: 'Forest', accent: '#2b8a3e', colors: ['#69db7c','#51cf66','#40c057','#82c91e','#94d82d','#2f9e44','#2b8a3e','#66a80f'] },
  { name: 'Grape', accent: '#6741d9', colors: ['#b197fc','#9775fa','#845ef7','#7950f2','#7048e8','#6741d9','#5f3dc4','#e599f7'] },
  { name: 'Candy', accent: '#c2255c', colors: ['#faa2c1','#f783ac','#f06595','#e64980','#d6336c','#c2255c','#a61e4d','#ffa8a8'] },
  { name: 'Neon', accent: '#0ca678', colors: ['#00ff9d','#00e0ff','#ff00e5','#faff00','#ff5c00','#00b3ff','#b400ff','#00ffbb'] },
  { name: 'Autumn', accent: '#b25900', colors: ['#d9480f','#e8590c','#f76707','#f59f00','#e67700','#c92a2a','#a61e22','#846358'] },
  { name: 'Pastel', accent: '#5c7cfa', colors: ['#a5d8ff','#b2f2bb','#ffec99','#ffd8a8','#eebefa','#d0bfff','#c5f6fa','#ffc9c9'] },
  { name: 'Mono Slate', accent: '#495057', colors: ['#adb5bd','#868e96','#495057','#343a40','#5c7cfa','#20c997','#fab005','#fa5252'] },
  { name: 'Coral Reef', accent: '#e03131', colors: ['#ff8787','#ffa94d','#ffd43b','#69db7c','#3bc9db','#748ffc','#da77f2','#f783ac'] },
  { name: 'Cyberpunk', accent: '#d6336c', colors: ['#f72585','#b5179e','#7209b7','#560bad','#3a0ca3','#4361ee','#4cc9f0','#f15bb5'] },
  { name: 'Earth', accent: '#5f3dc4', colors: ['#c3986b','#a17c5b','#7f5539','#9c6644','#6f4518','#588157','#3a5a40','#a3b18a'] },
  { name: 'Tropical', accent: '#0ca678', colors: ['#ffbe0b','#fb5607','#ff006e','#8338ec','#3a86ff','#06d6a0','#ef476f','#ffd166'] },
  { name: 'Berry', accent: '#a61e4d', colors: ['#e64980','#be4bdb','#7950f2','#4c6ef5','#e8590c','#f76707','#d6336c','#ae3ec9'] },
  { name: 'Mint', accent: '#087f5b', colors: ['#63e6be','#38d9a9','#20c997','#12b886','#0ca678','#099268','#087f5b','#c3fae8'] },
  { name: 'Sky', accent: '#1c7ed6', colors: ['#a5d8ff','#74c0fc','#4dabf7','#339af0','#228be6','#1c7ed6','#1971c2','#d0ebff'] },
  { name: 'Firewatch', accent: '#c92a2a', colors: ['#ff922b','#fd7e14','#f76707','#e8590c','#d9480f','#e03131','#c92a2a','#ffa94d'] },
  { name: 'Lavender Fields', accent: '#7048e8', colors: ['#d0bfff','#b197fc','#9775fa','#845ef7','#7950f2','#e599f7','#da77f2','#cc5de8'] },
  { name: 'High Contrast', accent: '#000000', colors: ['#e03131','#2f9e44','#1971c2','#f08c00','#6741d9','#0c8599','#c2255c','#212529'] },
];
