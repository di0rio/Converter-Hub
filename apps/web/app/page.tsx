import { SqlExtractor } from '@/components/sql-extractor'

export default function Home() {
  return (
    <main className="no-scrollbar flex min-h-dvh items-start justify-center overflow-y-auto p-4 py-10">
      <SqlExtractor />
    </main>
  )
}
