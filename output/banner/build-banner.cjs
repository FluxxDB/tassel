const fs = require('fs');
const root = 'C:/users/perry/desktop/tassel/output/banner/';
const deps =
  'C:/Users/perry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/';
const sharp = require(deps + 'sharp');
const { chromium } = require(deps + 'playwright');
const W = 1800,
  H = 1200;
const u16 = (v) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v);
  return b;
};
const i16 = (v) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(v);
  return b;
};
const u32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v);
  return b;
};
const str = (s) => Buffer.from(s, 'ascii');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const font = fs.readFileSync(root + 'Geist-Variable.woff2').toString('base64');
  await page.setContent(
    `<style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font})}html,body{margin:0;background:transparent}div{position:absolute;left:125px;top:478px;font-family:Geist;font-size:220px;font-weight:520;letter-spacing:-.025em;line-height:1;color:#222}.subtitle{left:136px;top:724px;font-size:54px;font-weight:400;letter-spacing:-.015em;line-height:1.25;color:#574853}</style><div>tassel</div><div class="subtitle">your personal study friend!</div>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: root + 'tassel-text.png', omitBackground: true });
  await browser.close();
  const icon = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><g transform="translate(755 501) scale(7.2)"><path d="M9 0v4" stroke="#222222" stroke-width="1.6"/><circle cx="9" cy="6" r="2.6" fill="#222222"/><path d="M6 9h6l2 10H4z" fill="#222222"/><path d="M7.4 11v7M10.6 11v7" stroke="#fff9f3" stroke-width="1"/></g></svg>`,
  );
  await sharp(icon)
    .png()
    .toFile(root + 'tassel-logo.png');
  await sharp({ create: { width: W, height: H, channels: 4, background: '#DED0EB' } })
    .png()
    .toFile(root + 'background.png');
  const girl = await sharp(root + 'girl-mascot-shaded.png')
    .resize(1350, 2025)
    .extract({ left: 0, top: 45, width: 1200, height: H })
    .png()
    .toBuffer();
  await sharp({ create: { width: W, height: H, channels: 4, background: '#00000000' } })
    .composite([{ input: girl, left: 600, top: 0 }])
    .png()
    .toFile(root + 'girl-layer.png');
  const paths = ['background.png', 'tassel-text.png', 'tassel-logo.png', 'girl-layer.png'];
  const names = ['background', 'tassel text', 'tassel logo', 'girl'];
  await sharp(root + paths[0])
    .composite(paths.slice(1).map((p) => ({ input: root + p })))
    .png()
    .toFile(root + 'tassel-banner.png');
  await sharp(root + 'tassel-banner.png')
    .jpeg({ quality: 95, mozjpeg: true })
    .toFile(root + 'tassel-banner.jpg');
  const layers = [];
  for (let j = 3; j >= 0; j--) {
    const raw = await sharp(root + paths[j])
      .ensureAlpha()
      .raw()
      .toBuffer();
    const channels = [];
    for (let c = 0; c < 4; c++) {
      const plane = Buffer.alloc(W * H);
      for (let i = 0; i < W * H; i++) plane[i] = raw[i * 4 + c];
      channels.push(Buffer.concat([u16(0), plane]));
    }
    let nm = Buffer.concat([Buffer.from([names[j].length]), str(names[j])]);
    nm = Buffer.concat([nm, Buffer.alloc((4 - (nm.length % 4)) % 4)]);
    const extra = Buffer.concat([u32(0), u32(0), nm]);
    const rec = Buffer.concat([
      u32(0),
      u32(0),
      u32(H),
      u32(W),
      u16(4),
      ...channels.map((b, c) => Buffer.concat([i16(c === 3 ? -1 : c), u32(b.length)])),
      str('8BIMnorm'),
      Buffer.from([255, 0, 0, 0]),
      u32(extra.length),
      extra,
    ]);
    layers.push({ rec, channels });
  }
  let info = Buffer.concat([
    i16(4),
    ...layers.map((x) => x.rec),
    ...layers.flatMap((x) => x.channels),
  ]);
  if (info.length % 2) info = Buffer.concat([info, Buffer.alloc(1)]);
  const lm = Buffer.concat([u32(info.length), info, u32(0)]);
  const rgb = await sharp(root + 'tassel-banner.png')
    .removeAlpha()
    .raw()
    .toBuffer();
  const planes = [];
  for (let c = 0; c < 3; c++) {
    const b = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) b[i] = rgb[i * 3 + c];
    planes.push(b);
  }
  const psd = Buffer.concat([
    str('8BPS'),
    u16(1),
    Buffer.alloc(6),
    u16(3),
    u32(H),
    u32(W),
    u16(8),
    u16(3),
    u32(0),
    u32(0),
    u32(lm.length),
    lm,
    u16(0),
    ...planes,
  ]);
  fs.writeFileSync(root + 'tassel-banner.psd', psd);
  for (const f of ['tassel-banner.png', 'tassel-banner.jpg', 'tassel-banner.psd'])
    console.log(f, fs.statSync(root + f).size);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
