import type { Metadata } from 'next'
import { Geist, Geist_Mono, Inter } from 'next/font/google'
import './globals.css'
import { cn } from '@/lib/utils'
import { HUB_NAME, HUB_TAGLINE } from '@/lib/tools'

const interHeading = Inter({ subsets: ['latin'], variable: '--font-heading' })

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  // Each tool sets its own title; the template keeps the product name on the
  // tab without every page having to repeat it.
  title: { default: HUB_NAME, template: `%s · ${HUB_NAME}` },
  description: HUB_TAGLINE,
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={cn(
        'h-full',
        'antialiased',
        geistSans.variable,
        geistMono.variable,
        'font-sans',
        inter.variable,
        interHeading.variable,
      )}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
