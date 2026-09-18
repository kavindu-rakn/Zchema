'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    // The emailed link goes through /auth/callback, which exchanges the
    // code for a session and then forwards to `next`. /update-password
    // needs that session, so this is the only way to reach it signed out.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=/update-password`,
    })

    setIsLoading(false)
    if (error) {
      // Rate limits and transport failures only. The success message below
      // is deliberately the same whether or not the address has an account,
      // so this form cannot be used to find out who is registered.
      setError(error.message)
      return
    }
    setSent(true)
  }

  return (
    <Card className="border-border bg-card/50 backdrop-blur-xl shadow-2xl">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-medium">Reset your password</CardTitle>
        <CardDescription className="text-muted-foreground">
          Enter your email and we&apos;ll send you a link to choose a new one
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-md flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
          {sent && (
            <div className="bg-primary/10 border border-primary/20 text-primary p-3 rounded-md flex items-start gap-3 text-sm">
              <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
              <p>If an account exists for that address, a reset link is on its way. It expires after one use.</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-input/50 border-input focus-visible:ring-ring text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-white transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:shadow-[0_0_25px_rgba(52,211,153,0.3)]"
            disabled={isLoading || sent}
          >
            {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {isLoading ? 'Sending link...' : 'Send reset link'}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            Remembered it?{' '}
            <Link href="/login" className="text-primary hover:text-primary/80 transition-colors">
              Back to sign in
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
