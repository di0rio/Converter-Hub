/**
 * Build the image the browser shows under the cursor while dragging a row into
 * the workspace.
 *
 * It must be in the document to be rasterised, but a plain `appendChild` puts a
 * block-level div in normal flow, where `width: auto` resolves to the full body
 * width — that is what made the drag image span the viewport. Taking it out of
 * flow and shrink-wrapping it keeps the snapshot the size of its own content.
 *
 * Both tools drag rows into the same workspace, so both draw the same ghost.
 */
export function createDragGhost(label: string, detail: string): HTMLElement {
  const ghost = document.createElement('div')

  const name = document.createElement('span')
  name.textContent = label
  const rows = document.createElement('span')
  rows.textContent = detail

  ghost.append(name, rows)
  ghost.style.cssText = [
    'position:fixed',
    'top:-1000px',
    'left:-1000px',
    'width:max-content',
    'max-width:16rem',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:6px 10px',
    'border-radius:8px',
    'border:1px solid var(--border)',
    'background:var(--popover)',
    'color:var(--popover-foreground)',
    'font-size:13px',
    'font-weight:500',
    'line-height:1.2',
    'white-space:nowrap',
    'box-shadow:0 8px 24px rgb(0 0 0 / 0.18)',
    'pointer-events:none',
  ].join(';')
  rows.style.cssText =
    'opacity:.6;font-weight:400;font-variant-numeric:tabular-nums'

  return ghost
}
