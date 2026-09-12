/**
 * Identifier case conversion.
 *
 * A line is split into words at every run of anything that is not a letter or
 * a digit - spaces, punctuation, `_`, `-`, `.` - and again where a lowercase
 * letter meets an uppercase one (`userName`) or an acronym meets the next word
 * (`XMLHttp`). Digits stay with the word before them (`id2`). Accented and
 * non-Latin letters are letters; case is changed with the locale-independent
 * rules, so the result does not depend on the machine it runs on.
 *
 * Each line converts on its own, so a list of names converts in one go.
 */

export const CASE_STYLES = [
  'camel',
  'pascal',
  'snake',
  'kebab',
  'screaming',
  'dot',
  'title',
] as const

export type CaseStyle = (typeof CASE_STYLES)[number]

function words(line: string): string[] {
  return line
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((chunk) =>
      chunk.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u),
    )
    .filter(Boolean)
}

const capital = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

function convert(line: string, style: CaseStyle): string {
  const parts = words(line)
  const lower = parts.map((word) => word.toLowerCase())
  switch (style) {
    case 'camel':
      return parts
        .map((word, i) => (i === 0 ? word.toLowerCase() : capital(word)))
        .join('')
    case 'pascal':
      return parts.map(capital).join('')
    case 'snake':
      return lower.join('_')
    case 'kebab':
      return lower.join('-')
    case 'screaming':
      return parts.map((word) => word.toUpperCase()).join('_')
    case 'dot':
      return lower.join('.')
    case 'title':
      return parts.map(capital).join(' ')
  }
}

export function toCase(text: string, style: CaseStyle): string {
  return text
    .split('\n')
    .map((line) => convert(line, style))
    .join('\n')
}
