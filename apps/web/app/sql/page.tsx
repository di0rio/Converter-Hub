import { SqlExtractor } from '@/components/sql-extractor'
import { findTool } from '@/lib/tools'

const tool = findTool('sql')

export const metadata = {
  title: tool.name,
  description: tool.description,
}

export default function SqlPage() {
  return (
    // On a wide screen the shell owns the viewport height, so the workspace
    // fills what is left instead of growing the page. On a narrow one the
    // steps stack and the document scrolls, because pinning the height there
    // would squeeze the whole flow into one screen it cannot fit.
    <main className="flex w-full p-4 lg:h-dvh lg:overflow-hidden lg:p-6">
      <SqlExtractor />
    </main>
  )
}
