/**
 * Hand a generated archive to the browser.
 *
 * Both tools finish the same way — bytes in memory, a ZIP on disk — so the
 * object URL dance lives here once. The bytes are copied into a fresh buffer
 * because the Blob constructor needs a plain ArrayBuffer, and copying keeps the
 * archive off any shared view the caller still holds.
 *
 * Nothing here touches the network: a blob: URL is the same tab's own memory.
 */
export function downloadZip(bytes: Uint8Array, filename: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)

  const url = URL.createObjectURL(
    new Blob([buffer], { type: 'application/zip' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
