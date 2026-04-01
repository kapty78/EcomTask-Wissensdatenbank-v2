"use client"

import React, { useState, useEffect } from 'react'
import { getSupabaseClient } from '@/lib/supabase-browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Plus, Trash2, Mail, User as UserIcon, Shield, Loader2 } from 'lucide-react'
import { User } from '@supabase/supabase-js'

interface TeamMember {
  id: string
  email: string
  full_name: string
  role: string
  created_at: string
  is_admin: boolean
}

interface TeamManagementProps {
  user: User
}

export default function TeamManagement({ user }: TeamManagementProps) {
  const supabase = getSupabaseClient()
  
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Neues Mitglied State
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  
  // Lösch-State
  const [deleting, setDeleting] = useState<string | null>(null)

  // Lade Team-Mitglieder
  const loadTeamMembers = async () => {
    try {
      setLoading(true)
      setError(null)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Keine aktive Sitzung')
        return
      }

      const response = await fetch('/api/team-members', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Fehler beim Laden der Team-Mitglieder')
      }

      setTeamMembers(result.members || [])
    } catch (err: any) {
      console.error('Fehler beim Laden der Team-Mitglieder:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Initial Load
  useEffect(() => {
    loadTeamMembers()
  }, [])

  // Neues Mitglied hinzufügen
  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!newEmail || !newPassword || !newFullName) {
      setCreateError('Alle Felder sind erforderlich')
      return
    }

    try {
      setCreating(true)
      setCreateError(null)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Keine aktive Sitzung')
      }

      const response = await fetch('/api/team-members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          full_name: newFullName
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Fehler beim Erstellen des Team-Mitglieds')
      }

      // Erfolg: Reset Form und neu laden
      setNewEmail('')
      setNewPassword('')
      setNewFullName('')
      setShowAddForm(false)
      await loadTeamMembers()
      
    } catch (err: any) {
      console.error('Fehler beim Erstellen:', err)
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  // Mitglied löschen
  const handleDeleteMember = async (memberId: string, memberEmail: string) => {
    if (!confirm(`Möchten Sie ${memberEmail} wirklich löschen?`)) {
      return
    }

    try {
      setDeleting(memberId)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Keine aktive Sitzung')
      }

      const response = await fetch(`/api/team-members?userId=${memberId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Fehler beim Löschen')
      }

      // Erfolg: Neu laden
      await loadTeamMembers()
      
    } catch (err: any) {
      console.error('Fehler beim Löschen:', err)
      alert(`Fehler: ${err.message}`)
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team-Verwaltung
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team-Verwaltung
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mt-1">
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team-Verwaltung
            </CardTitle>
            <CardDescription className="mt-1">
              Verwalten Sie die Mitglieder Ihres Unternehmens
            </CardDescription>
          </div>
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            size="sm"
            variant={showAddForm ? "outline" : "default"}
          >
            <Plus className="mr-2 h-4 w-4" />
            {showAddForm ? 'Abbrechen' : 'Mitglied hinzufügen'}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent>
        {/* Formular zum Hinzufügen */}
        {showAddForm && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 className="mb-4 text-sm font-medium">Neues Team-Mitglied</h3>
            <form onSubmit={handleCreateMember} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-gray-700">
                  Vollständiger Name
                </label>
                <Input
                  type="text"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="Max Mustermann"
                  required
                />
              </div>
              
              <div>
                <label className="mb-1 block text-sm text-gray-700">
                  E-Mail-Adresse
                </label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="max.mustermann@firma.de"
                  required
                />
              </div>
              
              <div>
                <label className="mb-1 block text-sm text-gray-700">
                  Temporäres Passwort
                </label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mindestens 8 Zeichen"
                  required
                  minLength={8}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Der Benutzer sollte dieses Passwort nach dem ersten Login ändern
                </p>
              </div>

              {createError && (
                <div className="mt-1">
                  <p className="text-xs text-muted-foreground">{createError}</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={creating}
                  className="flex-1"
                >
                  {creating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Erstelle...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Mitglied erstellen
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false)
                    setNewEmail('')
                    setNewPassword('')
                    setNewFullName('')
                    setCreateError(null)
                  }}
                >
                  Abbrechen
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Team-Mitglieder Liste */}
        <div className="space-y-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">
              {teamMembers.length} Team-Mitglied{teamMembers.length !== 1 ? 'er' : ''}
            </h3>
          </div>

          {teamMembers.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
              <Users className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">
                Noch keine Team-Mitglieder
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Fügen Sie das erste Mitglied hinzu
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {teamMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-gray-300"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                      <UserIcon className="h-5 w-5 text-gray-600" />
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">
                          {member.full_name}
                        </p>
                        {member.is_admin && (
                          <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            <Shield className="h-3 w-3" />
                            Admin
                          </span>
                        )}
                        {member.id === user.id && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Sie
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Mail className="h-3 w-3" />
                        {member.email}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      Seit {new Date(member.created_at).toLocaleDateString('de-DE')}
                    </span>
                    
                    {/* Lösch-Button (nicht für sich selbst) */}
                    {member.id !== user.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteMember(member.id, member.email)}
                        disabled={deleting === member.id}
                        className="text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {deleting === member.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}




