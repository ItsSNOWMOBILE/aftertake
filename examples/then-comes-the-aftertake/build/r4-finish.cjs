const { open, glide, record } = require('./recorder.cjs');
(async () => {
  const { browser, page } = await open();
  await page.getByRole('button', { name: 'Color & finish' }).first().click();
  await page.waitForTimeout(1200);
  const look = page.locator('.modal-backdrop select:visible').filter({ has: page.locator('option', { hasText: 'Clean / your adjustments' }) }).first();
  const options = await look.locator('option').allTextContents();
  console.log('looks', options);
  await page.getByRole('button', { name: 'Preview frame' }).click().catch(() => {});
  await page.waitForTimeout(1500);
  await record(page, process.argv[2], async () => {
    await glide(page, look, 600);
    for (const option of options.filter((o) => !/Clean/.test(o)).slice(0, 3)) {
      await look.selectOption({ label: option });
      await page.waitForTimeout(200);
      const preview = page.getByRole('button', { name: 'Preview frame' });
      await glide(page, preview, 350);
      await preview.click().catch(() => {});
      await page.waitForTimeout(1400);
      await glide(page, look, 350);
    }
  });
  await browser.close();
})();
