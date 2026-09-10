import { MarkdownConverter } from '@/components/markdown-converter'
import { findTool } from '@/lib/tools'

const tool = findTool('markdown')

export const metadata = {
  title: tool.name,
  description: tool.description,
}

export default function MarkdownPage() {
  return (
    <main className="flex w-full p-4 lg:p-6">
      <MarkdownConverter />
    </main>
  )
}
