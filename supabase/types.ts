/**
 * NOTE:
 * Diese Datei ist normalerweise auto-generiert (Supabase DB Types).
 * Sie war zuvor kaputt (enthielt Terminal-Escape-Sequenzen aus einem interaktiven CLI-Prompt),
 * was den TypeScript-Compiler komplett blockiert.
 *
 * Regenerieren (empfohlen), sobald lokal Supabase läuft:
 * - `npm run db-types`
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// Fallback: wir behalten es bewusst breit, damit das Projekt wieder kompiliert.
// (Typisierung kann jederzeit per `npm run db-types` wieder hergestellt werden.)
export type Database = any

// Minimal-API, die viele Stellen im Code erwarten (Supabase Types Helper).
// Diese Typen sind absichtlich "any" bis zur echten Regeneration.
export type Tables<
  _TableNameOrOptions extends string | { schema: string } = any,
  _TableName extends string = any
> = any

export type TablesInsert<
  _TableNameOrOptions extends string | { schema: string } = any,
  _TableName extends string = any
> = any

export type TablesUpdate<
  _TableNameOrOptions extends string | { schema: string } = any,
  _TableName extends string = any
> = any

export type Enums<
  _EnumNameOrOptions extends string | { schema: string } = any,
  _EnumName extends string = any
> = any