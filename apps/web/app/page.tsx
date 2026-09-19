import { Hub } from '@/components/hub'
import { HUB_NAME, HUB_TAGLINE } from '@/lib/tools'

export const metadata = {
  title: HUB_NAME,
  description: HUB_TAGLINE,
}

export default function Home() {
  return (
    <main className="w-full flex-1 px-4 lg:px-6">
      <Hub />
    </main>
  )
}
