/**
 * Hand a finished file to the browser.
 *
 * Every tool ends the same way — bytes or text in memory, a file on disk — so
 * the object URL dance lives here once. Bytes are copied into a fresh buffer
 * because the Blob constructor needs a plain ArrayBuffer, and copying keeps the
 * file off any shared view the caller still holds.
 *
 * Nothing here touches the network: a blob: URL is the same tab's own memory.
 */
export function downloadFile(
  content: Uint8Array | string,
  filename: string,
  type: string,
): void {
  let part: ArrayBuffer | string = content as string
  if (typeof content !== 'string') {
    part = new ArrayBuffer(content.byteLength)
    new Uint8Array(part).set(content)
  }

  const url = URL.createObjectURL(new Blob([part], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadZip(bytes: Uint8Array, filename: string): void {
  downloadFile(bytes, filename, 'application/zip')
}
