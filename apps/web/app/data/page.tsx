import { DataConverter } from '@/components/data-converter'
import { findTool } from '@/lib/tools'

const tool = findTool('data')

export const metadata = {
  title: tool.name,
  description: tool.description,
}

export default function DataPage() {
  return (
    <main className="flex w-full p-4 lg:p-6">
      <DataConverter />
    </main>
  )
}
