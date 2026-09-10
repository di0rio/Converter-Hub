import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { htmlToMarkdown, markdownToHtml } from '@/lib/markdown'

const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '..', '..', '..', 'examples', 'markdown', name),
    'utf8',
  )

describe('markdownToHtml', () => {
  it('writes a complete document, titled and in UTF-8', async () => {
    const html = await markdownToHtml('# Hi', 'Notes <draft>')

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<title>Notes &lt;draft&gt;</title>')
    expect(html).toContain('<h1>Hi</h1>')
  })

  it('renders the elements a document is made of', async () => {
    const html = await markdownToHtml(fixture('sample.md'), 'sample')

    expect(html).toContain('<em>synthetic</em>')
    expect(html).toContain('<strong>strong</strong>')
    expect(html).toContain('<code>inline code</code>')
    expect(html).toContain(
      '<a href="https://example.com" title="Example">link</a>',
    )
    expect(html).toContain('<li>first item</li>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<th>Name</th>')
    expect(html).toContain('<img src="diagram.png" alt="A diagram">')
  })

  it('escapes raw HTML instead of passing it through', async () => {
    const html = await markdownToHtml(
      '<script>alert(1)</script>\n\nText <img src=x onerror=alert(1)> here',
      'x',
    )

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('drops a link or image whose address could run code', async () => {
    const html = await markdownToHtml(
      '[click](javascript:alert(1)) ![x](javascript:alert(2)) [data](data:text/html,hi)',
      'x',
    )

    expect(html).not.toMatch(/javascript:/i)
    expect(html).not.toContain('data:text/html')
    expect(html).toContain('click')
  })

  it('keeps web, mail and relative addresses', async () => {
    const html = await markdownToHtml(
      '[a](https://a.example) [b](mailto:b@example.com) [c](./c.md) [d](#top)',
      'x',
    )

    expect(html).toContain('href="https://a.example"')
    expect(html).toContain('href="mailto:b@example.com"')
    expect(html).toContain('href="./c.md"')
    expect(html).toContain('href="#top"')
  })
})

describe('htmlToMarkdown', () => {
  it('writes headings, paragraphs, emphasis, code and links', () => {
    const md = htmlToMarkdown(fixture('sample.html'))

    expect(md).toContain('# Field notes')
    expect(md).toContain(
      'A *synthetic* page with **strong** text, `inline code` and a [link](https://example.com).',
    )
  })

  it('writes lists, tables, code blocks and images', () => {
    const md = htmlToMarkdown(fixture('sample.html'))

    expect(md).toContain('- first item\n- second item')
    expect(md).toContain('1. one\n2. two')
    expect(md).toContain('| Name | City |\n| --- | --- |\n| Ada | London |')
    expect(md).toContain("```\nconsole.log('hello')\n```")
    expect(md).toContain('![A diagram](diagram.png)')
  })

  it('leaves scripts, styles and the head out', () => {
    const md = htmlToMarkdown(fixture('sample.html'))

    expect(md).not.toContain('alert')
    expect(md).not.toContain('color: red')
    expect(md.match(/Field notes/g)).toHaveLength(1)
  })

  it('escapes text that Markdown would read as formatting', () => {
    expect(htmlToMarkdown('<p>2 * 3 = [six] _ok_</p>')).toBe(
      '2 \\* 3 = \\[six\\] \\_ok\\_\n',
    )
  })

  it('keeps the text of a link whose address could run code, and drops the address', () => {
    const md = htmlToMarkdown('<p><a href="javascript:alert(1)">click</a></p>')

    expect(md).toBe('click\n')
  })
})
