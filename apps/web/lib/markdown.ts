/**
 * Markdown to an HTML file, and HTML to Markdown.
 *
 * Neither direction renders anything in the app: the result is a file to
 * download. It is still a file someone will open, so what could run where it
 * is opened does not survive — raw HTML in Markdown is written as text, and a
 * link or image whose address could run code keeps its text and loses the
 * address.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * An address a converted document may keep: the web, mail, and the document's
 * own relative links and fragments. Any other scheme — `javascript:`, `data:`,
 * `vbscript:` — is dropped. Whitespace and control characters are removed
 * before the scheme is read, because browsers ignore them inside one.
 */
function safeUrl(href: string): string | null {
  const url = href.trim()
  const compact = url.replace(/[\u0000-\u0020]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase()
  if (scheme === undefined) return url
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto'
    ? url
    : null
}

// ------------------------------------------------------- Markdown to HTML

/** A complete HTML document from Markdown. `marked` loads only when used. */
export async function markdownToHtml(
  markdown: string,
  title: string,
): Promise<string> {
  const { Marked } = await import('marked')
  const marked = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }) => escapeHtml(text),
      link({ href, title: linkTitle, tokens }) {
        const text = this.parser.parseInline(tokens)
        const url = safeUrl(href)
        if (url === null) return text
        const titled = linkTitle ? ` title="${escapeHtml(linkTitle)}"` : ''
        return `<a href="${escapeHtml(url)}"${titled}>${text}</a>`
      },
      image({ href, title: imageTitle, text }) {
        const url = safeUrl(href)
        if (url === null) return escapeHtml(text)
        const titled = imageTitle ? ` title="${escapeHtml(imageTitle)}"` : ''
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titled}>`
      },
    },
  })

  const body = await marked.parse(markdown)
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    body.trimEnd(),
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

// ------------------------------------------------------- HTML to Markdown

const ELEMENT = 1
const TEXT = 3

/** Elements whose content is not part of the document's text. */
const SKIPPED = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'CANVAS',
  'HEAD',
])

/** Elements that start a block of their own rather than flowing in a line. */
const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'DL',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
  ...SKIPPED,
])

function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_`[\]]/g, '\\$&')
}

function wrap(marker: string, text: string): string {
  return text.trim() === '' ? text : `${marker}${text}${marker}`
}

function destination(url: string): string {
  return /[\s()]/.test(url) ? `<${url}>` : url
}

function inline(node: Node): string {
  if (node.nodeType === TEXT) {
    return escapeMarkdown((node.nodeValue ?? '').replace(/\s+/g, ' '))
  }
  if (node.nodeType !== ELEMENT) return ''

  const element = node as Element
  const tag = element.tagName.toUpperCase()
  if (SKIPPED.has(tag)) return ''
  const content = () => Array.from(element.childNodes).map(inline).join('')

  switch (tag) {
    case 'STRONG':
    case 'B':
      return wrap('**', content())
    case 'EM':
    case 'I':
      return wrap('*', content())
    case 'CODE': {
      const code = element.textContent ?? ''
      return code.includes('`') ? `\`\` ${code} \`\`` : `\`${code}\``
    }
    case 'A': {
      const text = content()
      const href = element.getAttribute('href')
      const url = href === null ? null : safeUrl(href)
      return url === null || url === ''
        ? text
        : `[${text}](${destination(url)})`
    }
    case 'IMG': {
      const url = safeUrl(element.getAttribute('src') ?? '')
      if (!url) return ''
      const alt = escapeMarkdown(element.getAttribute('alt') ?? '')
      return `![${alt}](${destination(url)})`
    }
    case 'BR':
      return '  \n'
    default:
      return content()
  }
}

function list(element: Element): string {
  const ordered = element.tagName.toUpperCase() === 'OL'
  const items = Array.from(element.children).filter(
    (child) => child.tagName.toUpperCase() === 'LI',
  )
  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : '- '
      const [first = '', ...rest] = blocks(item).join('\n').split('\n')
      const indent = ' '.repeat(marker.length)
      return [marker + first, ...rest.map((line) => indent + line)].join('\n')
    })
    .join('\n')
}

function table(element: Element): string {
  const rows = Array.from(element.querySelectorAll('tr')).map((row) =>
    Array.from(row.children)
      .filter((cell) => /^T[HD]$/i.test(cell.tagName))
      .map((cell) => inline(cell).trim().replace(/\|/g, '\\|')),
  )
  const [header, ...body] = rows
  if (!header) return ''

  const width = Math.max(...rows.map((row) => row.length))
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
  return [
    line(header),
    line(Array.from({ length: width }, () => '---')),
    ...body.map(line),
  ].join('\n')
}

function block(element: Element): string[] {
  const tag = element.tagName.toUpperCase()
  if (SKIPPED.has(tag)) return []

  const heading = /^H([1-6])$/.exec(tag)
  if (heading) {
    const text = inline(element).trim()
    return text ? [`${'#'.repeat(Number(heading[1]))} ${text}`] : []
  }

  switch (tag) {
    case 'P': {
      const text = inline(element).trim()
      return text ? [text] : []
    }
    case 'UL':
    case 'OL':
      return [list(element)]
    case 'PRE':
      return [
        `\`\`\`\n${(element.textContent ?? '').replace(/\n$/, '')}\n\`\`\``,
      ]
    case 'TABLE':
      return [table(element)]
    case 'HR':
      return ['---']
    case 'BLOCKQUOTE':
      return [
        blocks(element)
          .join('\n\n')
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n'),
      ]
    default:
      return blocks(element)
  }
}

function blocks(parent: Element): string[] {
  const out: string[] = []
  let line = ''
  const flush = () => {
    const text = line.trim()
    if (text) out.push(text)
    line = ''
  }

  for (const child of Array.from(parent.childNodes)) {
    const isBlock =
      child.nodeType === ELEMENT &&
      BLOCKS.has((child as Element).tagName.toUpperCase())
    if (isBlock) {
      flush()
      out.push(...block(child as Element))
    } else {
      line += inline(child)
    }
  }
  flush()
  return out.filter(Boolean)
}

/**
 * Markdown from HTML: headings, paragraphs, links, images, lists, tables,
 * code, emphasis and strong text. Anything else keeps its text. Scripts,
 * styles and the document's head are left out.
 *
 * `DOMParser` builds an inert document — no script runs and no image loads.
 */
export function htmlToMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const text = blocks(document.body).join('\n\n')
  return text ? `${text}\n` : ''
}
