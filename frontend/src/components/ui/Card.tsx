import type { HTMLAttributes, ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  className?: string
} & HTMLAttributes<HTMLDivElement>

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/90 p-6 shadow-xl shadow-black/20 backdrop-blur-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
