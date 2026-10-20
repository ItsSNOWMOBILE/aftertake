const { open, glide, record } = require('./recorder.cjs');
(async () => {
  const { browser, page } = await open();
  await page.getByRole('button', { name: 'Cue canvas' }).click();
  await page.waitForTimeout(600);
  await page.locator('button[title=Play]').first().click();
  await page.waitForTimeout(1300);
  await page.locator('button[title=Pause]').first().click();
  await page.locator('button[title="Clear painted region"]').click();
  await page.waitForTimeout(500);
  const box = await page.locator('canvas').first().boundingBox();
  await record(page, process.argv[2], async () => {
    page.__pos = { x: box.x + box.width * .85, y: box.y + box.height * .9 };
    await page.mouse.move(page.__pos.x, page.__pos.y);
    await page.waitForTimeout(300);
    const cx = box.x + box.width * .5, cy = box.y + box.height * .5;
    await glide(page, { x: cx + 70, y: cy }, 500);
    await page.mouse.down();
    for (let a = 0; a <= Math.PI * 4; a += 0.35) {
      const rr = 70 - a * 4.5;
      await page.mouse.move(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * .95);
    }
    await page.mouse.up();
    page.__pos = { x: cx, y: cy };
    await page.waitForTimeout(500);
    await glide(page, page.getByRole('button', { name: 'Compare' }), 550);
    await page.getByRole('button', { name: 'Compare' }).click();
    await page.waitForTimeout(500);
    const line = page.locator('.compare-line span');
    await glide(page, line, 450);
    await page.mouse.down();
    await glide(page, { x: box.x + box.width * .1, y: (await line.boundingBox()).y + 10 }, 900);
    await page.mouse.up();
    await page.locator('button[title=Play]').first().click().catch(() => {});
    await page.waitForTimeout(1600);
  });
  await browser.close();
})();
