import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:3001';
const OUT = 'gui-test-screenshots/2026-11-11';
fs.mkdirSync(OUT, { recursive: true });

const results = { timestamp: new Date().toISOString(), base: BASE, mobile: {}, desktop: {} };

async function collectConsole(page) {
  return [];
}

const errors = { mobile: [], desktop: [] };

async function attachConsole(page, key) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors[key].push(msg.text());
  });
  page.on('pageerror', (err) => errors[key].push('pageerror: ' + err.message));
}

// ---------- MOBILE ----------
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await attachConsole(page, 'mobile');
  try {
    await page.goto(BASE + '/ide', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const dims = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    results.mobile.noHorizontalOverflow = dims.scrollWidth <= 395;
    results.mobile.noVerticalOverflow = dims.scrollHeight <= 849;
    results.mobile.dims = dims;
    await page.screenshot({ path: `${OUT}/ide-v2-mobile-fixed.png`, fullPage: false });

    // open 测试面板 via activity bar
    const btn = page.locator('[title="测试面板"]');
    await btn.first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const panel = await page.evaluate(() => {
      // find widest visible overlay/panel aside from activity bar
      const els = Array.from(document.querySelectorAll('aside, [class*="panel"], [class*="drawer"], [class*="Panel"]'));
      let maxW = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width > 20 && style.display !== 'none' && style.visibility !== 'hidden' && r.right > 0 && r.left < 390) {
          maxW = Math.max(maxW, r.width);
        }
      }
      return { maxW, scrollWidth: document.documentElement.scrollWidth };
    });
    results.mobile.panel = panel;
    results.mobile.panelWithinLimit = panel.maxW > 0 && panel.maxW <= 0.7 * 390 + 6;
    results.mobile.panelNoOverflow = panel.scrollWidth <= 395;
    await page.screenshot({ path: `${OUT}/ide-v2-mobile-panel.png` });
  } catch (e) {
    results.mobile.error = e.message;
  }
  await browser.close();
}

// ---------- DESKTOP ----------
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await attachConsole(page, 'desktop');
  try {
    await page.goto(BASE + '/ide', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const layout = await page.evaluate(() => {
      const result = {};
      // measure left panel / right panel / bottom panel widths by looking at common layout containers
      const els = Array.from(document.querySelectorAll('div, aside'));
      // left: element near left edge with height > 300
      const visible = els.filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 50 && r.height > 50 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      const left = visible.find((el) => {
        const r = el.getBoundingClientRect();
        return r.left <= 60 && r.top < 200 && r.height > 300 && r.width < 500 && !el.querySelector('canvas');
      });
      result.leftW = left ? Math.round(left.getBoundingClientRect().width) : null;
      const right = visible.find((el) => {
        const r = el.getBoundingClientRect();
        return window.innerWidth - r.right <= 60 && r.top < 200 && r.height > 300 && r.width < 500;
      });
      result.rightW = right ? Math.round(right.getBoundingClientRect().width) : null;
      const bottom = visible.find((el) => {
        const r = el.getBoundingClientRect();
        return window.innerHeight - r.bottom <= 60 && r.height > 100 && r.height < 500 && r.width > 600;
      });
      result.bottomH = bottom ? Math.round(bottom.getBoundingClientRect().height) : null;
      // activity bar titles
      result.activityBar = Array.from(document.querySelectorAll('[title]'))
        .map((e) => e.getAttribute('title'))
        .filter((t) => t && ['测试面板', '终端', 'CI 日志', '文件管理器', 'AI 对话'].some((k) => t.includes(k)));
      return result;
    });
    results.desktop.layout = layout;
    results.desktop.activityBarOk = ['测试面板', '终端', 'CI 日志', '文件管理器', 'AI 对话'].every((k) =>
      layout.activityBar.some((t) => t.includes(k))
    );

    // Monaco tab main.cpp
    results.desktop.monacoTab = await page
      .locator('text=main.cpp')
      .first()
      .isVisible({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    // drag left separator +60
    try {
      const sep = page.locator('[role="separator"][aria-orientation="vertical"]').first();
      const box = await sep.boundingBox({ timeout: 5000 });
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(1000);
        const after = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('div, aside'));
          const visible = els.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 50 && r.height > 300 && getComputedStyle(el).display !== 'none';
          });
          const left = visible.find((el) => {
            const r = el.getBoundingClientRect();
            return r.left <= 60 && r.top < 200 && r.width < 600;
          });
          return left ? Math.round(left.getBoundingClientRect().width) : null;
        });
        results.desktop.leftWAfterDrag = after;
        results.desktop.dragGrewLeft = typeof after === 'number' && typeof layout.leftW === 'number' && after > layout.leftW;
      } else {
        results.desktop.dragGrewLeft = 'separator-not-found';
      }
    } catch (e) {
      results.desktop.dragGrewLeft = 'error: ' + e.message;
    }

    // CI 日志 tab (activity bar button)
    await page.locator('[title="CI 日志"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const ciContent = await page.evaluate(() => {
      const text = document.body.innerText;
      return { hasSummary: text.includes('摘要') || text.includes('摘要'), hasHistory: text.includes('历史运行') };
    });
    results.desktop.ciPanel = ciContent;
    results.desktop.ciPanelOk = ciContent.hasSummary || ciContent.hasHistory;
    await page.screenshot({ path: `${OUT}/ci-log-check.png` });

    // back to 终端 (activity bar button)
    await page.locator('[title="终端"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    results.desktop.terminalVisible = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('$') || text.includes('bash') || text.includes('terminal') || text.includes('终端');
    });

    await page.screenshot({ path: `${OUT}/ide-v2-desktop-regression.png` });
  } catch (e) {
    results.desktop.error = e.message;
    try { await page.screenshot({ path: `${OUT}/desktop-error.png` }); } catch {}
  }
  await browser.close();
}

results.consoleErrors = errors;
fs.writeFileSync(`${OUT}/ide-v2-fix-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
