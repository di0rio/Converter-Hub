export function downloadFile(
  content: Uint8Array | string,
  filename: string,
  type: string,
): void {
  const part = typeof content === 'string' ? content : content.slice()
  const url = URL.createObjectURL(new Blob([part], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
