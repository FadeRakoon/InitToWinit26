import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Yaad Guard',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'stylesheet',
        href: 'https://unpkg.com/maplibre-gl@5.20.1/dist/maplibre-gl.css',
      },
    ],
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function NotFoundPage() {
  return (
    <main className="page-wrap px-4 py-20 sm:py-28">
      <section className="glass-panel rounded-[2rem] px-6 py-10 text-center sm:px-10 sm:py-14">
        <p className="section-label mb-4">Route Not Found</p>
        <h1 className="font-display text-4xl font-bold text-[var(--ink)] sm:text-5xl">
          That page does not exist.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[var(--ink-soft)]">
          The requested route could not be matched. Return to the landing page or
          jump straight into the map experience.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center rounded-full bg-[linear-gradient(135deg,var(--accent),#7ee7c8)] px-5 py-3 text-sm font-semibold text-slate-950 no-underline shadow-[0_16px_36px_var(--accent-glow)] hover:-translate-y-0.5"
          >
            Go Home
          </Link>
          <Link
            to="/map"
            className="inline-flex items-center rounded-full border border-[var(--line-strong)] bg-[rgba(8,21,39,0.52)] px-5 py-3 text-sm font-semibold text-[var(--ink)] no-underline hover:-translate-y-0.5 hover:bg-[rgba(8,21,39,0.68)]"
          >
            Open Map
          </Link>
        </div>
      </section>
    </main>
  )
}
