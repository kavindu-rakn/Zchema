import type { Metadata } from "next";
import { Saira, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Motion } from "@/components/motion";
import { Toaster } from "sonner";
import "./globals.css";


const saira = Saira({
  variable: "--font-saira",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zchema",
  description:
    "A schema management system for catalog data. Define fields on a category, inherit them down the tree, and change your data model against live records.",
};

// Applied before first paint so a saved density does not flash from
// comfortable to compact on every page load.
const DENSITY_SCRIPT = `try{var d=localStorage.getItem('zchema:density');if(d)document.documentElement.setAttribute('data-density',d);}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${saira.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: DENSITY_SCRIPT }} />
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
