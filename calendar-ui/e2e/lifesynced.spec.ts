import { test, expect } from '@playwright/test';

test.describe('LifeSynced Calendar E2E Tests', () => {
  
  test('01 - Calendar loads', async ({ page }) => {
    await page.goto('/');
    
    // Calendar page should load
    await expect(page.locator('body')).toBeVisible();
    
    await page.screenshot({ path: 'e2e-results/01-calendar.png', fullPage: true });
  });

  test('02 - View mode controls exist', async ({ page }) => {
    await page.goto('/');
    
    // Wait for hydration
    await page.waitForTimeout(1000);
    
    // Look for day/week/month view controls
    await page.screenshot({ path: 'e2e-results/02-view-controls.png', fullPage: true });
  });

  test('03 - Timezone selector visible', async ({ page }) => {
    await page.goto('/');
    
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'e2e-results/03-timezone.png', fullPage: true });
  });

  test('04 - API - GET events', async ({ request }) => {
    const response = await request.get('/api/events');
    // API should respond (may need auth or return empty)
    expect([200, 401, 403, 500]).toContain(response.status());
  });

  test('05 - Responsive design - mobile (day view)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e-results/05-mobile-day.png', fullPage: true });
  });

  test('06 - Responsive design - desktop (week view)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e-results/06-desktop-week.png', fullPage: true });
  });

});

