import '@testing-library/jest-dom/vitest'

if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text() {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}

if (
  typeof window !== 'undefined' &&
  typeof window.PointerEvent !== 'function'
) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pointerType: string

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
}

if (
  typeof Blob !== 'undefined' &&
  typeof Blob.prototype.arrayBuffer !== 'function'
) {
  Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
