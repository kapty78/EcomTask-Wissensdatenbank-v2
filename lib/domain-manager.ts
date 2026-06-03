// Namespace für localStorage-Keys
const STORAGE_KEYS = {
  DOMAIN: "ecomtask_domain",
  COMPANY: "ecomtask_company"
}

export interface CompanyInfo {
  id: string
  name: string
  domain: string
}

/**
 * Speichert die angegebene Domain im localStorage
 */
export const saveDomain = (domain: string): void => {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEYS.DOMAIN, domain)
    } catch (error) {
      console.error("Fehler beim Speichern der Domain:", error)
    }
  }
}

/**
 * Speichert die Unternehmensinformationen im localStorage
 */
export const saveCompany = (company: CompanyInfo): void => {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(company))
    } catch (error) {
      console.error(
        "Fehler beim Speichern der Unternehmensinformationen:",
        error
      )
    }
  }
}

/**
 * Liest die gespeicherte Domain aus dem localStorage
 */
export const getSavedDomain = (): string | null => {
  if (typeof window !== "undefined") {
    try {
      return localStorage.getItem(STORAGE_KEYS.DOMAIN)
    } catch (error) {
      console.error("Fehler beim Lesen der Domain:", error)
      return null
    }
  }
  return null
}

/**
 * Liest die gespeicherten Unternehmensinformationen aus dem localStorage
 */
export const getSavedCompany = (): CompanyInfo | null => {
  if (typeof window !== "undefined") {
    try {
      const companyData = localStorage.getItem(STORAGE_KEYS.COMPANY)
      if (companyData) {
        return JSON.parse(companyData)
      }
      return null
    } catch (error) {
      console.error("Fehler beim Lesen der Unternehmensinformationen:", error)
      return null
    }
  }
  return null
}

/**
 * Löscht die gespeicherte Domain aus dem localStorage
 */
export const clearDomain = (): void => {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEYS.DOMAIN)
    } catch (error) {
      console.error("Fehler beim Löschen der Domain:", error)
    }
  }
}

/**
 * Löscht alle gespeicherten Unternehmensdaten aus dem localStorage
 */
export const clearCompanyData = (): void => {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEYS.DOMAIN)
      localStorage.removeItem(STORAGE_KEYS.COMPANY)
    } catch (error) {
      console.error("Fehler beim Löschen der Unternehmensdaten:", error)
    }
  }
}

/**
 * Normalisiert eine Domain-Eingabe (entfernt http://, www., etc.)
 */
export const normalizeDomain = (domain: string): string => {
  let cleanDomain = domain.trim().toLowerCase()
  cleanDomain = cleanDomain.replace(/^https?:\/\//, "")
  cleanDomain = cleanDomain.replace(/^www\./, "")
  return cleanDomain
}

/**
 * Validiert ein Domain-Format
 */
export const isValidDomain = (domain: string): boolean => {
  const domainPattern = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/
  return domainPattern.test(domain)
}

/**
 * Formatiert einen Benutzernamen zu einer E-Mail mit der Domain
 */
export const formatEmailWithDomain = (
  username: string,
  domain: string
): string => {
  // Wenn bereits eine E-Mail ist, nicht ändern
  if (username.includes("@")) {
    return username
  }
  return `${username}@${domain}`
}

/**
 * Extracts the company/account name from a full domain
 */
export const extractAccountName = (domain: string): string => {
  if (!domain) return ""

  // Handle app.ecomtask.cloud format
  if (domain.endsWith(".app.ecomtask.cloud")) {
    return domain.replace(".app.ecomtask.cloud", "")
  }

  // Otherwise, return the subdomain
  const parts = domain.split(".")
  if (parts.length > 1) {
    return parts[0]
  }

  return domain
}

/**
 * Formats an account name to a full domain
 */
export const formatAccountDomain = (accountName: string): string => {
  if (!accountName) return ""

  // Already has the full domain?
  if (accountName.includes(".")) {
    return normalizeDomain(accountName)
  }

  // Otherwise, append the standard suffix
  return `${accountName}.app.ecomtask.cloud`
}
