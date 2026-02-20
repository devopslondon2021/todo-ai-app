import { chromium } from 'playwright';

const results = [];
function log(test, status, detail = '') {
  results.push({ test, status, detail });
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${test}${detail ? ': ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Test 1: Page loads
  try {
    const response = await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    log('Page loads', response.status() === 200 ? 'PASS' : 'FAIL', `HTTP ${response.status()}`);
  } catch (e) {
    log('Page loads', 'FAIL', e.message);
  }

  // Test 2: Dark theme background
  try {
    const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const isDark = bgColor.includes('15, 23, 42') || bgColor.includes('11, 17, 32') || bgColor.includes('0f172a') || bgColor.includes('0b1120');
    log('Dark theme applied', isDark ? 'PASS' : 'FAIL', bgColor);
  } catch (e) {
    log('Dark theme applied', 'FAIL', e.message);
  }

  // Test 3: Header renders with "Todo AI"
  try {
    const header = await page.textContent('h1');
    log('Header shows "Todo AI"', header?.includes('Todo AI') ? 'PASS' : 'FAIL', header);
  } catch (e) {
    log('Header shows "Todo AI"', 'FAIL', e.message);
  }

  // Test 4: Demo mode banner visible
  try {
    const banner = await page.textContent('body');
    log('Demo mode banner visible', banner?.includes('Demo mode') ? 'PASS' : 'FAIL');
  } catch (e) {
    log('Demo mode banner visible', 'FAIL', e.message);
  }

  // Test 5: Task cards render
  try {
    await page.waitForSelector('text=Review pull request', { timeout: 5000 });
    const taskCount = await page.locator('text=Review pull request').count();
    log('Demo tasks render', taskCount > 0 ? 'PASS' : 'FAIL', `Found ${taskCount} task(s)`);
  } catch (e) {
    log('Demo tasks render', 'FAIL', e.message);
  }

  // Test 6: All 5 demo tasks visible
  try {
    const tasks = ['Review pull request', 'Buy groceries', 'Prepare slides', 'Call mom', 'Deploy v2.1'];
    let found = 0;
    for (const t of tasks) {
      if (await page.locator(`text=${t}`).count() > 0) found++;
    }
    log('All 5 demo tasks present', found === 5 ? 'PASS' : 'FAIL', `${found}/5 found`);
  } catch (e) {
    log('All 5 demo tasks present', 'FAIL', e.message);
  }

  // Test 7: Sidebar categories visible
  try {
    const personal = await page.locator('text=Personal').count();
    const work = await page.locator('text=Work').count();
    log('Sidebar categories visible', personal > 0 && work > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('Sidebar categories visible', 'FAIL', e.message);
  }

  // Test 8: Status filters visible
  try {
    const pending = await page.locator('text=Pending').count();
    const inProgress = await page.locator('text=In Progress').count();
    const completed = await page.locator('text=Completed').count();
    log('Status filters visible', pending > 0 && inProgress > 0 && completed > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('Status filters visible', 'FAIL', e.message);
  }

  // Test 9: Search input exists
  try {
    const search = await page.locator('input[placeholder*="Search"]').count();
    log('Search input exists', search > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('Search input exists', 'FAIL', e.message);
  }

  // Test 10: Smart input bar exists
  try {
    const input = await page.locator('input[placeholder*="Add a task"]').count();
    log('Smart input bar exists', input > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('Smart input bar exists', 'FAIL', e.message);
  }

  // Test 11: Mic button exists
  try {
    const mic = await page.locator('button[aria-label*="voice"]').count();
    log('Mic button exists', mic > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('Mic button exists', 'FAIL', e.message);
  }

  // Test 12: Priority filters work (click "High")
  try {
    await page.click('text=High');
    await page.waitForTimeout(500);
    // Should only show high priority tasks
    const reviewTask = await page.locator('text=Review pull request').count();
    const callMom = await page.locator('text=Call mom').count();
    const groceries = await page.locator('text=Buy groceries').count();
    const highOnly = reviewTask > 0 && callMom > 0 && groceries === 0;
    log('Priority filter (High) works', highOnly ? 'PASS' : 'FAIL', `High tasks shown: review=${reviewTask}, callmom=${callMom}, groceries=${groceries}`);
    // Reset filter
    await page.click('text=High');
    await page.waitForTimeout(300);
  } catch (e) {
    log('Priority filter (High) works', 'FAIL', e.message);
  }

  // Test 13: Status filter works (click "Completed")
  try {
    await page.click('button:has-text("Completed")');
    await page.waitForTimeout(500);
    const deploy = await page.locator('text=Deploy v2.1').count();
    const review = await page.locator('text=Review pull request').count();
    log('Status filter (Completed) works', deploy > 0 && review === 0 ? 'PASS' : 'FAIL', `deploy=${deploy}, review=${review}`);
    // Reset
    await page.click('button:has-text("All Tasks")');
    await page.waitForTimeout(300);
  } catch (e) {
    log('Status filter (Completed) works', 'FAIL', e.message);
  }

  // Test 14: Category filter works (click "Work")
  try {
    await page.click('button:has-text("Work")');
    await page.waitForTimeout(500);
    const review = await page.locator('text=Review pull request').count();
    const groceries = await page.locator('text=Buy groceries').count();
    log('Category filter (Work) works', review > 0 && groceries === 0 ? 'PASS' : 'FAIL', `work tasks: review=${review}, groceries=${groceries}`);
    // Reset
    await page.click('button:has-text("All Tasks")');
    await page.waitForTimeout(300);
  } catch (e) {
    log('Category filter (Work) works', 'FAIL', e.message);
  }

  // Test 15: Search works
  try {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('groceries');
    await page.waitForTimeout(500);
    const groceries = await page.locator('text=Buy groceries').count();
    const review = await page.locator('text=Review pull request').count();
    log('Search filter works', groceries > 0 && review === 0 ? 'PASS' : 'FAIL', `groceries=${groceries}, review=${review}`);
    await searchInput.fill('');
    await page.waitForTimeout(300);
  } catch (e) {
    log('Search filter works', 'FAIL', e.message);
  }

  // Test 16: Settings modal opens
  try {
    await page.click('button:has(svg.lucide-settings)');
    await page.waitForTimeout(500);
    const settingsText = await page.locator('text=AI Provider').count();
    log('Settings modal opens', settingsText > 0 ? 'PASS' : 'FAIL');
    // Close
    const closeBtn = page.locator('div.fixed button:has(svg.lucide-x)');
    if (await closeBtn.count() > 0) await closeBtn.first().click();
    await page.waitForTimeout(300);
  } catch (e) {
    log('Settings modal opens', 'FAIL', e.message);
  }

  // Test 17: Completed task has strikethrough styling
  try {
    const deployText = page.locator('text=Deploy v2.1 to staging');
    const classes = await deployText.getAttribute('class');
    log('Completed task has line-through', classes?.includes('line-through') ? 'PASS' : 'FAIL', classes?.substring(0, 60));
  } catch (e) {
    log('Completed task has line-through', 'FAIL', e.message);
  }

  // Test 18: Priority badges render with correct colors
  try {
    const highBadges = await page.locator('span:has-text("HIGH")').count();
    const mediumBadges = await page.locator('span:has-text("MEDIUM")').count();
    const lowBadges = await page.locator('span:has-text("LOW")').count();
    log('Priority badges render', highBadges > 0 && mediumBadges > 0 && lowBadges > 0 ? 'PASS' : 'FAIL', `H:${highBadges} M:${mediumBadges} L:${lowBadges}`);
  } catch (e) {
    log('Priority badges render', 'FAIL', e.message);
  }

  // Test 19: Stats in header correct
  try {
    const stats = await page.textContent('header');
    log('Header stats correct', stats?.includes('1 done') && stats?.includes('4 remaining') ? 'PASS' : 'FAIL', stats?.substring(0, 50));
  } catch (e) {
    log('Header stats correct', 'FAIL', e.message);
  }

  // Test 20: Mobile responsiveness
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    // Sidebar should be hidden
    const sidebarVisible = await page.locator('aside').isVisible().catch(() => false);
    log('Mobile: sidebar hidden', !sidebarVisible ? 'PASS' : 'FAIL');
    // Reset viewport
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
  } catch (e) {
    log('Mobile: sidebar hidden', 'FAIL', e.message);
  }

  // Test 21: No unexpected console errors (network errors from missing backend are expected in demo mode)
  const criticalErrors = consoleErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('404') &&
    !e.includes('ERR_CONNECTION_REFUSED') &&
    !e.includes('Failed to fetch') &&
    !e.includes('net::ERR')
  );
  log('No unexpected console errors', criticalErrors.length === 0 ? 'PASS' : 'FAIL',
    criticalErrors.length > 0 ? criticalErrors.join('; ').substring(0, 100) : 'No errors');

  // Summary
  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.test}: ${r.detail}`);
    });
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
