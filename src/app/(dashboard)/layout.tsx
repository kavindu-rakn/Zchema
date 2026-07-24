import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { RoleSwitcher } from "@/components/role-switcher";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar user={user} profile={profile} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header user={user} profile={profile} />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
      <RoleSwitcher user={user} profile={profile} />
    </div>
  );
}
