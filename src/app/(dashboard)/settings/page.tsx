import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { UserCircle, Mail, Shield, Calendar } from 'lucide-react'

export const dynamic = 'force-dynamic'

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  TEMPLATE_ADMIN:   { label: 'Template Admin',    color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  DATA_CONTRIBUTOR: { label: 'Data Contributor',  color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  VIEWER:           { label: 'Viewer',             color: 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20' },
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const role = profile?.role ?? 'VIEWER'
  const roleInfo = ROLE_LABELS[role] ?? ROLE_LABELS.VIEWER

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—'

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">Your account information and role.</p>
      </div>

      <Card className="bg-zinc-950 border-zinc-800">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <UserCircle className="h-6 w-6 text-zinc-400" />
            </div>
            <div>
              <CardTitle className="text-zinc-100 text-lg">{user.email}</CardTitle>
              <CardDescription className="text-zinc-500">Account profile</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-2">
          <div className="h-px bg-zinc-800" />

          <div className="grid grid-cols-1 gap-4">
            <InfoRow
              icon={<Mail className="h-4 w-4 text-zinc-500" />}
              label="Email"
              value={user.email ?? '—'}
            />
            <div className="h-px bg-zinc-900" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="h-4 w-4 text-zinc-500" />
                <span className="text-sm text-zinc-400">Role</span>
              </div>
              <Badge className={`text-xs font-medium border ${roleInfo.color}`}>
                {roleInfo.label}
              </Badge>
            </div>
            <div className="h-px bg-zinc-900" />
            <InfoRow
              icon={<Calendar className="h-4 w-4 text-zinc-500" />}
              label="Member since"
              value={memberSince}
            />
          </div>

          <div className="h-px bg-zinc-800 mt-2" />
          <p className="text-xs text-zinc-600 pt-1">
            To change your role, use the <span className="text-zinc-400">debug Role Switcher</span> (the bug icon in the bottom right). Role management will be available in a future release.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm text-zinc-400">{label}</span>
      </div>
      <span className="text-sm text-zinc-200 font-medium">{value}</span>
    </div>
  )
}
