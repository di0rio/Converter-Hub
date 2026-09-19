'use client'

import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { snapTarget, sameRect } from '@/lib/window-snap'
import type {
  Rect,
  PreviewWindow as PreviewWindowState,
  WorkspaceBounds,
} from '@/hooks/use-preview-windows'

interface PreviewWindowProps {
  window: PreviewWindowState
  name: string
  children: ReactNode
  rowCount: number
  active: boolean
  bounds: WorkspaceBounds
  onFocus: () => void
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  onChange: (patch: Partial<Omit<PreviewWindowState, 'id' | 'name'>>) => void
  onSnapPreview: (rect: Rect | null) => void
}

const HEADER_HEIGHT = 33
const COLLAPSED_LAYER = 100_000
const SETTLE_MS = 260

type Gesture =
  | { kind: 'move'; grabX: number; grabY: number }
  | { kind: 'resize'; x0: number; y0: number; w: number; h: number }

export function PreviewWindow({
  window: win,
  name,
  children,
  rowCount,
  active,
  bounds,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onChange,
  onSnapPreview,
}: PreviewWindowProps) {
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const pendingSnap = useRef<Rect | null>(null)
  const [dragging, setDragging] = useState(false)
  const [settling, setSettling] = useState(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const capture = (element: HTMLElement, pointerId: number) => {
    try {
      element.setPointerCapture?.(pointerId)
    } catch {}
  }
  const release = (element: HTMLElement, pointerId: number) => {
    try {
      if (element.hasPointerCapture?.(pointerId)) {
        element.releasePointerCapture(pointerId)
      }
    } catch {}
  }

  useEffect(
    () => () => {
      gesture.current = null
      if (settleTimer.current) clearTimeout(settleTimer.current)
    },
    [],
  )

  function settle() {
    setSettling(true)
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => setSettling(false), SETTLE_MS)
  }

  function workspacePoint(event: React.PointerEvent) {
    const parent = root.current?.offsetParent as HTMLElement | null
    if (!parent?.getBoundingClientRect) return null
    const rect = parent.getBoundingClientRect()
    if (!rect.width && !rect.height) return null
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function startMove(event: React.PointerEvent<HTMLElement>) {
    if (event.button && event.button !== 0) return
    onFocus()
    gesture.current = {
      kind: 'move',
      grabX: event.clientX - win.x,
      grabY: event.clientY - win.y,
    }
    setDragging(true)
    capture(event.currentTarget, event.pointerId)
  }

  function startResize(event: React.PointerEvent<HTMLElement>) {
    if (event.button && event.button !== 0) return
    event.preventDefault()
    onFocus()
    gesture.current = {
      kind: 'resize',
      x0: event.clientX,
      y0: event.clientY,
      w: win.width,
      h: win.height,
    }
    capture(event.currentTarget, event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const g = gesture.current
    if (!g) return

    if (g.kind === 'move') {
      const point = workspacePoint(event)
      const target = point ? snapTarget(point, bounds) : null
      if (!sameRect(target, pendingSnap.current)) {
        pendingSnap.current = target
        onSnapPreview(target)
      }
      onChange({ x: event.clientX - g.grabX, y: event.clientY - g.grabY })
      return
    }

    onChange({
      width: g.w + (event.clientX - g.x0),
      height: g.h + (event.clientY - g.y0),
    })
  }

  function endGesture(event: React.PointerEvent<HTMLElement>) {
    const wasMoving = gesture.current?.kind === 'move'
    gesture.current = null
    setDragging(false)
    release(event.currentTarget, event.pointerId)

    const snap = pendingSnap.current
    pendingSnap.current = null
    if (!wasMoving || !snap) {
      if (snap) onSnapPreview(null)
      return
    }

    onSnapPreview(null)
    settle()
    onChange({
      ...snap,
      restore: { x: win.x, y: win.y, width: win.width, height: win.height },
    })
  }

  function onHeaderKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const step = event.shiftKey ? 24 : 8
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = moves[event.key]
    if (!delta) return
    event.preventDefault()
    onFocus()
    onChange({ x: win.x + delta[0], y: win.y + delta[1] })
  }

  function maximize() {
    settle()
    onMaximize()
  }

  const maximized = win.restore !== null
  const height = win.minimized ? HEADER_HEIGHT : win.height

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={`${name} preview`}
      data-active={active ? '' : undefined}
      onPointerDown={onFocus}
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height,
        zIndex: win.minimized ? COLLAPSED_LAYER + win.z : win.z,
      }}
      className={
        'absolute flex flex-col overflow-hidden rounded-xl border bg-card ' +
        'motion-safe:animate-preview-in ' +
        'transition-shadow duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ' +
        (settling
          ? 'motion-safe:transition-[left,top,width,height,box-shadow] ' +
            'motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)] '
          : '') +
        (active
          ? 'border-input shadow-lg shadow-black/[0.13] ring-1 ring-black/[0.04] dark:ring-white/[0.06] '
          : 'border-border shadow-sm shadow-black/[0.06] ')
      }
    >
      <header
        tabIndex={0}
        aria-label={`Move ${name} window`}
        onPointerDown={startMove}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onKeyDown={onHeaderKeyDown}
        onDoubleClick={maximize}
        className={
          'flex h-[33px] shrink-0 touch-none select-none items-center gap-2 ' +
          'border-b px-2.5 transition-colors duration-200 ' +
          'outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
          (win.minimized ? 'border-transparent ' : 'border-border ') +
          (active ? 'bg-muted/50 ' : 'bg-muted/25 ') +
          (dragging ? 'cursor-grabbing' : 'cursor-grab')
        }
      >
        <span
          className={
            'min-w-0 flex-1 truncate text-xs font-medium transition-colors duration-200 ' +
            (active ? 'text-foreground' : 'text-muted-foreground')
          }
        >
          {name}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
        </span>

        <div className="-mr-1 flex shrink-0 items-center gap-px">
          <WindowButton
            label={
              win.minimized
                ? `Expand ${name} preview`
                : `Collapse ${name} preview`
            }
            onClick={onMinimize}
          >
            <Minus className="size-3.5" />
          </WindowButton>
          <WindowButton
            label={
              maximized ? `Restore ${name} preview` : `Maximize ${name} preview`
            }
            onClick={maximize}
          >
            {maximized ? (
              <Minimize2 className="size-3" />
            ) : (
              <Maximize2 className="size-3" />
            )}
          </WindowButton>
          <WindowButton
            label={`Close ${name} preview`}
            onClick={onClose}
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-3.5" />
          </WindowButton>
        </div>
      </header>

      {!win.minimized && (
        <>
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

          <div
            role="separator"
            aria-label={`Resize ${name} preview`}
            onPointerDown={startResize}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            className="group absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none select-none"
          >
            <div
              aria-hidden="true"
              className={
                'absolute right-1 bottom-1 size-2 rounded-br-[2px] border-r border-b ' +
                'transition-colors duration-150 group-hover:border-foreground ' +
                (active
                  ? 'border-muted-foreground/60'
                  : 'border-muted-foreground/30')
              }
            />
          </div>
        </>
      )}
    </div>
  )
}

function WindowButton({
  label,
  onClick,
  className = '',
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-label={label}
      title={label}
      className={
        'rounded p-1 text-muted-foreground ' +
        'transition-[background-color,color,transform] duration-150 ' +
        'ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.9] ' +
        'hover:bg-accent hover:text-foreground ' +
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ' +
        className
      }
    >
      {children}
    </button>
  )
}
