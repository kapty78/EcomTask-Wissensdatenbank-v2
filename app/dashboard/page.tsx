"use client"

import { getSupabaseClient } from "@/lib/supabase-browser"
import { useEffect, useState, useRef } from "react"
import { getSavedDomain, getSavedCompany } from "@/lib/domain-manager"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { formatDistanceToNow } from "date-fns"
import { de } from "date-fns/locale"
import {
  User,
  Settings,
  LogOut,
  Database,
  BookOpen,
  Check,
  Shield,
  Users,
} from "lucide-react"
import dynamic from "next/dynamic"
import { User as SupabaseUser } from "@supabase/supabase-js"
import AdminPanel from "@/components/admin/AdminPanel"
import { GridPattern } from "@/components/ui/grid-pattern"
import KnowledgeAgentLauncher from "@/components/knowledge/KnowledgeAgentLauncher"

// Lazy-Load der Wissensdatenbank-Komponente
const KnowledgeComponent = dynamic(
  () => import("@/components/knowledge/KnowledgeComponentDashboard"),
  {
    loading: () => (
      <div className="flex size-full items-center justify-center p-6">
        <div className="h-8 w-8 rounded-full border-4 border-t-primary border-r-transparent border-b-primary border-l-transparent animate-spin"></div>
      </div>
    ),
    ssr: false
  }
)

// Add type for Profile (adjust based on your actual columns)
type Profile = {
  id: string // Usually matches auth.users.id
  company_id?: string
  full_name?: string
  email?: string // You might fetch email from auth.users instead
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [canUpload, setCanUpload] = useState(false)
  const [activeTab, setActiveTab] = useState<'knowledge' | 'admin'>('knowledge')
  
  // State für das Einladungs-Dropdown
  const [showInviteDropdown, setShowInviteDropdown] = useState(false)
  const [invitableUsers, setInvitableUsers] = useState<Profile[]>([])
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  
  // Ref für das Invite Dropdown
  const inviteDropdownRef = useRef<HTMLDivElement>(null)
  
  // Timer für Scroll-Drosselung
  const scrollTimerRef = useRef<number | null>(null)
  // Höherer Schwellenwert für bessere Kontrolle
  const scrollThreshold = 50
  
  // Scroll-Akkumulator für präziseres Scrolling
  const scrollAccumulator = useRef(0)
  // Letzte Scrollrichtung
  const lastScrollDirection = useRef<'up' | 'down' | null>(null)
  
  const [userProfile, setUserProfile] = useState<any>(null) // Profil mit company_id
  
  const supabase = getSupabaseClient()
  const router = useRouter()
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)

        // Check session
        const {
          data: { session },
          error: sessionError
        } = await supabase.auth.getSession()

        if (sessionError || !session) {
          // Session-Fehler werden vom globalen SessionExpiredModal behandelt
          // Leite direkt zum Login um
          router.push('/login')
          return
        }

        setUser(session.user)
        
        // Benutzerprofil mit company_id laden
        try {
          const { data: profileData, error: profileError } = await supabase
            .from("profiles")
            .select("*") // Alle Profilfelder inkl. company_id
            .eq("id", session.user.id)
            .single()
            
          if (profileError) {
            // Fehler beim Laden des Benutzerprofils
          } else if (profileData) {
            setUserProfile(profileData)
          }
        } catch (profileErr) {
          // Unerwarteter Fehler beim Laden des Profils
        }
        
        // Check if user is super admin
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_super_admin, can_upload')
          .eq('id', session.user.id)
          .single();
        
        setIsSuperAdmin(profile?.is_super_admin || false);
        setCanUpload(profile?.can_upload || false);
        
        // Set default tab to admin for super admins
        if (profile?.is_super_admin) {
          setActiveTab('admin');
        }
        
        // Prüfen ob der Benutzer ein Admin ist
        const company = getSavedCompany()
        if (company && company.id) {
          try {
            // Option 1: Versuchen über RLS
            const { data: adminCheck, error: adminCheckError } = await supabase
              .from("company_admins")
              .select("*")
              .eq("company_id", company.id)
              .eq("user_id", session.user.id)
              .maybeSingle()

            if (!adminCheckError) {
              setIsAdmin(!!adminCheck)
            } else {
              // Bei RLS-Fehler, versuche es ohne RLS-Prüfung oder setze Admin-Status auf false
              setIsAdmin(false)
              // Option 2: Direkter API-Aufruf mit service key
              try {
                // Wir prüfen in den Metadaten des Users, ob er ein Admin ist
                const { data: userData, error: userError } =
                  await supabase.auth.getUser()
                if (userData?.user?.user_metadata?.role === "admin") {
                  setIsAdmin(true)
                } else {
                  setIsAdmin(false)
                }
              } catch (e) {
                setIsAdmin(false)
              }
            }
          } catch (e) {
            setIsAdmin(false)
          }
        }
        
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [supabase, router]) // Abhängigkeiten für initiales Laden
  
  const handleLogout = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem("selectedDomain")
    localStorage.removeItem("selectedCompany")
    router.push("/login")
  }
  
  // Warteschlangen-Screen für Benutzer ohne Upload-Berechtigung
  const WaitingForApprovalScreen = () => (
    <div className="fixed inset-0 flex items-center justify-center bg-[#1a1a1a] text-foreground z-10 p-4">
      <div className="w-full max-w-md mx-auto relative z-10">
        <div className="mx-2 sm:mx-4 rounded-xl border border-border bg-card p-6 sm:p-8 text-center shadow-2xl">
          {/* Logo */}
          <div className="mb-4 sm:mb-6 flex justify-center">
            <Image
              src="/EcomTask.svg"
              alt="EcomTask Logo"
              width={180}
              height={50}
              priority
              className="w-[140px] h-auto sm:w-[180px]"
            />
          </div>
          
          {/* Warteschlangen-Icon */}
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Shield className="size-12 text-primary" />
            </div>
          </div>
          
          {/* Titel */}
          <h1 className="mb-3 sm:mb-4 text-xl sm:text-2xl font-bold text-foreground">
            Zugang wird überprüft
          </h1>
          
          {/* Beschreibung */}
          <p className="mb-4 sm:mb-6 text-sm sm:text-base text-muted-foreground leading-relaxed px-2">
            Ihr Account wurde erfolgreich erstellt! Ein Administrator von{' '}
            <span className="font-semibold text-primary">EcomTask</span> muss
            Ihnen erst die Upload-Berechtigung erteilen, bevor Sie die 
            Wissensdatenbank nutzen können.
          </p>
          
          {/* Status */}
          <div className="mb-6 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <div className="size-2 animate-pulse rounded-full bg-primary"></div>
              <span className="text-sm font-medium">Warten auf Freigabe</span>
            </div>
          </div>
          
          {/* Info */}
          <p className="text-xs text-muted-foreground">
            Sie werden automatisch benachrichtigt, sobald Ihr Zugang freigeschaltet wurde.
            Bei Fragen wenden Sie sich an support@ecomtask.de
          </p>
          
          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="mt-4 sm:mt-6 w-full rounded-lg bg-secondary px-4 py-2.5 sm:py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            Abmelden
          </button>
        </div>
      </div>
    </div>
  );
  
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground relative">
        <GridPattern
          width={40}
          height={40}
          squares={[
            [0, 1],
            [1, 3],
            [3, 0],
            [5, 2],
            [7, 4],
            [10, 1],
            [12, 3],
            [15, 5],
          ]}
          className="opacity-20"
        />
        <div className="animate-pulse flex flex-col items-center relative z-10">
          <div className="h-8 w-8 rounded-full border-4 border-t-primary border-r-transparent border-b-primary border-l-transparent animate-spin mb-4"></div>
          <p className="text-muted-foreground font-medium tracking-wider">Lade Wissensdatenbank...</p>
        </div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background p-4 text-foreground relative">
        <GridPattern
          width={40}
          height={40}
          squares={[
            [0, 1],
            [1, 3],
            [3, 0],
            [5, 2],
            [7, 4],
            [10, 1],
            [12, 3],
            [15, 5],
          ]}
          className="opacity-20"
        />
        <div className="p-6 backdrop-blur-xl bg-card/80 border border-border rounded-xl shadow-2xl max-w-lg relative z-10">
          <p className="text-sm text-muted-foreground mb-4">Fehler: {error}</p>
          <button
           onClick={() => router.push("/login")}
           className="w-full rounded-md bg-primary px-4 py-2 font-semibold text-foreground transition-all hover:bg-pink-600 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
           Zum Login
          </button>
        </div>
      </div>
    )
  }
  
  // Hauptfunktion - Dashboard mit Tabs für normale Wissensdatenbank und Admin
  return (
    <div className="flex flex-col h-screen bg-background text-foreground relative overflow-hidden">
      <GridPattern
        width={40}
        height={40}
        squares={[
          [0, 1],
          [1, 3],
          [3, 0],
          [5, 2],
          [7, 4],
          [10, 1],
          [12, 3],
          [15, 5],
          [18, 2],
          [20, 4],
          [23, 1],
          [25, 3],
          [28, 5],
          [30, 0],
          [32, 2],
        ]}
        className="opacity-40"
      />
      {/* Warteschlangen-Screen für Benutzer ohne Upload-Berechtigung */}
      {!canUpload && !isSuperAdmin ? (
        <WaitingForApprovalScreen />
      ) : (
        <main className="flex-1 w-full relative z-10 flex flex-col min-h-0 overflow-hidden">
          <div className="flex flex-col flex-1 w-full p-2 pt-0 pb-0 bg-[#1a1a1a] overflow-hidden min-h-0">
            {/* Professioneller Header mit mehr Inhalt */}
            <div className="mx-auto max-w-7xl w-full mb-2 sm:mb-3 md:mb-4 mt-1.5 sm:mt-2 md:mt-3 px-1.5 sm:px-3 md:px-4 lg:px-8 flex-shrink-0">
              <div className="w-full border border-white/10 bg-[#1e1e1e] rounded-lg md:rounded-xl">
                {/* Top Bar mit Logo und User */}
                <div className="flex items-center justify-between gap-2 py-1.5 sm:py-2 md:py-1 px-2 sm:px-3 md:px-4 min-w-0">
                  {/* Logo */}
                  <div className="flex items-center flex-shrink-0">
                    <button
                      onClick={() => setActiveTab('knowledge')}
                      className="hover:opacity-80 transition-opacity mt-[1mm]"
                      title="Zur Wissensdatenbank"
                    >
                      <Image
                        src="/EcomTask.svg"
                        alt="EcomTask Logo"
                        width={180}
                        height={68}
                        className="w-[130px] h-auto sm:w-[150px] md:w-[150px] lg:w-[180px] -ml-1 sm:-ml-2 md:-ml-3"
                        priority
                      />
                    </button>
                  </div>

                  {/* Agent Launcher - visible from md breakpoint */}
                  <div className="hidden md:flex flex-1 justify-center items-center px-2">
                    <div className="w-[min(560px,50vw)] min-w-[200px]">
                      <KnowledgeAgentLauncher
                        userName={
                          userProfile?.full_name ||
                          (user?.email ? String(user.email).split("@")[0] : undefined)
                        }
                      />
                    </div>
                  </div>

                  {/* Benutzer-Profil */}
                  <div className="flex items-center justify-end gap-1 sm:gap-1.5 md:gap-2 flex-shrink-0 min-w-0">
                    {isSuperAdmin && (
                      <button
                        onClick={() => setActiveTab('admin')}
                        className="flex items-center gap-1 px-1.5 sm:px-2 md:px-3 py-1 md:py-1.5 rounded-md text-xs font-medium transition-colors bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 flex-shrink-0"
                        title="Zum Admin-Panel"
                      >
                        <Shield size={12} />
                        <span className="hidden sm:inline">Admin</span>
                      </button>
                    )}
                    <span
                      className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate max-w-[80px] sm:max-w-[100px] md:max-w-[160px] lg:max-w-[200px]"
                      title={getSavedCompany()?.name ?? user?.email ?? undefined}
                    >
                      {getSavedCompany()?.name ??
                        userProfile?.full_name ??
                        (user as any)?.user_metadata?.full_name ??
                        user?.email ??
                        ""}
                    </span>
                    <button
                      onClick={handleLogout}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0"
                      title="Abmelden"
                    >
                      <LogOut size={15} className="sm:w-4 sm:h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Content basierend auf activeTab */}
            {activeTab === 'knowledge' ? (
              // Wissensdatenbank
              <div className="mx-auto max-w-7xl pt-2 flex-1 overflow-hidden flex flex-col w-full min-h-0">
                <KnowledgeComponent />
              </div>
            ) : (
              // Admin-Panel (nur für Super-Admins)
              isSuperAdmin && (
                <div className="mx-auto max-w-7xl pt-2 flex-1 overflow-auto w-full min-h-0">
                  <AdminPanel user={user} />
                </div>
              )
            )}
          </div>
        </main>
      )}

      {/* Powered by EcomTask Footer - at bottom */}
      <div className="w-full bg-[#1a1a1a] border-t border-white/10 z-20 flex-shrink-0">
        <div className="flex justify-center items-center gap-1.5 py-0.5 sm:py-1 px-4">
          <span className="text-[10px] sm:text-xs text-muted-foreground">powered by</span>
          <img src="/ecomtask.png" alt="EcomTask" className="h-4 sm:h-5" />
        </div>
      </div>

      {/* Mobile floating agent chat button - visible below md */}
      <div className="md:hidden">
        <KnowledgeAgentLauncher
          variant="floating"
          userName={
            userProfile?.full_name ||
            (user?.email ? String(user.email).split("@")[0] : undefined)
          }
        />
      </div>
    </div>
  )
}
