export interface SolutionFlags {
  id: string | null;
  user_id?: string;
  company_id: string | null;
  phone: boolean;
  chatbot: boolean;
  assistant: boolean;
  mail: boolean;
  follow_up: boolean;
}

export interface CompanyOption {
  id: string;
  name: string | null;
}

export interface UserPermission {
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

export type SolutionFlagKey = 'phone' | 'chatbot' | 'assistant' | 'mail' | 'follow_up';

export interface GlobalStats {
  totalUsers: number;
  totalSuperAdmins: number;
  totalKnowledgeBases: number;
  totalProcessLogs: number;
  activeUsersLast30Days: number;
  totalDocuments: number;
}

export interface UserActivity {
  totalProcessLogs: number;
  avgFirstResponseTime: number;
  lastActivityAt: string | null;
  lastEmailProcessedAt: string | null;
  additionalStats: {
    knowledgeBasesCount: number;
    emailAccountsCount: number;
    totalProcessLogs: number;
    documentsCount?: number;
  };
}

export const SOLUTION_FLAG_CONFIG = [
  {
    key: 'chatbot' as SolutionFlagKey,
    label: 'Chatbot',
    description: 'Zugang zum Chatbot der Wissensdatenbank',
  },
  {
    key: 'assistant' as SolutionFlagKey,
    label: 'Assistant',
    description: 'Assistenzfunktionen im Dashboard aktivieren',
  },
  {
    key: 'phone' as SolutionFlagKey,
    label: 'Phone',
    description: 'Telefon-Lösungen nutzen',
  },
  {
    key: 'mail' as SolutionFlagKey,
    label: 'Mail',
    description: 'E-Mail-Lösungen nutzen',
  },
  {
    key: 'follow_up' as SolutionFlagKey,
    label: 'Follow-up',
    description: 'Folge-Aufgaben nach Gesprächen aktivieren',
  },
] as const;

export const normalizeSolutionFlags = (
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
