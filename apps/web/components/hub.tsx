'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRightIcon, ShieldCheck, Upload, WifiOff } from 'lucide-react'
import { useRef, useState } from 'react'
import { ALL_EXTENSIONS, setPendingFile, toolForFile } from '@/lib/handoff'
import { HUB_TAGLINE, TOOLS } from '@/lib/tools'
import { cn } from '@/lib/utils'

/**
 * Drop any file anywhere on the page: the hub picks the tool by extension and opens it with
 * the file already loaded. Choosing a tool by hand stays one click away in the list below.
 */
function DropZone(): React.ReactElement {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const depth = useRef(0)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open(files: FileList | null | undefined) {
    const file = files?.[0]
    if (!file) return
    const tool = toolForFile(file.name)
    if (!tool) {
      setError(`No tool reads ${file.name.split('.').pop()?.toUpperCase() ?? 'that'} files yet. Pick one below.`)
      return
    }
    setError(null)
    setPendingFile(file)
    router.push(tool.href)
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current += 1
        setOver(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        open(e.dataTransfer.files)
      }}
      className={cn(
        'relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-[border-color,background-color] duration-150',
        over ? 'border-brand bg-brand/10' : 'border-border bg-card',
      )}
    >
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept={ALL_EXTENSIONS.join(',')}
        aria-label="Choose a file to convert"
        onChange={(e) => {
          open(e.target.files)
          e.target.value = ''
        }}
      />
      <span
        className={cn(
          'grid size-12 place-items-center rounded-xl border-2 border-black bg-brand text-brand-contrast shadow-[3px_3px_0_#1c1c1c] transition-transform duration-200 ease-out',
          over && 'motion-safe:-translate-y-1 motion-safe:-rotate-3',
        )}
      >
        <Upload className="size-5" aria-hidden="true" />
      </span>
      <p className="font-heading font-medium">
        {over ? 'Drop it.' : 'Drop any file here'}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        A spreadsheet, a database dump, a JSON, an image… the right tool opens with your file in it.
      </p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="mt-1 h-9 rounded-lg bg-foreground px-4 text-sm font-medium text-background outline-none transition-transform duration-100 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:active:scale-[0.98]"
      >
        or choose a file
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  )
}

export function Hub(): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-3xl py-14 sm:py-20">
      <header>
        <h1 className="max-w-xl text-balance font-heading text-[40px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">
          convert files without sending them anywhere.
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-muted-foreground">{HUB_TAGLINE}</p>
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-brand-foreground" aria-hidden="true" /> nothing is uploaded
          </li>
          <li className="flex items-center gap-1.5">
            <WifiOff className="size-4 text-brand-foreground" aria-hidden="true" /> works offline once loaded
          </li>
        </ul>
      </header>

      <section aria-label="Open a file" className="mt-10">
        <DropZone />
      </section>

      <section aria-labelledby="tools-heading" className="mt-16">
        <h2 id="tools-heading" className="mb-5 text-muted-foreground">
          tools
        </h2>
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {TOOLS.map((tool) => {
            const { Icon } = tool
            return (
              <li key={tool.id}>
                <Link
                  href={tool.href}
                  prefetch={false}
                  className="group -mx-3 grid grid-cols-[auto_1fr_auto] items-start gap-4 rounded-lg px-3 py-4 outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium">{tool.name}</span>
                    <span className="block text-sm text-muted-foreground">{tool.tagline}</span>
                    <span className="mt-1.5 block truncate font-mono text-xs text-muted-foreground">
                      {tool.source.join(' · ')} → {tool.output.join(' · ')}
                    </span>
                  </span>
                  <ArrowUpRightIcon
                    className="mt-0.5 size-4 text-muted-foreground transition-[translate,color] duration-200 ease-out group-hover:text-brand-foreground motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <p className="mt-10 text-xs text-muted-foreground">
        Every tool reads your file in the browser and writes the result back to it. Your data never leaves this tab,
        there is no server behind any of this, and no SQL from your files is ever executed.
      </p>
    </div>
  )
}
