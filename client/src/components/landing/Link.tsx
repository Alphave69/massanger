import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { goBack, navigate, type Route } from './route'

const HREF: Record<Route, string> = { home: '/', login: '/login', download: '/download' }

interface Props {
  to: Route
  /** Кнопка «назад»: если пришли со страницы to — шаг назад по истории, а не новая запись */
  back?: boolean
  className?: string
  style?: CSSProperties
  children: ReactNode
  onClick?: () => void
  'aria-label'?: string
}

/** Ссылка между страницами: обычный клик — без перезагрузки, с Ctrl/колёсиком — как у браузера (новая вкладка) */
export function Link({ to, back, className, style, children, onClick, ...rest }: Props) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onClick?.()
    if (back) goBack(to)
    else navigate(to)
  }
  return (
    <a href={HREF[to]} className={className} style={style} onClick={go} aria-label={rest['aria-label']}>
      {children}
    </a>
  )
}
