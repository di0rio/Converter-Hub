import Link from 'next/link'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { HUB_NAME, type ConverterTool } from '@/lib/tools'

export function ToolHeader({
  tool,
}: {
  tool: ConverterTool
}): React.ReactElement {
  return (
    <header>
      <Breadcrumb className="mb-3">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" prefetch={false} />}>
              {HUB_NAME}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{tool.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
        {tool.heading}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
    </header>
  )
}
