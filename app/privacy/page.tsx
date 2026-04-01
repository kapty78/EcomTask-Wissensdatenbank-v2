import Link from "next/link"

export default function PrivacyPage() {
  const updatedAt = new Date().toLocaleDateString("de-DE")
  return (
    <div className="min-h-screen overflow-y-auto" style={{ height: '100vh', overflow: 'auto' }}>
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 sm:py-12 text-white">
      <div className="mb-4 sm:mb-6 text-center">
        <div className="mb-2">
          <Link href="/login" className="text-xs sm:text-sm text-gray-400 hover:underline">← Zurück</Link>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold px-2">Datenschutzbestimmungen</h1>
        <p className="mt-1 text-xs text-gray-400">Zuletzt aktualisiert: {updatedAt}</p>
      </div>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">1. Verantwortlicher und Datenschutzkontakt</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          EcomTask UG (haftungsbeschränkt), Rauenthaler Straße 12, 65197 Wiesbaden, Deutschland. Kontakt für Datenschutzanfragen: <a className="underline hover:no-underline break-all" href="mailto:privacy@ecomtask.de">privacy@ecomtask.de</a>.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">2. Geltungsbereich und Rollen</h2>
        <p className="text-xs sm:text-sm text-gray-300 mb-3 leading-relaxed">
          Diese Datenschutzhinweise gelten für die Nutzung der AI-Mitarbeiter Lösung sowie der zugehörigen Portale.
        </p>
        <p className="text-xs sm:text-sm text-gray-300 mb-3 leading-relaxed">
          <span className="font-semibold">a) Portal/Konto/Abrechnung:</span> EcomTask agiert als Verantwortlicher (z. B. Authentifizierung, Support, Abrechnung).
        </p>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          <span className="font-semibold">b) Verarbeitung von Service-Inhalten (Outlook-E-Mails):</span> EcomTask agiert als Auftragsverarbeiter des Kunden; es gilt vorrangig der AVV gem. Art. 28 DSGVO einschließlich Anlagen.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">3. Kategorien personenbezogener Daten</h2>
        <ul className="list-disc space-y-2 pl-5 text-xs sm:text-sm text-gray-300 leading-relaxed">
          <li><span className="font-semibold">Kontodaten und Authentifizierung:</span> E-Mail-Adresse, optional Name und Organisationszuordnung, Sitzungs-/Token-Daten und ggf. MFA-Faktoren.</li>
          <li><span className="font-semibold">Nutzungs- und technische Protokolle:</span> Zeitstempel, Status- und Fehlercodes sowie Admin-/Zugriffsereignisse (ohne Nachrichtentexte).</li>
          <li><span className="font-semibold">Service-Inhalte in der Auftragsverarbeitung:</span> eingehende E-Mails, Klassifizierungs-Labels, Antwortentwürfe, Verweise auf Wissensobjekte, Ticket- und Reportingdaten. Betroffen sind insbesondere Anfragende/Endkund:innen des Kunden und dessen Mitarbeitende.</li>
        </ul>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">4. Zwecke und Rechtsgrundlagen</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Wir verarbeiten Daten, um die AI-Mitarbeiter Lösung bereitzustellen, Konten zu verwalten, Sicherheit und Stabilität zu gewährleisten sowie Fehler zu analysieren (Art. 6 Abs. 1 b, f DSGVO). Soweit gesetzliche Pflichten – etwa Meldepflichten nach NIS-2 – einschlägig sind, erfolgt die Verarbeitung auf Grundlage von Art. 6 Abs. 1 c DSGVO. Die Verarbeitung von E-Mail-Inhalten im Rahmen der AI-Mitarbeiter Lösung erfolgt weisungsgebunden als Auftragsverarbeitung; insoweit ist der AVV vorrangig.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">5. Empfänger und Unterauftragsverarbeiter</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Wir setzen Unterauftragsverarbeiter gemäß der AVV-Anlage ein. Die Verarbeitung erfolgt primär in der EU/EWR; Drittlandzugriffe sind nur mit geeigneten Garantien zulässig (insb. EU-SCCs). In der AVV-Anlage sind u. a. Microsoft Ireland (Azure/Graph/Exchange Online) und OpenAI Ireland genannt, jeweils mit Verweisen auf deren TOMs.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">6. Übermittlungen in Drittländer</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Sofern ausnahmsweise Zugriffe aus Drittländern erforderlich werden, erfolgen diese ausschließlich nach Maßgabe der Art. 44 ff. DSGVO auf Basis geeigneter Garantien (insbesondere Standardvertragsklauseln) und dokumentierter Schutzmaßnahmen; Details ergeben sich aus der AVV-Anlage „Unterauftragsverhältnisse".
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">7. Speicherfristen und Löschung</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Inhaltsdaten (z. B. E-Mail-Kontext und Antwortentwürfe) speichern wir nur so lange, wie es für die Zwecke der Verarbeitung erforderlich ist; in der Regel erfolgt eine automatisierte Löschung innerhalb von bis zu sechs Monaten. Sicherheits- und Audit-Protokolle ohne Inhalte werden zur Erfüllung von Nachweis- und Prüfpflichten bis zu drei Jahren vorgehalten. Konfigurations- und Regeldaten werden bis zur Änderung oder bis zum Vertragsende gespeichert und anschließend gelöscht. Nach Vertragsende löscht EcomTask verbleibende Kundendaten spätestens nach 30 Tagen.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">8. Sicherheit (TOMs) – Auszug</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Wir schützen Daten mit Transportverschlüsselung (TLS 1.2+) und Speicherverschlüsselung (AES-256). Der Zugriff erfolgt über SSO/OIDC und RBAC mit MFA; wir setzen WAF, Rate-Limiting, CSRF/XSS-Schutz, Monitoring/SIEM sowie regelmäßige Patches und Tests ein. Backups werden täglich inkrementell und wöchentlich voll erstellt; RTO ≤ 4 Stunden und RPO ≤ 24 Stunden sind definiert und werden quartalsweise getestet.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">9. Automatisierte Entscheidungen und Transparenz (KI)</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Antworten der AI-Mitarbeiter Lösung können (teil-)automatisiert erstellt werden. In Fällen mit erkennbarer rechtlicher, sicherheitsrelevanter oder haftungsrechtlicher Tragweite stellt der Kunde eine menschliche Prüfung sicher, bevor Antworten versendet werden. Änderungen an Modellen und Prompts werden zu Audit-Zwecken dokumentiert.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">10. Postfach-Anbindung mit Least-Privilege</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Der Zugriff auf Postfächer erfolgt über OAuth2 Client-Credentials (Service-Principal). Die ApplicationAccessPolicy (AAP) beschränkt den Zugriff auf vorher festgelegte Postfächer bzw. Ordner. Es werden nur minimale Berechtigungen (z. B. *Mail.Read*, *Mail.Send*, ggf. *MailboxSettings.Read*) vergeben. Ergänzend gelten Conditional Access, regelmäßige Geheimnis-/Zertifikatsrotationen und Zugangszertifizierungen.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">11. Datenportabilität und Exit</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Auf Verlangen stellen wir maschinenlesbare Exporte bereit (z. B. JSON/EML für E-Mail-Daten; Snapshots der Wissensbasis bei kundenspezifischen Inhalten). Die Übergabe erfolgt über abgesicherte Kanäle; nach Abschluss werden Löschungen bestätigt. Die vertraglichen Details zur Portabilität und zum Anbieterwechsel – inklusive Fristen – ergeben sich aus dem Hauptvertrag.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">12. Betroffenenrechte</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Betroffene haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch gegen Verarbeitungen auf Basis berechtigter Interessen. Einwilligungen können jederzeit mit Wirkung für die Zukunft widerrufen werden. Anfragen richten Sie bitte an <a className="underline hover:no-underline" href="mailto:privacy@ecomtask.de">privacy@ecomtask.de</a>.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">13. Meldungen zu Sicherheitsvorfällen</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Wir betreiben eine sicherheitsorientierte Überwachung (SIEM). Meldepflichtige Vorfälle werden zeitnah adressiert: Wir informieren zunächst mit einer Erstmeldung, gefolgt von einem Detailbericht innerhalb von 72 Stunden; anschließend dokumentieren wir die Ergebnisse und passen die TOMs an, sofern dies erforderlich ist.
        </p>
      </section>

      <section className="mb-8 sm:mb-10">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">14. Änderungen dieser Hinweise</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Wir passen diese Datenschutzhinweise an, sobald sich rechtliche Vorgaben oder der Funktionsumfang der AI-Mitarbeiter Lösung ändern. Die aktuelle Fassung ist im Produkt bzw. Portal abrufbar.
        </p>
      </section>

      <div className="mb-4 sm:mb-6 text-center">
        <Link href="/login" className="inline-block rounded-full border border-[#3a3a3a] bg-[#2a2a2a] px-4 py-2.5 sm:py-2 text-xs sm:text-sm text-white hover:bg-[#333333]">
          Zurück zur Account-Auswahl
        </Link>
      </div>

      <div className="text-center text-xs text-gray-400 px-2 pb-4">
        <Link href="/terms" className="hover:underline">Nutzungsbedingungen</Link>
        <span className="mx-1 sm:mx-2">|</span>
        <Link href="/privacy" className="hover:underline">Datenschutzrichtlinie</Link>
      </div>
    </main>
    </div>
  )
}


