import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import winstonImg from '../../images/WinstonTheWeathervane.png'
import { Navbar } from '../features/landing/Navbar'

export const Route = createFileRoute('/about')({ component: AboutPage })

function AboutPage() {
  return (
    <div className="min-h-screen bg-[var(--landing-bg-color)] text-[var(--landing-text-primary)]">
      <Navbar />

      <main className="mx-auto max-w-[1000px] px-5 pt-[120px] pb-20">
        <div className="flex flex-col items-center gap-12 md:flex-row md:items-start">
          <div className="flex-1">
            <h1 className="mb-8 text-[2.5rem] font-bold tracking-[-1px] text-[var(--landing-text-primary)] md:text-[3.5rem]">
              About Yaad Guard
            </h1>
            <div className="space-y-6 text-[1.1rem] leading-[1.7] text-[var(--landing-text-secondary)]">
              <p>
                <strong>Yaad Guard</strong> is a proactive geospatial and
                climate intelligence platform dedicated to the Caribbean. By
                blending high-resolution terrain analysis with physics-based
                simulations, we transform complex weather data into clear,
                actionable insights for homeowners, farmers, and urban planners.
              </p>
              <p>
                Guided by <strong>Winston the Weathervane</strong>, our friendly
                mascot, Yaad Guard empowers you to make safer, data-driven
                decisions—helping you decide where to build, where to buy, and
                when to seek safety.
              </p>
              <p>
                We are shifting the region from reactive disaster response to
                proactive living, ensuring every settlement is built on a
                foundation of foresight and security.
              </p>
            </div>
            <div className="mt-10">
              <Link
                to="/map"
                className="inline-flex items-center gap-2.5 rounded-full bg-[var(--landing-accent)] px-8 py-3.5 text-[1rem] font-semibold !text-white no-underline shadow-[0_10px_25px_rgba(56,189,248,0.4)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[5px] hover:scale-[1.03] hover:shadow-[0_20px_40px_rgba(56,189,248,0.6)]"
              >
                <span>Launch Grid Map</span>
                <ArrowRight aria-hidden="true" className="h-[1.1rem] w-[1.1rem]" />
              </Link>
            </div>
          </div>
          <div className="flex w-[300px] flex-col items-center justify-center gap-4 text-center">
            <div className="relative">
              <div className="absolute inset-0 animate-pulse rounded-full bg-[var(--landing-accent)] opacity-20 blur-2xl"></div>
              <img
                src={winstonImg}
                alt="Winston the Weathervane"
                className="relative z-10 w-full rounded-2xl border border-white/10 bg-[#080f1a]/80 p-6 shadow-2xl backdrop-blur-sm"
              />
            </div>
            <div className="mt-4">
              <h3 className="text-xl font-bold text-[var(--landing-text-primary)]">
                Winston
              </h3>
              <p className="text-sm text-[var(--landing-text-secondary)]">
                The Weathervane
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
