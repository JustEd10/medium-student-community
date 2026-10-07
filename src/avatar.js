const palette = [
  ['#b487f7', '#36205c'],
  ['#bec3ff', '#2b3265'],
  ['#ddcdff', '#4b2e81'],
  ['#b9defb', '#174d72'],
  ['#b6e1cb', '#225b45'],
];

function luminance(hex) {
  const channels = [1, 3, 5].map(start => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function avatarColors(color) {
  const index = typeof color === 'string' && /^\d+$/.test(color) ? Number(color) : color;
  let [background, preferredText] = Number.isInteger(index) && palette[index] ? palette[index] : palette[0];
  if (typeof color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) {
    background = color.length === 4 ? '#' + [...color.slice(1)].map(c => c + c).join('') : color;
    preferredText = '#202033';
  }
  const bg = luminance(background), text = luminance(preferredText);
  const contrast = (Math.max(bg, text) + 0.05) / (Math.min(bg, text) + 0.05);
  // Keep the palette's text when readable; use white on dark backgrounds.
  const foreground = contrast >= 4.5 ? preferredText : 1.05 / (bg + 0.05) >= 4.5 ? '#ffffff' : '#000000';
  return { background, foreground };
}
