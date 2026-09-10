import { SqliteConverter } from '@/components/sqlite-converter'
import { findTool } from '@/lib/tools'

const tool = findTool('sqlite')

export const metadata = {
  title: tool.name,
  description: tool.description,
}

export default function SqlitePage() {
  return (
    <main className="flex w-full p-4 lg:h-dvh lg:overflow-hidden lg:p-6">
      <SqliteConverter />
    </main>
  )
}
