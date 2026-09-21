import type { Metadata, Viewport } from "next";
import { Saira, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Motion } from "@/components/motion";
import { Toaster } from "sonner";
import { BRAND, siteUrl } from "@/lib/brand";
import "./globals.css";


const saira = Saira({
  variable: "--font-saira",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The icon set itself is not declared here. It is file-based —
// src/app/{favicon.ico,icon.svg,apple-icon.png,opengraph-image.png,
// twitter-image.png} and src/app/manifest.ts — and Next.js reads those
// and writes the <link> and <meta> tags with the right sizes, types and
// cache-busting hashes, which is one fewer thing to keep in sync by
// hand. What is left below is the wording around them, and the one icon
// with no file convention.
export const metadata: Metadata = {
  // og:image and og:url are read by crawlers that have no origin to
  // resolve a relative path against, so everything below is absolute.
  metadataBase: siteUrl(),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    // Bookmark titles and tab titles come from here, so a page that
    // sets its own still says which app it belongs to.
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
  },
  // NOTE: no `icons` key, deliberately. Next.js folds the file-based
  // icons into the resolved metadata only when `icons` is absent
  // (resolve-metadata.js: `if (!resolvedMetadata.icons)`), so declaring
  // even one extra rel here silently drops icon.svg and apple-icon.png
  // from <head>. The one icon with no file convention — Safari's
  // mask-icon — is rendered as a plain <link> below instead.
  appleWebApp: {
    // The label under the icon when the app is saved to an iOS home
    // screen. Without it iOS uses the <title>, tagline and all.
    title: BRAND.name,
    capable: true,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Tints the Android address bar and the iOS status bar to match the
  // shell, so an installed app has no light seam above the top bar.
  themeColor: BRAND.background,
  colorScheme: "dark",
};

// Applied before first paint so a saved density does not flash from
// comfortable to compact on every page load.
const DENSITY_SCRIPT = `try{var d=localStorage.getItem('zchema:density');if(d)document.documentElement.setAttribute('data-density',d);}catch(e){}`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The CSP allows only scripts carrying this request's nonce (see
  // src/proxy.ts). Next.js stamps its own; this one is written by hand.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`dark ${saira.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Safari pinned tabs and Touch Bar favourites: a silhouette
            Safari tints itself, which is why it is a separate
            monochrome file. Written by hand because there is no file
            convention for it — see the note on `metadata` above for why
            it cannot go in `metadata.icons`. */}
        <link
          rel="mask-icon"
          href="/icons/safari-pinned-tab.svg"
          color={BRAND.accent}
        />
        {/* Browsers blank a nonce attribute once the CSP has read it, so
            hydration sees "" where the server wrote the value. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: DENSITY_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        {/* framer-motion ignores prefers-reduced-motion unless told to.
            Wrapping once here covers every animation in the app,
            including the drag-to-reorder in the schema editor. */}
        <Motion>
          <TooltipProvider>{children}</TooltipProvider>
        </Motion>
        <Toaster theme="dark" position="bottom-right" richColors />
      </body>
    </html>
  );
}
