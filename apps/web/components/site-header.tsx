'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'

const noop = () => () => {}

/** Top bar as a terminal prompt: `cd/hub ~/sql $` always shows where you are. */
export function SiteHeader(): React.ReactElement {
  const path = usePathname() ?? '/'
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
  const dark = mounted && resolvedTheme === 'dark'

  return (
    <header className="border-b border-border">
      <div className="flex h-12 w-full items-center justify-between gap-4 px-4 lg:px-6">
        <Link
          href="/"
          prefetch={false}
          aria-label="Converter Hub, home"
          className="flex min-w-0 items-center gap-2.5 rounded-md font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-bold text-foreground">
            cd<span className="text-brand-foreground">/</span>hub
          </span>
          <span aria-hidden="true" className="hidden truncate text-muted-foreground sm:inline">
            ~{path === '/' ? '' : path} ${' '}
            <span className="inline-block h-[1em] w-[0.5em] translate-y-[0.15em] bg-brand motion-safe:animate-caret" />
          </span>
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
          {mounted && (dark ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />)}
        </Button>
      </div>
    </header>
  )
}
