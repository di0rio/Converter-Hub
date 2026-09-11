import { ImageConverter } from '@/components/image-converter'
import { findTool } from '@/lib/tools'

const tool = findTool('image')

export const metadata = {
  title: tool.name,
  description: tool.description,
}

export default function ImagePage() {
  return (
    <main className="flex w-full p-4 lg:p-6">
      <ImageConverter />
    </main>
  )
}
