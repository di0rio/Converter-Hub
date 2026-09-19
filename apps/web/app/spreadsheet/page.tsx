import { SheetSplitter } from '@/components/spreadsheet/sheet-splitter'
import { findTool } from '@/lib/tools'

const tool = findTool('spreadsheet')

export const metadata = {
  title: tool.name,
  description: tool.description,
}

export default function SpreadsheetPage() {
  return (
    <main className="flex w-full p-4 lg:h-dvh lg:overflow-hidden lg:p-6">
      <SheetSplitter />
    </main>
  )
}
