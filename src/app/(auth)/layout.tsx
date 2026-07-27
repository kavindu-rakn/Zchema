import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-50 relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-md z-10 px-4">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center mb-4 overflow-hidden shadow-[0_0_20px_rgba(52,211,153,0.15)] border border-emerald-500/20">
            <Image src="/logo-nobg.png" alt="SchemaShift Logo" width={64} height={64} className="object-contain w-full h-full" priority />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">SchemaShift</h1>
          <p className="text-sm text-zinc-400 mt-2">Dynamic Catalog Management System</p>
        </div>
        {children}
      </div>
    </div>
  )
}
