import { LogoMark } from "@/components/brand/logo-mark";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-md z-10 px-4">
        <div className="flex flex-col items-center mb-8">
          <LogoMark className="h-16 w-16 mb-4 text-primary drop-shadow-[0_0_20px_rgba(0,196,131,0.25)]" />
          <h1 className="text-2xl font-semibold tracking-tight">Zchema</h1>
          <p className="text-sm text-muted-foreground mt-2">See what breaks before it breaks</p>
        </div>
        {children}
      </div>
    </div>
  )
}
