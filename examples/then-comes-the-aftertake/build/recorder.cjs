// Records real Aftertake UI at 1920x1080 from Chromium's screencast, with a drawn cursor.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CURSOR = `
(() => {
  if (window.__atCursor) return; window.__atCursor = true;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__at_cursor';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.6 L14.6 20.3 L11.7 13.6 L18 13.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {position:'fixed',left:'0',top:'0',zIndex:2147483647,pointerEvents:'none',transform:'translate(-200px,-200px)',filter:'drop-shadow(0 2px 3px rgba(0,0,0,.45))'});
    document.documentElement.appendChild(c);
    addEventListener('mousemove', e => { c.style.transform = 'translate(' + (e.clientX-3) + 'px,' + (e.clientY-2) + 'px)'; }, true);
    addEventListener('mousedown', e => {
      const r = document.createElement('div');
      Object.assign(r.style, {position:'fixed',left:(e.clientX-18)+'px',top:(e.clientY-18)+'px',width:'36px',height:'36px',borderRadius:'50%',border:'3px solid #d5eb94',zIndex:2147483646,pointerEvents:'none',transition:'transform .45s ease-out, opacity .45s ease-out',opacity:'1'});
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install); else install();
})();`;

async function open(url = 'http://127.0.0.1:4312/') {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return { browser, page };
}

/** Glide the visible cursor along a smooth ease to a point or locator center. */
async function glide(page, target, ms = 600) {
  let x, y;
  if (typeof target.boundingBox === 'function') {
    const box = await target.boundingBox();
    x = box.x + box.width / 2; y = box.y + box.height / 2;
  } else ({ x, y } = target);
  const from = page.__pos || { x: 640, y: 400 };
  const steps = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(16);
  }
  page.__pos = { x, y };
}

async function record(page, output, actions) {
  const client = await page.context().newCDPSession(page);
  const frames = [];
  client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const start = Date.now() / 1000;
  await actions();
  const end = Date.now() / 1000;
  await page.waitForTimeout(150);
  await client.send('Page.stopScreencast');
  const dir = output + '.frames';
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  // Screencast frames arrive only on change; hold each frame until the next one.
  let list = '';
  frames.forEach((frame, index) => {
    const name = `f${String(index).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(frame.data, 'base64'));
    const next = index + 1 < frames.length ? frames[index + 1].t : Math.max(frame.t + 1 / 24, end);
    list += `file '${name}'\nduration ${Math.max(0.001, next - frame.t).toFixed(5)}\n`;
  });
  list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', 'scale=1920:1080:flags=lanczos,fps=24', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', output]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${path.basename(output)}: ${frames.length} frames over ${(end - start).toFixed(2)}s`);
}

module.exports = { open, glide, record };
