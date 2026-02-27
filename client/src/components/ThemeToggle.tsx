import { useTheme } from '../hooks/useTheme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()

  return (
    <button className="btn-theme" onClick={toggle} title="Toggle theme">
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
