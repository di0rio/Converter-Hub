import type { Metadata, Viewport } from 'next'
import { Ubuntu, Ubuntu_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import './globals.css'
import { ServiceWorker } from '@/components/service-worker'
import { SiteHeader } from '@/components/site-header'
import { cn } from '@/lib/utils'
import { HUB_NAME, HUB_TAGLINE } from '@/lib/tools'

const ubuntu = Ubuntu({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-sans' })
const ubuntuHeading = Ubuntu({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-heading' })
const ubuntuMono = Ubuntu_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: { default: HUB_NAME, template: `%s · ${HUB_NAME}` },
  description: HUB_TAGLINE,
  applicationName: HUB_NAME,
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f4ee' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1c1c' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn('h-full antialiased font-sans', ubuntu.variable, ubuntuHeading.variable, ubuntuMono.variable)}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <SiteHeader />
          {children}
          <ServiceWorker />
        </ThemeProvider>
      </body>
    </html>
  )
}
