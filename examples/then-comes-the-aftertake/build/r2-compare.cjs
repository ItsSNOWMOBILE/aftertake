const { open, glide, record } = require('./recorder.cjs');
const setSplit = (page, value) => page.locator('input.comparison').evaluate((input, v) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, String(v)); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
(async () => {
  const { browser, page } = await open();
  await page.locator('button[title=Play]').first().click();
  await page.waitForTimeout(1700);
  await page.locator('button[title=Pause]').first().click();
  await page.getByRole('button', { name: 'Compare' }).click();
  await page.waitForTimeout(900);
  await page.locator('input.comparison').fill('0');
  await page.waitForTimeout(300);
  const frame = await page.locator('input.comparison').boundingBox();
  const y = frame.y + frame.height * .5;
  page.__pos = { x: frame.x + frame.width * .3, y: y + 120 };
  await page.mouse.move(page.__pos.x, page.__pos.y);
  await record(page, process.argv[2], async () => {
    await page.waitForTimeout(250);
    await glide(page, { x: frame.x + 4, y }, 450);
    await page.mouse.down();
    const steps = 60;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const value = 100 * e;
      await page.mouse.move(frame.x + Math.max(2, frame.width * value / 100), y);
      await page.waitForTimeout(12);
    }
    page.__pos = { x: frame.x + frame.width, y };
    await page.mouse.up();
    await page.waitForTimeout(1300);
  });
  await browser.close();
})();
