'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { MIN_PASSWORD_LENGTH } from '@/lib/password'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

// An invite link is /signup?invite=<token>&email=<address>. The token
// rides along in the account's metadata; the database grants the role
// it names once the address is confirmed, and only for that address —
// see supabase/invites.sql.
export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[]; email?: string | string[] }>
}) {
  const params = use(searchParams)
  const inviteToken = typeof params.invite === 'string' ? params.invite : null
  const invitedEmail = typeof params.email === 'string' ? params.email : ''

  const [email, setEmail] = useState(invitedEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const supabase = createClient()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${location.origin}/auth/callback`,
          data: inviteToken ? { invite_token: inviteToken } : undefined,
        },
      })

      if (error) {
        throw error
      }

      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'An error occurred during signup')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="border-border bg-card/50 backdrop-blur-xl shadow-2xl">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-medium">
          {inviteToken ? 'Accept your invitation' : 'Create an account'}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {inviteToken
            ? `Sign up as ${invitedEmail || 'the invited address'} — the invitation is for that address, and the role comes with it once you confirm the email.`
            : 'Enter your details below to create your account'}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSignup}>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-md flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
          {success && (
            <div className="bg-primary/10 border border-primary/20 text-primary p-3 rounded-md flex items-start gap-3 text-sm">
              <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
              <p>Registration successful! Please check your email to verify your account.</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-input/50 border-input focus-visible:ring-ring text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="bg-input/50 border-input focus-visible:ring-ring text-foreground"
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button 
            type="submit" 
            className="w-full bg-primary hover:bg-primary/90 text-white transition-all shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:shadow-[0_0_25px_rgba(52,211,153,0.3)]"
            disabled={isLoading || success}
          >
            {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {isLoading ? 'Creating account...' : 'Sign up'}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:text-primary/80 transition-colors">
              Log in
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
