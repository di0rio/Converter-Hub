import { TextTool } from '@/components/text-tool'
import { findTool } from '@/lib/tools'

const tool = findTool('case')

export const metadata = {
  title: tool.name,
  description: tool.description,
}

export default function CasePage() {
  return (
    <main className="flex w-full p-4 lg:p-6">
      <TextTool id="case" />
    </main>
  )
}
