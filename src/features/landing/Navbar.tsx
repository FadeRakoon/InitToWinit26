import { Link } from '@tanstack/react-router'
import { CloudLightning } from 'lucide-react'

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 z-[100] flex h-[70px] w-full items-center justify-between border-b border-white/5 bg-[#080f1a] px-5 shadow-none sm:px-10">
      <Link
        to="/"
        className="flex items-center gap-3 text-xl font-bold tracking-[-0.3px] no-underline transition-opacity hover:opacity-80"
        style={{ color: '#ffffff' }}
      >
        <CloudLightning
          aria-hidden="true"
          className="h-[1.4rem] w-[1.4rem] text-[var(--landing-accent)]"
        />
        <span>Yaad Guard</span>
      </Link>

      <div className="flex items-center gap-2 sm:gap-6">
        <Link
          to="/"
          className="hidden rounded-full px-4 py-2 text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-primary)] no-underline transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/5 md:inline"
        >
          Home
        </Link>
        <Link
          to="/about"
          className="hidden rounded-full px-4 py-2 text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/5 hover:text-[var(--landing-text-primary)] md:inline"
        >
          About
        </Link>
        <Link
          to="/technology"
          className="hidden rounded-full px-4 py-2 text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/5 hover:text-[var(--landing-text-primary)] md:inline"
        >
          Technology
        </Link>
        <div className="ml-2 h-4 w-[1px] bg-white/10 hidden md:block" />
        <Link
          to="/map"
          className="rounded-full border border-[rgba(56,189,248,0.3)] bg-[rgba(56,189,248,0.1)] px-5 py-2 text-[0.85rem] font-semibold tracking-[0.3px] text-[var(--landing-accent)] no-underline transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[var(--landing-accent)] hover:bg-[var(--landing-accent)] hover:text-slate-950 hover:shadow-[0_0_20px_rgba(56,189,248,0.4)] active:scale-95"
        >
          Open Map
        </Link>
      </div>
    </nav>
  )
}
