import Link from 'next/link'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { HUB_NAME, HUB_TAGLINE, TOOLS } from '@/lib/tools'

/**
 * A tool's card on the hub.
 *
 * The whole card is the link rather than a button inside it: a card-sized
 * target is easier to hit on a phone, and it leaves one tab stop per tool
 * instead of one stop that does nothing plus one that navigates.
 */
function ToolCard({
  tool,
  index,
}: {
  tool: (typeof TOOLS)[number]
  index: number
}) {
  const { Icon } = tool

  return (
    <Link
      href={tool.href}
      // The lift is small on purpose: enough to say the card is the target,
      // not so much that the grid moves while the eye scans it. The press
      // scale is the same feedback every button in the product gives.
      style={{ animationDelay: `${index * 60}ms` }}
      className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-[background-color,border-color,box-shadow,translate,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-input hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-safe:animate-step-in motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-sm motion-safe:active:scale-[0.99] motion-safe:active:translate-y-0"
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[0.625rem] bg-foreground text-background">
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="font-semibold tracking-tight">{tool.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{tool.tagline}</p>
      </div>

      {/* What goes in and what comes out are separate facts, so they are
          labelled rather than run together into one list of formats. */}
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-baseline gap-1.5">
          <dt>Reads</dt>
          <dd className="font-medium text-foreground">
            {tool.source.join(', ')}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt>Writes</dt>
          <dd className="font-medium text-foreground">
            {tool.output.join(', ')}
          </dd>
        </div>
      </dl>

      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        Open
        <ArrowRight
          className="size-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </Link>
  )
}

export function Hub(): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-3xl py-10 sm:py-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {HUB_NAME}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {HUB_TAGLINE}
        </p>
      </header>

      <section aria-labelledby="tools-heading" className="mt-10">
        <h2
          id="tools-heading"
          className="mb-3 text-base font-semibold sm:text-sm"
        >
          Tools
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          {TOOLS.map((tool, index) => (
            <ToolCard key={tool.id} tool={tool} index={index} />
          ))}
        </div>
      </section>

      <p className="mt-10 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
        <span>
          Every tool here reads your file in the browser and writes the result
          back to it. Your data never leaves this tab, there is no server behind
          any of this, and no SQL from your files is ever executed.
        </span>
      </p>
    </div>
  )
}
