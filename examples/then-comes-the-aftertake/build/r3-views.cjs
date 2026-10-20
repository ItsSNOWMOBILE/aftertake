const { open, glide, record } = require('./recorder.cjs');
const out = process.argv[2];
async function typeInto(page, locator, text) {
  await glide(page, locator, 500);
  await locator.click();
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 22 });
}
(async () => {
  { // Words into motion
    const { browser, page } = await open();
    await page.getByRole('button', { name: 'Create video' }).first().click();
    await page.waitForTimeout(1200);
    const scene = page.locator('.modal-backdrop textarea:visible').first();
    await record(page, `${out}/u3-video.mp4`, async () => {
      await typeInto(page, scene, 'An unbranded amber glass fragrance bottle on pale limestone beside fresh green leaves. Soft window light shines through the glass.');
      await page.waitForTimeout(300);
      const video = page.locator('video').first();
      await glide(page, video, 500);
      await video.evaluate((v) => { v.currentTime = 0; v.play(); });
      await page.waitForTimeout(2200);
    });
    await browser.close();
  }
  { // Imagine the first frame
    const { browser, page } = await open();
    await page.getByRole('button', { name: 'Create image' }).first().click();
    await page.waitForTimeout(1200);
    const scene = page.locator('.modal-backdrop textarea:visible').first();
    await record(page, `${out}/u4-image.mp4`, async () => {
      await typeInto(page, scene, 'A remote astronomical observatory on a steep rocky ridge above a sea of clouds at sunrise.');
      await page.waitForTimeout(900);
    });
    await browser.close();
  }
  { // Recipe library
    const { browser, page } = await open();
    await page.getByRole('button', { name: 'Recipes' }).first().click();
    await page.waitForTimeout(1500);
    await record(page, `${out}/u5-recipes.mp4`, async () => {
      const cards = page.locator('article, [class*=recipe-card], [class*=card]').filter({ hasText: /Reclaimed|An opening elsewhere|The golden falls/ });
      for (const name of ['Reclaimed', 'An opening elsewhere', 'The golden falls']) {
        const card = page.getByText(name, { exact: true }).first();
        if (await card.count()) { await glide(page, card, 550); await page.waitForTimeout(500); }
      }
      await page.mouse.wheel(0, 380);
      await page.waitForTimeout(1200);
    });
    await browser.close();
  }
  { // Color & finish
    const { browser, page } = await open();
    await page.getByRole('button', { name: 'Color & finish' }).first().click();
    await page.waitForTimeout(1200);
    const look = page.locator('select').filter({ has: page.locator('option', { hasText: /Clean/ }) }).first();
    const options = await look.locator('option').allTextContents();
    console.log('looks', options);
    await record(page, `${out}/u6-finish.mp4`, async () => {
      await glide(page, look, 600);
      for (const option of options.slice(1, 4)) {
        await look.selectOption({ label: option });
        await page.waitForTimeout(250);
        await page.getByRole('button', { name: 'Preview frame' }).click().catch(() => {});
        await page.waitForTimeout(1300);
      }
    });
    await browser.close();
  }
})();
