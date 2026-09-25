// With a mouse, picking a field type makes it follow the pointer until it is clicked onto a
// page. Tests do the same: pick it, then click the page in view (or `page`), lower each time
// so fields do not land on each other.
const placed = new WeakMap()

export async function addField(page, name, { page: pageNumber } = {}) {
  await page.getByRole('button', { name, exact: true }).click()
  await placePickedField(page, { page: pageNumber })
}

/** Click the field that is following the pointer onto the page in view (or `page`). */
export async function placePickedField(page, { page: pageNumber } = {}) {
  let target = pageNumber
  if (!target) {
    const indicator = page.getByTestId('page-indicator')
    target = (await indicator.count()) ? Number((await indicator.textContent()).match(/Page (\d+)/)[1]) : 1
  }
  const count = placed.get(page) ?? 0
  placed.set(page, count + 1)
  const layer = page.locator(`[data-page="${target}"] [data-testid="placement-layer"]`)
  const box = await layer.boundingBox()
  await layer.click({ position: { x: box.width * 0.3, y: box.height * (0.15 + (count % 8) * 0.09) } })
}
