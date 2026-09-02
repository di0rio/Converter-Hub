import { SqlExtractor } from '@/components/sql-extractor'

export default function Home() {
  return (
    // The shell owns the viewport height so the workspace can fill what is left
    // instead of growing the page.
    <main className="flex h-dvh w-full overflow-hidden p-4 lg:p-6">
      <SqlExtractor />
    </main>
  )
}
