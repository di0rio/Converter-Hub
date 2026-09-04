import '@testing-library/jest-dom/vitest'

// jsdom does not implement Blob.prototype.text()/File.prototype.text(), which the
// FileUpload component relies on (available in browsers). Polyfill it for tests using
// FileReader so file uploads behave identically to production.
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
