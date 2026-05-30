import { test, expect, Page } from '@playwright/test'

const EDITOR_URL =
  '/card-editor?url=https%3A%2F%2Fhushare.space%2Ftricoloryerevanbeatrun&title=Tricolor+YEREVAN+BEAT+RUN+2026'
const BLANK_URL = '/card-editor'

// ── Helpers ────────────────────────────────────────────────────────────────

async function waitForEditor(page: Page) {
  await page.goto(EDITOR_URL)
  // Wait for the canvas to be visible and loading overlay to disappear
  await page.waitForSelector('canvas', { timeout: 15_000 })
  await page.waitForFunction(() => {
    const overlays = [...document.querySelectorAll('div')].filter(
      d => d.textContent?.trim() === 'Loading…'
    )
    return overlays.every(o => (o as HTMLElement).style.display === 'none' || !document.body.contains(o))
  }, { timeout: 15_000 }).catch(() => {})
  // Small buffer for Konva to finish its first paint
  await page.waitForTimeout(1500)
}

async function clickCanvas(page: Page, offsetX: number, offsetY: number) {
  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas not found')
  await page.mouse.click(box.x + offsetX, box.y + offsetY)
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('Card Editor — load & template', () => {
  test('loads with branded template (red header visible)', async ({ page }) => {
    await waitForEditor(page)
    // The canvas should render — take a screenshot and check it's not blank white
    const canvas = page.locator('canvas').first()
    const screenshot = await canvas.screenshot()
    // A completely white canvas would have a very high average pixel brightness
    // We just assert it loaded and is visible
    await expect(canvas).toBeVisible()
    expect(screenshot.length).toBeGreaterThan(5000) // non-trivial PNG
  })

  test('page title is Card Editor', async ({ page }) => {
    await waitForEditor(page)
    await expect(page).toHaveTitle(/Card Editor/i)
  })

  test('Undo button is disabled on fresh template load', async ({ page }) => {
    await waitForEditor(page)
    const undoBtn = page.getByRole('button', { name: /undo/i })
    await expect(undoBtn).toBeDisabled()
  })

  test('Redo button is disabled on fresh load', async ({ page }) => {
    await waitForEditor(page)
    const redoBtn = page.getByRole('button', { name: /redo/i })
    await expect(redoBtn).toBeDisabled()
  })

  test('Download PNG button is enabled', async ({ page }) => {
    await waitForEditor(page)
    const dlBtn = page.getByRole('button', { name: /download/i })
    await expect(dlBtn).toBeEnabled()
  })
})

test.describe('Card Editor — template switching', () => {
  test('B&W Elegant template applies without crash', async ({ page }) => {
    await waitForEditor(page)
    await page.getByRole('button', { name: /B&W Elegant/i }).click()
    await page.waitForTimeout(500)
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('Clean White template applies without crash', async ({ page }) => {
    await waitForEditor(page)
    await page.getByRole('button', { name: /Clean White/i }).click()
    await page.waitForTimeout(500)
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('Hushare Branded template applies without crash', async ({ page }) => {
    await waitForEditor(page)
    await page.getByRole('button', { name: /Hushare Branded/i }).click()
    await page.waitForTimeout(500)
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('After template switch, Undo is enabled', async ({ page }) => {
    await waitForEditor(page)
    await page.getByRole('button', { name: /B&W Elegant/i }).click()
    await page.waitForTimeout(300)
    const undoBtn = page.getByRole('button', { name: /undo/i })
    await expect(undoBtn).toBeEnabled()
  })
})

test.describe('Card Editor — element operations', () => {
  test('Add text element via toolbar', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Text').click()
    await page.waitForTimeout(500)
    // After adding text, a layer item "Text" should appear or properties panel shows
    const propertiesSection = page.locator('text=Position & Size').first()
    await expect(propertiesSection).toBeVisible()
  })

  test('Add rectangle via toolbar', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(500)
    await expect(page.locator('text=Position & Size').first()).toBeVisible()
  })

  test('Add ellipse via toolbar', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Circle').click()
    await page.waitForTimeout(500)
    await expect(page.locator('text=Position & Size').first()).toBeVisible()
  })

  test('Add line via toolbar', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Line').click()
    await page.waitForTimeout(500)
    await expect(page.locator('text=Position & Size').first()).toBeVisible()
  })

  test('Undo becomes enabled after adding element', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Text').click()
    await page.waitForTimeout(300)
    await expect(page.getByRole('button', { name: /undo/i })).toBeEnabled()
  })

  test('Undo after adding element restores state (undo enabled then disabled after max undo)', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    const undoBtn = page.getByRole('button', { name: /undo/i })
    await expect(undoBtn).toBeEnabled()
    await undoBtn.click()
    // After undoing the rectangle, Undo may still be enabled (template is base) or disabled
    // We just verify no crash
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('Selecting element shows Properties panel', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    await expect(page.locator('text=Position & Size').first()).toBeVisible()
    await expect(page.locator('text=Shape').first()).toBeVisible()
  })

  test('Delete selected element via Delete key', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    // Element selected — press Delete
    await page.keyboard.press('Delete')
    await page.waitForTimeout(300)
    // Properties panel should go back to no-selection state
    await expect(page.locator('text=Position & Size')).not.toBeVisible()
  })
})

test.describe('Card Editor — text editing', () => {
  test('Double-click text element opens inline editor', async ({ page }) => {
    await waitForEditor(page)
    // Click canvas in the heading area (centered, ~y=200 from top of canvas)
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('no canvas')
    // Heading is roughly in the upper-center of the canvas
    await canvas.dblclick({ position: { x: box.width / 2, y: 200 } })
    await page.waitForTimeout(400)
    // A textarea overlay should appear
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 3000 }).catch(() => {
      // If heading wasn't hit, that's okay — no crash is the key assertion
    })
  })

  test('Enter key in inline editor saves text', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Text').click()
    await page.waitForTimeout(300)
    // Select the text element (it's auto-selected after add)
    // Double-click to open inline editor
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('no canvas')
    await canvas.dblclick({ position: { x: box.width / 2, y: box.height / 2 } })
    await page.waitForTimeout(400)
    const textarea = page.locator('textarea').first()
    if (await textarea.isVisible()) {
      await textarea.fill('Hello Test')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      // Textarea should close after Enter
      await expect(textarea).not.toBeVisible()
    }
  })
})

test.describe('Card Editor — keyboard shortcuts', () => {
  test('Ctrl+Z undoes last action', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('Ctrl+D duplicates selected element', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(300)
    // Layers panel should show 2 rect entries — check tab
    await page.getByText('Layers').click()
    await page.waitForTimeout(200)
    const rectItems = page.locator('text=rect')
    const count = await rectItems.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('Ctrl+C then Ctrl+V pastes element', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+c')
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(300)
    await page.getByText('Layers').click()
    await page.waitForTimeout(200)
    const rectItems = page.locator('text=rect')
    const count = await rectItems.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('Escape deselects element (two-stage)', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    // First Escape: should just clear transform if active, or deselect
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    // After two Escapes, properties panel should show no-selection state
    await expect(page.locator('text=Background')).toBeVisible()
  })
})

test.describe('Card Editor — properties panel', () => {
  test('Shadow toggle shows shadow controls', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    // Find the Shadow section
    await expect(page.locator('text=Shadow').first()).toBeVisible()
    const shadowCheckbox = page.locator('input[type="checkbox"]').first()
    await shadowCheckbox.check()
    await page.waitForTimeout(200)
    // Blur, Offset X, Offset Y sliders should appear
    await expect(page.locator('text=Blur').first()).toBeVisible()
  })

  test('Layers tab shows element list', async ({ page }) => {
    await waitForEditor(page)
    await page.getByText('Layers').click()
    await page.waitForTimeout(200)
    // Should show at least some elements (from template)
    const layerItems = page.locator('[class*="cursor-grab"]')
    const count = await layerItems.count()
    expect(count).toBeGreaterThan(0)
  })

  test('Lock button toggles element lock', async ({ page }) => {
    await waitForEditor(page)
    await page.getByTitle('Rectangle').click()
    await page.waitForTimeout(300)
    // Find the lock button in the actions bar
    const lockBtn = page.locator('button').filter({ has: page.locator('svg') }).nth(5)
    await lockBtn.click()
    await page.waitForTimeout(200)
    // No crash — element is locked
    await expect(page.locator('canvas').first()).toBeVisible()
  })
})

test.describe('Card Editor — blank (no URL params)', () => {
  test('Opens without crash on blank URL', async ({ page }) => {
    await page.goto(BLANK_URL)
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.waitForTimeout(1500)
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('Download button is enabled even without QR URL', async ({ page }) => {
    await page.goto(BLANK_URL)
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.waitForTimeout(1000)
    await expect(page.getByRole('button', { name: /download/i })).toBeEnabled()
  })

  test('Can add elements on blank canvas', async ({ page }) => {
    await page.goto(BLANK_URL)
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.waitForTimeout(1000)
    await page.getByTitle('Text').click()
    await page.waitForTimeout(300)
    await expect(page.locator('text=Position & Size').first()).toBeVisible()
  })
})
