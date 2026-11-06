// Makes the Android launcher icons from assets/icon-source.webp (the purple flower).
// Run with: npm run icon. It overwrites the ic_launcher PNGs in android/app/src/main/res.
//
// On Android 8 and later the icon is two layers: a white background (values/ic_launcher_background.xml)
// and the flower in front, kept inside the middle of the canvas, the part every launcher shape shows.
const path = require('node:path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const res = path.join(root, 'android/app/src/main/res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function flower() {
  const { data, info } = await sharp(path.join(root, 'assets/icon-source.webp'))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const [r, g, b, a] = [data[at], data[at + 1], data[at + 2], data[at + 3]];
      // The source has black corners outside its rounded square. Make them white.
      if (a < 128 || Math.max(r, g, b) < 40) { data[at] = data[at + 1] = data[at + 2] = data[at + 3] = 255; continue; }
      // Purple pixels mark the flower's extent.
      if (Math.max(r, b) - g > 60) {
        if (x < left) left = x; if (x > right) right = x;
        if (y < top) top = y; if (y > bottom) bottom = y;
      }
    }
  }
  // A square around the flower with a hair of room, on white.
  const side = Math.max(right - left, bottom - top) + 8;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const box = {
    left: Math.max(0, Math.round(cx - side / 2)), top: Math.max(0, Math.round(cy - side / 2)),
  };
  box.width = Math.min(side, width - box.left);
  box.height = Math.min(side, height - box.top);
  return sharp(data, { raw: info }).extract(box).png().toBuffer();
}

// The flower centred on a white square (or circle) of `size`, taking `share` of its width.
async function onWhite(art, size, share, shape) {
  const inner = Math.round(size * share);
  const art2 = await sharp(art).resize(inner, inner, { fit: 'contain', background: WHITE }).toBuffer();
  let img = sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: art2, gravity: 'center' }]);
  if (shape) {
    const r = shape === 'circle' ? size / 2 : size * 0.18;
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]);
  }
  return img.png().toBuffer();
}

(async () => {
  const art = await flower();
  for (const [name, scale] of Object.entries(DENSITIES)) {
    const dir = path.join(res, `mipmap-${name}`);
    const legacy = Math.round(48 * scale);
    const layer = Math.round(108 * scale);
    // Adaptive foreground: the flower within the middle 64%, which stays visible in every mask.
    await sharp(await onWhite(art, layer, 0.64)).toFile(path.join(dir, 'ic_launcher_foreground.png'));
    // Older Android: a finished icon, rounded square and round.
    await sharp(await onWhite(art, legacy, 0.84, 'rounded')).toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(await onWhite(art, legacy, 0.74, 'circle')).toFile(path.join(dir, 'ic_launcher_round.png'));
  }
  // A large preview to look at on the PC.
  await sharp(await onWhite(art, 512, 0.64, 'circle')).toFile(path.join(root, 'assets/icon-preview.png'));
  console.log('Icons written.');
})().catch((err) => { console.error(err); process.exit(1); });
