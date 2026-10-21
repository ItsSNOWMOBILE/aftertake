const { open, glide, record } = require('./recorder.cjs');
const fs = require('fs');
const [, , output, draftFile] = process.argv;
(async () => {
  const draft = fs.readFileSync(draftFile, 'utf8');
  const { browser, page } = await open('about:blank');
  await page.context().addInitScript((value) => { localStorage.setItem('aftertake-film-draft', value); }, draft);
  await page.goto('http://127.0.0.1:4312/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const heading = page.getByText('Cut. Title. Tell the story.').first();
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const marks = {};
  const t0 = Date.now();
  const mark = (name) => { marks[name] = (Date.now() - t0) / 1000; };
  await record(page, output, async () => {
    mark('start');
    // Titles: show the new motion menu on the first title.
    const motion = page.getByLabel('Title 3 animation', { exact: true });
    await motion.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 0);
    await page.waitForTimeout(300);
    mark('titles');
    await glide(page, motion, 600);
    for (const value of ['glitch', 'scramble', 'pop', 'slam']) {
      await motion.selectOption(value);
      await page.waitForTimeout(650);
    }
    mark('font');
    const font = page.getByLabel('Title 3 font', { exact: true });
    await glide(page, font, 400);
    await page.waitForTimeout(500);
    const box = page.getByLabel('Title 3 box', { exact: true });
    await glide(page, box, 400);
    await box.selectOption('stamp');
    await page.waitForTimeout(700);
    // Shots: style a cut.
    const transition = page.getByLabel('Shot 3 transition', { exact: true });
    await transition.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    mark('transition');
    await glide(page, transition, 600);
    for (const value of ['zoom', 'flash', 'whip']) {
      await transition.selectOption(value);
      await page.waitForTimeout(600);
    }
    // Audio: snap the cut to the music.
    const snap = page.getByRole('button', { name: 'Snap cuts to beats' });
    await snap.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    mark('snap');
    await glide(page, snap, 600);
    await snap.click();
    await page.getByRole('status').filter({ hasText: 'BPM' }).waitFor({ timeout: 30000 });
    mark('snapped');
    await page.waitForTimeout(1600);
    mark('end');
  });
  console.log(JSON.stringify(marks));
  console.log(await page.getByRole('status').filter({ hasText: 'BPM' }).textContent());
  await browser.close();
})();
