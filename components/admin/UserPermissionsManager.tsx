"use client"

import React, { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { User } from '@supabase/supabase-js';
import { Shield, Users, AlertTriangle, Search, Eye, Database, Settings, XCircle, Edit2, Save, Copy, Check as CheckIcon, Phone, Bot, Mail, Sparkles, MessageSquare, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SolutionFlags {
  id: string | null;
  user_id?: string;
  company_id: string | null;
  phone: boolean;
  chatbot: boolean;
  assistant: boolean;
  mail: boolean;
  follow_up: boolean;
}

interface CompanyOption {
  id: string;
  name: string | null;
}

interface UserPermission {
  user_id: string;
  email: string;
  full_name: string | null;
  can_upload: boolean;
  is_super_admin: boolean;
  company_name: string | null;
  company_id?: string | null;
  email_limit: number;
  knowledge_base_limit: number;
  email_account_limit: number;
  executive_report_enabled: boolean;
  executive_report_frequency: string;
  executive_report_email: string | null;
  knowledge_bases: { id: string; name: string }[];
  email_accounts: { id: string; email: string }[];
  solution_flags?: SolutionFlags;
  metrics?: {
    totalProcessLogs: number;
    avgFirstResponseTime: number;
    lastActivityAt: string | null;
    lastEmailProcessedAt: string | null;
    additionalStats: {
      knowledgeBasesCount: number;
      emailAccountsCount: number;
      totalProcessLogs: number;
    };
  };
}

type SolutionFlagKey = 'phone' | 'chatbot' | 'assistant' | 'mail' | 'follow_up';

const normalizeSolutionFlags = (
  raw: any,
  userId: string,
  fallbackCompanyId: string | null = null
): SolutionFlags => ({
  id: raw?.id ?? null,
  user_id: raw?.user_id ?? userId,
  company_id: raw?.company_id ?? fallbackCompanyId ?? null,
  phone: Boolean(raw?.phone),
  chatbot: Boolean(raw?.chatbot),
  assistant: Boolean(raw?.assistant),
  mail: Boolean(raw?.mail),
  follow_up: Boolean(raw?.follow_up),
});

interface UserPermissionsManagerProps {
  user: User;
}

// =================================================================
// START: Standalone UserDetailModal Component
// =================================================================

interface UserDetailModalProps {
  user: UserPermission;
  onClose: () => void;
  isUpdateLoading: string | null;
  solutionFlagLoading: string | null;
  solutionCompanyLoading: string | null;
  companies: CompanyOption[];
  companiesLoading: boolean;
  updateUploadPermission: (userId: string, canUpload: boolean) => Promise<void>;
  updateEmailLimit: (userId: string, newLimit: number) => Promise<void>;
  updateKnowledgeBaseLimit: (userId: string, newLimit: number) => Promise<void>;
  updateEmailAccountLimit: (userId: string, newLimit: number) => Promise<void>;
  updateSolutionFlag: (
    userId: string,
    flag: SolutionFlagKey,
    value: boolean,
    companyId?: string | null
  ) => Promise<void>;
  updateSolutionCompany: (
    userId: string,
    companyId: string | null
  ) => Promise<void>;
}

const UserDetailModal = ({ 
  user: userData, 
  onClose,
  isUpdateLoading,
  solutionFlagLoading,
  solutionCompanyLoading,
  companies,
  companiesLoading,
  updateUploadPermission,
  updateEmailLimit,
  updateKnowledgeBaseLimit,
  updateEmailAccountLimit,
  updateSolutionFlag,
  updateSolutionCompany
}: UserDetailModalProps) => {
  const supabase = getSupabaseClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [userActivity, setUserActivity] = useState<any>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>('none');

  // Editing states are now local to the modal
  const [editingEmailLimit, setEditingEmailLimit] = useState<string | null>(null);
  const [emailLimitValue, setEmailLimitValue] = useState<number>(0);
  const [editingKnowledgeBaseLimit, setEditingKnowledgeBaseLimit] = useState<string | null>(null);
  const [knowledgeBaseLimitValue, setKnowledgeBaseLimitValue] = useState<number>(0);
  const [editingEmailAccountLimit, setEditingEmailAccountLimit] = useState<string | null>(null);
  const [emailAccountLimitValue, setEmailAccountLimitValue] = useState<number>(0);

  useEffect(() => {
    const initialCompany =
      userData.solution_flags?.company_id ?? userData.company_id ?? null;
    setSelectedCompany(initialCompany ?? 'none');
  }, [userData.user_id, userData.solution_flags?.company_id, userData.company_id]);

  const handleCompanyChange = async (value: string) => {
    const normalizedCompanyId = value === 'none' ? null : value;
    setSelectedCompany(value);
    await updateSolutionCompany(userData.user_id, normalizedCompanyId);
  };

  const fetchUserActivity = useCallback(async (userId: string) => {
    setActivityLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");

      const response = await fetch(`/api/admin/user-activity/${userId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const activity = await response.json();
        setUserActivity(activity);
      } else {
        setUserActivity(null);
      }
    } catch (error) {
      console.error('Error fetching user activity:', error);
      setUserActivity(null);
    } finally {
      setActivityLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (userData.user_id) {
      fetchUserActivity(userData.user_id);
    }
  }, [userData.user_id, fetchUserActivity]);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };
  
  const startEditingEmailLimit = (userId: string, currentLimit: number) => {
    setEditingEmailLimit(userId);
    setEmailLimitValue(currentLimit);
  };
  
  const cancelEditingEmailLimit = () => {
    setEditingEmailLimit(null);
  };
  
  const handleUpdateEmailLimit = async (userId: string, limit: number) => {
    await updateEmailLimit(userId, limit);
    setEditingEmailLimit(null);
  };
  
  const handleUpdateKbLimit = async (userId: string, limit: number) => {
    await updateKnowledgeBaseLimit(userId, limit);
    setEditingKnowledgeBaseLimit(null);
  };

  const handleUpdateEmailAccountLimit = async (userId: string, limit: number) => {
    await updateEmailAccountLimit(userId, limit);
    setEditingEmailAccountLimit(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-muted flex items-center justify-center text-foreground font-semibold">
                  {userData.full_name?.charAt(0)?.toUpperCase() || userData.email?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">{userData.full_name || 'Unbekannt'}</h3>
                  <p className="text-sm text-muted-foreground">{userData.email}</p>
                </div>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-white">
                <XCircle size={24} />
              </button>
          </div>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground uppercase tracking-wide">Grunddaten</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Unternehmen:</span>
                    <span className="text-sm text-white">{userData.company_name || 'Kein Unternehmen'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Upload-Berechtigung:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{userData.can_upload ? 'Aktiviert' : 'Deaktiviert'}</span>
                      {!userData.is_super_admin && (
                        <button
                          onClick={() => updateUploadPermission(userData.user_id, !userData.can_upload)}
                          disabled={isUpdateLoading === userData.user_id}
                          className="text-xs px-2 py-1 bg-muted border border-border text-white hover:bg-muted/80 disabled:opacity-50 transition-colors rounded"
                        >
                          {isUpdateLoading === userData.user_id ? '...' : (userData.can_upload ? 'Deaktivieren' : 'Aktivieren')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Super Admin:</span>
                    <span className="text-sm text-white">{userData.is_super_admin ? 'Ja' : 'Nein'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground uppercase tracking-wide">Limits</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Email-Limit:</span>
                    <div className="flex items-center gap-2">
                      {editingEmailLimit === userData.user_id ? (
                        <>
                          <input
                            type="number"
                            value={emailLimitValue}
                            onChange={(e) => setEmailLimitValue(parseInt(e.target.value) || 0)}
                            className="w-24 rounded border border-border bg-muted px-2 py-1 text-center text-white text-sm focus:border-border focus:outline-none"
                            min="0"
                            max="999999"
                          />
                          <button
                            onClick={() => handleUpdateEmailLimit(userData.user_id, emailLimitValue)}
                            disabled={isUpdateLoading === userData.user_id}
                            className="text-white hover:text-foreground disabled:opacity-50"
                            title="Speichern"
                          >
                            <Save size={16} />
                          </button>
                          <button
                            onClick={cancelEditingEmailLimit}
                            disabled={isUpdateLoading === userData.user_id}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                            title="Abbrechen"
                          >
                            <XCircle size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-white">{userData.email_limit?.toLocaleString() || '2000'}</span>
                          <button
                            onClick={() => startEditingEmailLimit(userData.user_id, userData.email_limit || 2000)}
                            className="text-muted-foreground hover:text-white transition-colors"
                            title="Email-Limit bearbeiten"
                          >
                            <Edit2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">KB-Limit:</span>
                    <div className="flex items-center gap-2">
                      {editingKnowledgeBaseLimit === userData.user_id ? (
                        <>
                          <input
                            type="number"
                            value={knowledgeBaseLimitValue}
                            onChange={(e) => setKnowledgeBaseLimitValue(parseInt(e.target.value) || 0)}
                            className="w-20 rounded border border-border bg-muted px-2 py-1 text-center text-white text-sm focus:border-border focus:outline-none"
                            min="0"
                            max="1000"
                          />
                          <button
                            onClick={() => handleUpdateKbLimit(userData.user_id, knowledgeBaseLimitValue)}
                            disabled={isUpdateLoading === userData.user_id}
                            className="text-white hover:text-foreground disabled:opacity-50"
                            title="Speichern"
                          >
                            <Save size={16} />
                          </button>
                          <button
                            onClick={() => setEditingKnowledgeBaseLimit(null)}
                            disabled={isUpdateLoading === userData.user_id}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                            title="Abbrechen"
                          >
                            <XCircle size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-white">{userData.knowledge_base_limit || 5}</span>
                          <button
                            onClick={() => {
                              setEditingKnowledgeBaseLimit(userData.user_id);
                              setKnowledgeBaseLimitValue(userData.knowledge_base_limit || 5);
                            }}
                            className="text-muted-foreground hover:text-white transition-colors"
                            title="KB-Limit bearbeiten"
                          >
                            <Edit2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Email-Account-Limit:</span>
                    <div className="flex items-center gap-2">
                      {editingEmailAccountLimit === userData.user_id ? (
                        <>
                          <input
                            type="number"
                            value={emailAccountLimitValue}
                            onChange={(e) => setEmailAccountLimitValue(parseInt(e.target.value) || 0)}
                            className="w-20 rounded border border-border bg-muted px-2 py-1 text-center text-white text-sm focus:border-border focus:outline-none"
                            min="0"
                            max="100"
                          />
                          <button
                            onClick={() => handleUpdateEmailAccountLimit(userData.user_id, emailAccountLimitValue)}
                            disabled={isUpdateLoading === userData.user_id}
                            className="text-white hover:text-foreground disabled:opacity-50"
                            title="Speichern"
                          >
                            <Save size={16} />
                          </button>
                          <button
                            onClick={() => setEditingEmailAccountLimit(null)}
                            disabled={isUpdateLoading === userData.user_id}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                            title="Abbrechen"
                          >
                            <XCircle size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-white">{userData.email_account_limit || 3}</span>
                          <button
                            onClick={() => {
                              setEditingEmailAccountLimit(userData.user_id);
                              setEmailAccountLimitValue(userData.email_account_limit || 3);
                            }}
                            className="text-muted-foreground hover:text-white transition-colors"
                            title="Email-Account-Limit bearbeiten"
                          >
                            <Edit2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Solution Company Assignment */}
            <div>
              <h4 className="text-sm font-medium text-foreground uppercase tracking-wide mb-3">
                Lösung-Zuordnung
              </h4>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Unternehmen
                </label>
                <Select
                  value={selectedCompany}
                  onValueChange={handleCompanyChange}
                  disabled={companiesLoading || solutionCompanyLoading === userData.user_id}
                >
                  <SelectTrigger className="w-full border-border bg-card text-white focus:ring-1 focus:ring-primary/50">
                    <SelectValue placeholder="Unternehmen auswählen" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 border-border bg-background text-white">
                    <SelectItem value="none" className="text-gray-200">
                      Kein Unternehmen
                    </SelectItem>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id} className="text-gray-200">
                        {company.name || company.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {solutionCompanyLoading === userData.user_id && (
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Speichere...
                  </p>
                )}
              </div>
            </div>

            {/* Solution Flags */}
            <div>
              <h4 className="text-sm font-medium text-foreground uppercase tracking-wide mb-3">Lösungen</h4>
              <div className="space-y-3">
                {([
                  {
                    key: 'chatbot' as SolutionFlagKey,
                    label: 'Chatbot',
                    description: 'Zugang zum Chatbot der Wissensdatenbank',
                    icon: Bot,
                  },
                  {
                    key: 'assistant' as SolutionFlagKey,
                    label: 'Assistant',
                    description: 'Assistenzfunktionen im Dashboard aktivieren',
                    icon: Sparkles,
                  },
                  {
                    key: 'phone' as SolutionFlagKey,
                    label: 'Phone',
                    description: 'Telefon-Lösungen nutzen',
                    icon: Phone,
                  },
                  {
                    key: 'mail' as SolutionFlagKey,
                    label: 'Mail',
                    description: 'E-Mail-Lösungen nutzen',
                    icon: Mail,
                  },
                  {
                    key: 'follow_up' as SolutionFlagKey,
                    label: 'Follow-up',
                    description: 'Folge-Aufgaben nach Gesprächen aktivieren',
                    icon: MessageSquare,
                  },
                ]).map(({ key, label, description, icon: Icon }) => {
                  const loadingKey = `${userData.user_id}:${key}`;
                  const isLoading = solutionFlagLoading === loadingKey;
                  const isEnabled = userData.solution_flags?.[key] ?? false;
                  const targetCompanyId =
                    userData.solution_flags?.company_id ?? userData.company_id ?? null;

                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded border border-border bg-card px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-full bg-muted p-2 text-foreground">
                          <Icon className="size-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{label}</p>
                          <p className="text-xs text-gray-500">{description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-xs font-medium ${
                            isEnabled ? 'text-primary' : 'text-gray-500'
                          }`}
                        >
                          {isEnabled ? 'Aktiviert' : 'Deaktiviert'}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateSolutionFlag(userData.user_id, key, !isEnabled, targetCompanyId)
                          }
                          disabled={isLoading}
                          className="flex items-center gap-2"
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Bitte warten...
                            </>
                          ) : (
                            <>
                              {isEnabled ? 'Deaktivieren' : 'Aktivieren'}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Knowledge Bases */}
            {userData.knowledge_bases.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-foreground uppercase tracking-wide mb-3">Knowledge Bases</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {userData.knowledge_bases.map((kb) => (
                    <div key={kb.id} className="flex items-center justify-between bg-card rounded p-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white truncate">{kb.name}</div>
                        <div className="text-xs text-gray-500 font-mono truncate">ID: {kb.id}</div>
                      </div>
                      <button
                        onClick={() => copyToClipboard(kb.id)}
                        className="ml-2 p-1 text-muted-foreground hover:text-white transition-colors"
                        title="ID kopieren"
                      >
                        {copiedId === kb.id ? (
                          <CheckIcon className="h-4 w-4 text-white" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Executive Report Settings */}
            <div>
              <h4 className="text-sm font-medium text-foreground uppercase tracking-wide mb-3">Executive Report</h4>
              <div className="bg-card rounded p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Status:</span>
                  <span className="text-sm text-white">{userData.executive_report_enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
                </div>
                {userData.executive_report_enabled && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Frequenz:</span>
                      <span className="text-sm text-white">{userData.executive_report_frequency}</span>
                    </div>
                    {userData.executive_report_email && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">E-Mail:</span>
                        <span className="text-sm text-white">{userData.executive_report_email}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Metrics */}
            <div>
              <h4 className="text-sm font-medium text-foreground uppercase tracking-wide mb-3">Aktivität</h4>
              {activityLoading ? (
                <div className="flex justify-center py-8">
                  <div className="size-6 animate-spin rounded-full border-2 border-pink-600 border-t-transparent"></div>
                </div>
              ) : userActivity ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-card rounded p-4 text-center">
                    <div className="text-2xl font-bold text-white">{userActivity.totalProcessLogs}</div>
                    <div className="text-xs text-muted-foreground">Process Logs</div>
                  </div>
                  <div className="bg-card rounded p-4 text-center">
                    <div className="text-2xl font-bold text-white">{userActivity.additionalStats.knowledgeBasesCount}</div>
                    <div className="text-xs text-muted-foreground">Knowledge Bases</div>
                  </div>
                  <div className="bg-card rounded p-4 text-center">
                    <div className="text-2xl font-bold text-white">{userActivity.additionalStats.emailAccountsCount}</div>
                    <div className="text-xs text-muted-foreground">Email Accounts</div>
                  </div>
                  <div className="bg-card rounded p-4 text-center">
                    <div className="text-2xl font-bold text-white">
                      {userActivity.avgFirstResponseTime ? userActivity.avgFirstResponseTime.toFixed(1) + 's' : 'N/A'}
                    </div>
                    <div className="text-xs text-muted-foreground">Avg Response</div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500">
                  <p>Aktivitätsdaten konnten nicht geladen werden.</p>
                </div>
              )}
            </div>
        </div>
      </div>
    </div>
  );
};
// =================================================================
// END: Standalone UserDetailModal Component
// =================================================================


export default function UserPermissionsManager({ user }: UserPermissionsManagerProps) {
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserPermission[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdateLoading, setIsUpdateLoading] = useState<string | null>(null);
  const [solutionFlagLoading, setSolutionFlagLoading] = useState<string | null>(null);
  const [solutionCompanyLoading, setSolutionCompanyLoading] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserPermission | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);

  // REMOVE editing states that are now in the modal
  // const [editingEmailLimit, setEditingEmailLimit] = useState<string | null>(null);
  // const [emailLimitValue, setEmailLimitValue] = useState<number>(0);
  // const [editingKnowledgeBaseLimit, setEditingKnowledgeBaseLimit] = useState<string | null>(null);
  // const [knowledgeBaseLimitValue, setKnowledgeBaseLimitValue] = useState<number>(0);
  // const [editingEmailAccountLimit, setEditingEmailAccountLimit] = useState<string | null>(null);
  // const [emailAccountLimitValue, setEmailAccountLimitValue] = useState<number>(0);
  
  const supabase = getSupabaseClient();

  const fetchCompanies = useCallback(async () => {
    try {
      setCompaniesLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch('/api/admin/companies', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Fehler beim Laden der Unternehmen');
      }

      const payload = await response.json();
      setCompanies(payload.companies || []);
    } catch (err: any) {
      console.error('Fehler beim Laden der Unternehmen:', err);
      setError(err.message || 'Fehler beim Laden der Unternehmen');
    } finally {
      setCompaniesLoading(false);
    }
  }, [supabase]);

  // Prüfen ob der aktuelle Benutzer Super-Admin ist
  useEffect(() => {
    const checkSuperAdmin = async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_super_admin')
          .eq('id', user.id)
          .single();
        
        setIsSuperAdmin(profile?.is_super_admin || false);
      } catch (err) {
        // console.error('Error checking super admin status:', err);
        setIsSuperAdmin(false);
      }
    };

    if (user?.id) {
      checkSuperAdmin();
    }
  }, [user, supabase]);

  // Benutzer laden
  const fetchUsers = async () => {
    if (!isSuperAdmin) return;

    try {
      setLoading(true);
      setError(null);

      // console.log('Fetching users as super admin...');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      // console.log('Session found, making API request...');

      const response = await fetch('/api/admin/manage-permissions', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      // console.log('API Response status:', response.status);

      const responseData = await response.json();
      // console.log('API Response data:', responseData);

      if (!response.ok) {
        // console.error('API Error:', responseData);
        const errorMessage = responseData.details
          ? `${responseData.error}: ${responseData.details}`
          : responseData.error || 'Fehler beim Laden der Benutzer';
        throw new Error(errorMessage);
      }

      // Erweiterte Benutzerdaten mit Metriken laden - DIREKTER ANSATZ
      const usersWithMetrics = await Promise.all(
        (responseData.users || []).map(async (user: any) => {
          console.log('🔄 Processing user:', user.full_name, user.user_id);
          
          // Direkte Berechnung der Metriken ohne API-Aufruf
          let directMetrics = null;
          try {
            // Zähle process_logs direkt über Supabase
            const { count: processLogsCount, error: plError } = await supabase
              .from('process_logs')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', user.user_id);

            const { count: kbCount, error: kbError } = await supabase
              .from('knowledge_bases')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', user.user_id);

            const { count: emailCount, error: emailError } = await supabase
              .from('user_email_accounts')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', user.user_id);

            if (!plError && !kbError && !emailError) {
              directMetrics = {
                totalProcessLogs: processLogsCount || 0,
                avgFirstResponseTime: 0, // Wird später berechnet
                lastActivityAt: null,
                lastEmailProcessedAt: null,
                additionalStats: {
                  knowledgeBasesCount: kbCount || 0,
                  emailAccountsCount: emailCount || 0,
                  totalProcessLogs: processLogsCount || 0
                }
              };
              console.log('✅ Direct metrics for', user.full_name, ':', directMetrics);
            } else {
              console.log('❌ Error getting direct metrics:', { plError, kbError, emailError });
            }
          } catch (err) {
            console.error('❌ Exception in direct metrics:', err);
          }

          const normalizedSolutionFlags = normalizeSolutionFlags(
            user.solution_flags,
            user.user_id,
            user.company_id ?? null
          );

          const userWithMetrics = {
            ...user,
            company_id: user.company_id ?? normalizedSolutionFlags.company_id,
            knowledge_base_limit: user.knowledge_base_limit || 5,
            email_account_limit: user.email_account_limit || 3,
            executive_report_enabled: user.executive_report_enabled || false,
            executive_report_frequency: user.executive_report_frequency || 'monthly',
            executive_report_email: user.executive_report_email || null,
            metrics: directMetrics,
            solution_flags: normalizedSolutionFlags
          };
          
          console.log('📊 Final user with metrics:', userWithMetrics);
          return userWithMetrics;
        })
      );

      console.log('All users with metrics:', usersWithMetrics);
      // GLOBALE STATISTIKEN über Backend-API abrufen (umgeht RLS)
      try {
        console.log('🌍 Fetching global statistics via API...');
        
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error('No session for global stats');
        }

        const response = await fetch('/api/admin/global-stats', {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const globalStatsData = await response.json();
          console.log('🌍 Global statistics from API:', globalStatsData);

          setGlobalStats(globalStatsData);

          // Füge globale Stats zu jedem User hinzu (für einheitliche Darstellung)
          const usersWithGlobalStats = usersWithMetrics.map(user => ({
            ...user,
            globalStats: globalStatsData
          }));

          setUsers(usersWithGlobalStats);
          setFilteredUsers(usersWithGlobalStats);
        } else {
          const errorText = await response.text();
          console.error('❌ Failed to fetch global stats:', response.status, errorText);
          setUsers(usersWithMetrics);
          setFilteredUsers(usersWithMetrics);
        }
      } catch (err) {
        console.error('❌ Error fetching global stats:', err);
        // Set default global stats if API fails
        const defaultGlobalStats = {
          totalProcessLogs: 0,
          totalKnowledgeBases: 0,
          totalEmailAccounts: 0,
          avgFirstResponseTime: 0
        };
        setGlobalStats(defaultGlobalStats);
        setUsers(usersWithMetrics);
        setFilteredUsers(usersWithMetrics);
      }
        
        // console.log('Users loaded successfully:', responseData.users?.length || 0);
    } catch (err: any) {
      // console.error('Error fetching users:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetchUsers();
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchCompanies();
    }
  }, [isSuperAdmin, fetchCompanies]);

  // Suchfunktion
  useEffect(() => {
    const filtered = users.filter(user => 
      (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (user.full_name && user.full_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (user.company_name && user.company_name.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    setFilteredUsers(filtered);
  }, [searchTerm, users]);

  const applySolutionFlagsUpdate = useCallback((targetUserId: string, normalizedFlags: SolutionFlags) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === targetUserId
          ? { ...u, company_id: normalizedFlags.company_id, solution_flags: normalizedFlags }
          : u
      )
    );

    setFilteredUsers((prev) =>
      prev.map((u) =>
        u.user_id === targetUserId
          ? { ...u, company_id: normalizedFlags.company_id, solution_flags: normalizedFlags }
          : u
      )
    );

    if (selectedUser?.user_id === targetUserId) {
      setSelectedUser((prev) =>
        prev
          ? { ...prev, company_id: normalizedFlags.company_id, solution_flags: normalizedFlags }
          : null
      );
    }
  }, [selectedUser]);

  // Upload-Permission aktualisieren
  const updateUploadPermission = async (targetUserId: string, canUpload: boolean) => {
    try {
      setIsUpdateLoading(targetUserId);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch('/api/admin/manage-permissions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId,
          canUpload,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update permission');
      }

      // Lokalen State aktualisieren
      setUsers(prev => prev.map(u =>
        u.user_id === targetUserId
          ? { ...u, can_upload: canUpload }
          : u
      ));

      // Update selected user if it's the same user
      if (selectedUser?.user_id === targetUserId) {
        setSelectedUser(prev => prev ? { ...prev, can_upload: canUpload } : null);
      }

    } catch (err: any) {
      // console.error('Error updating permission:', err);
      setError(err.message);
    } finally {
      setIsUpdateLoading(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(text);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      // console.error('Failed to copy text: ', err);
    }
  };

  // Email-Limit bearbeiten
  // const startEditingEmailLimit = (userId: string, currentLimit: number) => {
  //   setEditingEmailLimit(userId);
  //   setEmailLimitValue(currentLimit);
  // };

  // const cancelEditingEmailLimit = () => {
  //   setEditingEmailLimit(null);
  //   setEmailLimitValue(0);
  // };

  // Email-Limit aktualisieren
  const updateEmailLimit = async (targetUserId: string, newLimit: number) => {
    try {
      setIsUpdateLoading(targetUserId);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch('/api/admin/manage-permissions', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId,
          emailLimit: newLimit,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update email limit');
      }

      // Lokalen State aktualisieren
      setUsers(prev => prev.map(u =>
        u.user_id === targetUserId
          ? { ...u, email_limit: newLimit }
          : u
      ));

      // Update selected user if it's the same user
      if (selectedUser?.user_id === targetUserId) {
        setSelectedUser(prev => prev ? { ...prev, email_limit: newLimit } : null);
      }

      // setEditingEmailLimit(null); // This is now handled by the modal
      // setEmailLimitValue(0); // This is now handled by the modal

    } catch (err: any) {
      setError(`Fehler beim Aktualisieren des Email-Limits: ${err.message}`);
    } finally {
      setIsUpdateLoading(null);
    }
  };

  // Knowledge Base Limit aktualisieren
  const updateKnowledgeBaseLimit = async (targetUserId: string, newLimit: number) => {
    try {
      setIsUpdateLoading(targetUserId);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch(`/api/admin/user-limits/${targetUserId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          knowledgeBaseLimit: newLimit,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update knowledge base limit');
      }

      // Lokalen State aktualisieren
      setUsers(prev => prev.map(u =>
        u.user_id === targetUserId
          ? { ...u, knowledge_base_limit: newLimit }
          : u
      ));

      // Update selected user if it's the same user
      if (selectedUser?.user_id === targetUserId) {
        setSelectedUser(prev => prev ? { ...prev, knowledge_base_limit: newLimit } : null);
      }

      // setEditingKnowledgeBaseLimit(null); // This is now handled by the modal
      // setKnowledgeBaseLimitValue(0); // This is now handled by the modal

    } catch (err: any) {
      setError(`Fehler beim Aktualisieren des Knowledge Base-Limits: ${err.message}`);
    } finally {
      setIsUpdateLoading(null);
    }
  };

  // Email Account Limit aktualisieren
  const updateEmailAccountLimit = async (targetUserId: string, newLimit: number) => {
    try {
      setIsUpdateLoading(targetUserId);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch(`/api/admin/user-limits/${targetUserId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailAccountLimit: newLimit,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update email account limit');
      }

      // Lokalen State aktualisieren
      setUsers(prev => prev.map(u =>
        u.user_id === targetUserId
          ? { ...u, email_account_limit: newLimit }
          : u
      ));

      // Update selected user if it's the same user
      if (selectedUser?.user_id === targetUserId) {
        setSelectedUser(prev => prev ? { ...prev, email_account_limit: newLimit } : null);
      }

      // setEditingEmailAccountLimit(null); // This is now handled by the modal
      // setEmailAccountLimitValue(0); // This is now handled by the modal

    } catch (err: any) {
      setError(`Fehler beim Aktualisieren des Email Account-Limits: ${err.message}`);
    } finally {
      setIsUpdateLoading(null);
    }
  };

  const updateSolutionFlag = async (
    targetUserId: string,
    flag: SolutionFlagKey,
    value: boolean,
    companyId?: string | null
  ) => {
    try {
      const loadingKey = `${targetUserId}:${flag}`;
      setSolutionFlagLoading(loadingKey);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch(`/api/admin/user-solution-flags/${targetUserId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [flag]: value,
          companyId: companyId ?? null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update solution flag');
      }

      const updatedFlags = await response.json();
      const normalizedFlags = normalizeSolutionFlags(
        updatedFlags,
        targetUserId,
        companyId ?? null
      );
      applySolutionFlagsUpdate(targetUserId, normalizedFlags);
    } catch (err: any) {
      setError(`Fehler beim Aktualisieren der Lösungen: ${err.message}`);
    } finally {
      setSolutionFlagLoading(null);
    }
  };

  const updateSolutionCompany = async (
    targetUserId: string,
    companyId: string | null
  ) => {
    try {
      const loadingKey = targetUserId;
      setSolutionCompanyLoading(loadingKey);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch(`/api/admin/user-solution-flags/${targetUserId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update solution company');
      }

      const updatedFlags = await response.json();
      const normalizedFlags = normalizeSolutionFlags(
        updatedFlags,
        targetUserId,
        companyId ?? null
      );
      applySolutionFlagsUpdate(targetUserId, normalizedFlags);
    } catch (err: any) {
      setError(`Fehler beim Aktualisieren der Company: ${err.message}`);
    } finally {
      setSolutionCompanyLoading(null);
    }
  };




  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-background p-8">
        <AlertTriangle className="mb-4 size-12 text-muted-foreground" />
        <h3 className="mb-2 text-lg font-medium text-white">Zugriff verweigert</h3>
        <p className="text-center text-muted-foreground">
          Sie haben keine Berechtigung, Benutzer-Permissions zu verwalten.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="size-6 animate-spin rounded-full border-2 border-pink-600 border-t-transparent"></div>
      </div>
    );
  }

  // REMOVE the old UserDetailModal definition here

  return (
    <div className="space-y-6">

      {/* Error Display */}
      {error && (
        <div className="mt-1">
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Benutzer suchen (Name, Email, Unternehmen)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-3 text-white placeholder:text-muted-foreground focus:border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Gesamt Benutzer</span>
          </div>
          <p className="text-2xl font-bold text-white">{globalStats?.totalUsers || users.length}</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Super Admins</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {globalStats?.totalSuperAdmins || users.filter(u => u.is_super_admin).length}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Knowledge Bases</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {globalStats?.totalKnowledgeBases || 0}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Settings className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Process Logs</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {globalStats?.totalProcessLogs?.toLocaleString() || '0'}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Aktive Benutzer (30T)</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {globalStats?.activeUsersLast30Days || '0'}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Dokumente</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {globalStats?.totalDocuments?.toLocaleString() || '0'}
          </p>
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 400px)' }}>
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full min-w-[800px]">
            <thead className="bg-card border-b border-border sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-foreground">
                  Benutzer
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-foreground hidden md:table-cell">
                  Unternehmen
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-foreground">
                  Berechtigung
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-foreground hidden sm:table-cell">
                  Email-Limit
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-foreground hidden lg:table-cell">
                  KB-Limit
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-foreground hidden lg:table-cell">
                  Acc-Limit
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-foreground hidden xl:table-cell">
                  Lösungen
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-foreground">
                  Aktionen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#333333]">
              {filteredUsers.map((userPermission) => {
                const flags = userPermission.solution_flags;
                const activeSolutions: string[] = [];
                if (flags?.chatbot) activeSolutions.push('Chatbot');
                if (flags?.assistant) activeSolutions.push('Assistant');
                if (flags?.phone) activeSolutions.push('Phone');
                if (flags?.mail) activeSolutions.push('Mail');
                if (flags?.follow_up) activeSolutions.push('Follow-up');

                return (
                  <tr key={userPermission.user_id} className="border-b border-border hover:bg-card transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-full bg-muted flex items-center justify-center text-white text-sm font-semibold">
                        {userPermission.full_name?.charAt(0)?.toUpperCase() || userPermission.email?.charAt(0)?.toUpperCase() || 'U'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">
                          {userPermission.full_name || 'Unbekannt'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{userPermission.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <p className="text-sm text-foreground">
                      {userPermission.company_name || 'Kein Unternehmen'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2">
                        {userPermission.can_upload ? (
                          <div className="flex items-center gap-1 text-white">
                            <div className="size-2 rounded-full bg-white"></div>
                            <span className="text-xs">Upload</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-gray-500">
                            <div className="size-2 rounded-full bg-gray-500"></div>
                            <span className="text-xs">Kein Upload</span>
                          </div>
                        )}
                      </div>
                      {userPermission.is_super_admin && (
                        <div className="flex items-center gap-1">
                          <Shield className="size-3 text-white" />
                          <span className="text-xs text-white">Admin</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center hidden sm:table-cell">
                    <span className="text-sm text-foreground">
                      {userPermission.email_limit?.toLocaleString() || '2000'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center hidden lg:table-cell">
                    <span className="text-sm text-foreground">
                      {userPermission.knowledge_base_limit || 5}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center hidden lg:table-cell">
                    <span className="text-sm text-foreground">
                      {userPermission.email_account_limit || 3}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center hidden xl:table-cell">
                    {activeSolutions.length > 0 ? (
                      <div className="flex flex-wrap justify-center gap-1">
                        {activeSolutions.map((label) => (
                          <span
                            key={label}
                            className="rounded-full bg-pink-600/10 px-2 py-0.5 text-xs font-medium text-pink-200"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">Keine</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedUser(userPermission);
                          setShowUserModal(true);
                        }}
                        className="p-2 text-muted-foreground hover:text-white transition-colors"
                        title="Details anzeigen"
                      >
                        <Eye size={16} />
                      </button>
                      {!userPermission.can_upload && !userPermission.is_super_admin && (
                        <button
                          onClick={() => updateUploadPermission(userPermission.user_id, true)}
                          disabled={isUpdateLoading === userPermission.user_id}
                          className="px-3 py-1 text-xs bg-muted border border-border text-white hover:bg-muted/80 disabled:opacity-50 transition-colors rounded"
                        >
                          {isUpdateLoading === userPermission.user_id ? '...' : 'Freischalten'}
                        </button>
                      )}
                      {userPermission.can_upload && !userPermission.is_super_admin && (
                        <button
                          onClick={() => updateUploadPermission(userPermission.user_id, false)}
                          disabled={isUpdateLoading === userPermission.user_id}
                          className="px-3 py-1 text-xs bg-muted border border-border text-white hover:bg-muted/80 disabled:opacity-50 transition-colors rounded"
                        >
                          {isUpdateLoading === userPermission.user_id ? '...' : 'Sperren'}
                        </button>
                      )}
                    </div>
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {filteredUsers.length === 0 && searchTerm && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <Search className="mx-auto mb-4 size-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium text-white">Keine Benutzer gefunden</h3>
          <p className="text-muted-foreground">
            Keine Benutzer entsprechen Ihrer Suche nach "{searchTerm}".
          </p>
        </div>
      )}

      {users.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <Users className="mx-auto mb-4 size-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium text-white">Keine Benutzer gefunden</h3>
          <p className="text-muted-foreground">
            Es wurden keine Benutzer in der Datenbank gefunden.
          </p>
        </div>
      )}

      {/* User Detail Modal */}
      {showUserModal && selectedUser && (
        <UserDetailModal 
          user={selectedUser} 
          onClose={() => {
            setShowUserModal(false);
            setSelectedUser(null);
          }}
          isUpdateLoading={isUpdateLoading}
          solutionFlagLoading={solutionFlagLoading}
          solutionCompanyLoading={solutionCompanyLoading}
          companies={companies}
          companiesLoading={companiesLoading}
          updateUploadPermission={updateUploadPermission}
          updateEmailLimit={updateEmailLimit}
          updateKnowledgeBaseLimit={updateKnowledgeBaseLimit}
          updateEmailAccountLimit={updateEmailAccountLimit}
          updateSolutionFlag={updateSolutionFlag}
          updateSolutionCompany={updateSolutionCompany}
        />
      )}
    </div>
  );
} 