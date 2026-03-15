import { Link } from '@tanstack/react-router'
import { ArrowRight, CloudLightning } from 'lucide-react'

const heroBackgroundImage =
  'linear-gradient(rgba(2, 8, 15, 0.7), rgba(8, 15, 26, 0.9)), url("https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=2072")'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--landing-bg-color)] text-[var(--landing-text-primary)]">
      <nav className="fixed top-0 left-0 z-[100] flex h-[70px] w-full items-center justify-between border-b border-white/5 bg-[rgba(8,15,26,0.3)] px-5 shadow-none backdrop-blur-md sm:px-10">
        <div className="flex items-center gap-3 text-xl font-semibold tracking-[-0.3px] text-[var(--landing-text-primary)]">
          <CloudLightning
            aria-hidden="true"
            className="h-[1.4rem] w-[1.4rem] text-[var(--landing-accent)]"
          />
          <span>Yaad Guard</span>
        </div>

        <div className="flex items-center gap-4 sm:gap-8">
          <Link
            to="/"
            className="hidden text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-primary)] no-underline transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] md:inline"
          >
            Home
          </Link>
          <a
            href="#about"
            className="hidden text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--landing-text-primary)] md:inline"
          >
            About
          </a>
          <a
            href="#technology"
            className="hidden text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-text-secondary)] no-underline transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--landing-text-primary)] md:inline"
          >
            Technology
          </a>
          <Link
            to="/map"
            className="rounded-full border border-[rgba(56,189,248,0.2)] bg-[rgba(56,189,248,0.08)] px-6 py-2 text-[0.9rem] font-medium tracking-[0.3px] text-[var(--landing-accent)] no-underline transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[var(--landing-accent)] hover:bg-[var(--landing-accent)] hover:!text-white hover:shadow-[0_0_20px_rgba(56,189,248,0.4)]"
          >
            Open Map
          </Link>
        </div>
      </nav>

      <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-5 pt-[70px]">
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 bg-cover bg-[center_bottom] bg-no-repeat opacity-80"
          style={{ backgroundImage: heroBackgroundImage }}
        />

        <div className="landing-fade-up relative z-10 max-w-[800px] px-5 text-center">
          <h1 className="mb-6 text-[2.5rem] leading-[1.1] font-bold tracking-[-1px] text-[var(--landing-text-primary)] md:text-[4rem]">
            AI-Powered Atmospheric Intelligence
          </h1>
          <p className="mx-auto mb-10 max-w-[600px] text-[1.2rem] leading-[1.6] text-[var(--landing-text-secondary)]">
            Monitor, predict, and respond to global weather anomalies in
            real-time with our advanced AI grid network.
          </p>
          <div className="flex justify-center">
            <Link
              to="/map"
              className="inline-flex items-center gap-2.5 rounded-full bg-[var(--landing-accent)] px-9 py-4 text-[1.1rem] font-semibold !text-white no-underline shadow-[0_10px_25px_rgba(56,189,248,0.4)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[5px] hover:scale-[1.03] hover:shadow-[0_20px_40px_rgba(56,189,248,0.6)]"
            >
              <span>Launch Grid Map</span>
              <ArrowRight
                aria-hidden="true"
                className="h-[1.1rem] w-[1.1rem]"
              />
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
