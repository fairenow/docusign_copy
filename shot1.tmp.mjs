import { chromium } from '@playwright/test'
const [, , file, out] = process.argv
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
await page.goto('http://localhost:5199/quick-sign')
await page.getByTestId('file-input').setInputFiles(file)
await page.getByTestId('document-page').first().waitFor({ timeout: 60000 })
await page.waitForTimeout(1200)
await page.getByTestId('document-page').first().screenshot({ path: out })
await browser.close()
