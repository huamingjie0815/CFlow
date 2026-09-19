import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { catalogs, normalizeLocale, type Locale, type Messages } from './i18n'

type LocaleContextValue = {
  locale: Locale
  m: Messages
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'zh-CN',
  m: catalogs['zh-CN'],
})

export function LocaleProvider(props: {
  locale: Locale | string | undefined
  children: ReactNode
}) {
  const locale = normalizeLocale(props.locale)
  const m = catalogs[locale]
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return <LocaleContext.Provider value={{ locale, m }}>{props.children}</LocaleContext.Provider>
}

export function useLocale() {
  return useContext(LocaleContext)
}
