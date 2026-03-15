import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Database, Code2, Map, Server, Globe2 } from 'lucide-react'
import { Navbar } from '../features/landing/Navbar'

export const Route = createFileRoute('/technology')({ component: TechnologyPage })

function TechnologyPage() {
  return (
    <div className="min-h-screen bg-[var(--landing-bg-color)] text-[var(--landing-text-primary)]">
      <Navbar />

      <main className="mx-auto max-w-[1000px] px-5 pt-[120px] pb-20">
        <h1 className="mb-4 text-[2.5rem] font-bold tracking-[-1px] text-[var(--landing-text-primary)] md:text-[3.5rem] text-center">
          Technology & Datasets
        </h1>
        <p className="mx-auto mb-16 max-w-[700px] text-center text-[1.1rem] leading-[1.6] text-[var(--landing-text-secondary)]">
          Yaad Guard is built on a modern, high-performance stack designed to process and visualize complex geospatial data in real-time.
        </p>

        <div className="grid gap-12 md:grid-cols-2">
          {/* Tech Stack Section */}
          <div className="space-y-8">
            <h2 className="flex items-center gap-3 text-2xl font-bold text-white border-b border-white/10 pb-4">
              <Code2 className="text-[var(--landing-accent)]" size={28} />
              Core Architecture
            </h2>
            
            <div className="space-y-6">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-sm">
                <h3 className="mb-2 text-xl font-semibold text-white">Application Framework</h3>
                <p className="text-[0.95rem] text-[var(--landing-text-secondary)] leading-relaxed">
                  Built with <strong>TanStack Start</strong>, a powerful full-stack React framework that ensures seamless SSR, type-safe routing, and an optimal developer and user experience.
                </p>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-sm">
                <h3 className="mb-2 text-xl font-semibold text-white">Geospatial Engine</h3>
                <p className="text-[0.95rem] text-[var(--landing-text-secondary)] leading-relaxed">
                  Powered by <strong>MapLibre GL JS</strong> for smooth, interactive vector maps. We handle complex raster processing natively using <strong>GeoTIFF</strong> libraries.
                </p>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-sm">
                <h3 className="mb-2 text-xl font-semibold text-white">Backend & AI</h3>
                <p className="text-[0.95rem] text-[var(--landing-text-secondary)] leading-relaxed">
                  Our API layer runs on <strong>Nitro</strong> for extreme performance. We leverage <strong>Vercel AI SDK</strong> for intelligent natural language insights, and <strong>Drizzle ORM</strong> for robust, type-safe database interactions.
                </p>
              </div>
            </div>
          </div>

          {/* Datasets Section */}
          <div className="space-y-8">
            <h2 className="flex items-center gap-3 text-2xl font-bold text-white border-b border-white/10 pb-4">
              <Database className="text-[var(--landing-accent)]" size={28} />
              Data Intelligence
            </h2>

            <div className="space-y-6">
              <div className="flex gap-4 rounded-xl border border-white/5 bg-[#0a1526]/50 p-5">
                <Map className="shrink-0 text-blue-400 mt-1" size={24} />
                <div>
                  <h3 className="mb-1 text-lg font-semibold text-white">High-Res Topography</h3>
                  <p className="text-sm text-[var(--landing-text-secondary)] leading-relaxed">
                    Granular elevation models and terrain summaries that allow us to precisely simulate water flow, pooling, and natural drainage channels.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 rounded-xl border border-white/5 bg-[#0a1526]/50 p-5">
                <Globe2 className="shrink-0 text-green-400 mt-1" size={24} />
                <div>
                  <h3 className="mb-1 text-lg font-semibold text-white">WorldPop Demographics</h3>
                  <p className="text-sm text-[var(--landing-text-secondary)] leading-relaxed">
                    Integrated population density estimates help assess community exposure and understand the human impact of potential hazard zones.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 rounded-xl border border-white/5 bg-[#0a1526]/50 p-5">
                <Server className="shrink-0 text-red-400 mt-1" size={24} />
                <div>
                  <h3 className="mb-1 text-lg font-semibold text-white">Climate & Weather Risk</h3>
                  <p className="text-sm text-[var(--landing-text-secondary)] leading-relaxed">
                    Decades of historical storm tracks and modeled storm surge return levels are cross-referenced to determine specific wind and flood threats.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 text-center">
          <Link
            to="/map"
            className="inline-flex items-center gap-2.5 rounded-full bg-[var(--landing-accent)] px-8 py-3.5 text-[1rem] font-semibold !text-white no-underline shadow-[0_10px_25px_rgba(56,189,248,0.4)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[5px] hover:scale-[1.03] hover:shadow-[0_20px_40px_rgba(56,189,248,0.6)]"
          >
            <span>Explore the Data on Map</span>
            <ArrowRight aria-hidden="true" className="h-[1.1rem] w-[1.1rem]" />
          </Link>
        </div>
      </main>
    </div>
  )
}
