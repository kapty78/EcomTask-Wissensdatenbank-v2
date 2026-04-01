import Link from "next/link"

export default function TermsPage() {
  const updatedAt = new Date().toLocaleDateString("de-DE")
  return (
    <div className="min-h-screen overflow-y-auto" style={{ height: '100vh', overflow: 'auto' }}>
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 sm:py-12 text-white">
      <div className="mb-4 sm:mb-6 text-center">
        <div className="mb-2">
          <Link href="/login" className="text-xs sm:text-sm text-gray-400 hover:underline">← Zurück</Link>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold px-2">Nutzungsbedingungen</h1>
        <p className="mt-1 text-xs text-gray-400">Zuletzt aktualisiert: {updatedAt}</p>
      </div>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">1. Geltungsbereich und Rangfolge</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Diese Nutzungsbedingungen regeln die Nutzung der cloudbasierten AI-Mitarbeiter Lösung. Vorrangig gelten die Bestimmungen des Hauptvertrags (SaaS) sowie der Vereinbarung zur Auftragsverarbeitung (AVV) einschließlich ihrer Anlagen. Bei Widersprüchen haben der Hauptvertrag und die AVV Vorrang vor diesen Nutzungsbedingungen.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">2. Leistungsbeschreibung</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Die AI-Mitarbeiter Lösung unterstützt die KI-gestützte Verarbeitung eingehender E-Mails. Sie klassifiziert Anfragen, erstellt Antwortentwürfe, greift bei Bedarf auf eine Wissensbasis zurück (Retrieval/RAG), protokolliert Abläufe und kann Anfragen an Mitarbeitende weiterleiten oder eskalieren. Für den Outlook-Einsatz erfolgt der Zugriff über die Microsoft Graph-API / Exchange Online im Tenant des Kunden. EcomTask darf die Software bei sachlichem Grund – etwa aufgrund geänderter rechtlicher Anforderungen, sicherheitsrelevanter Aspekte oder für Stabilitätsverbesserungen – weiterentwickeln und anpassen; berechtigte Interessen des Kunden werden berücksichtigt. Die Nutzung setzt eine funktionsfähige Microsoft-365-Instanz und die Erteilung der erforderlichen Graph-Berechtigungen voraus.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">3. Registrierung, Konten und Administration</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Für die Nutzung werden Benutzerkonten benötigt, deren Zugangsdaten vertraulich zu behandeln sind. Administratoren der Kundenorganisation können Rollen und Berechtigungen im Rahmen des Systems zuweisen.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">4. Nutzungsrechte</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Der Kunde erhält für die Vertragslaufzeit ein einfaches, nicht übertragbares Recht, die AI-Mitarbeiter Lösung im vertraglich vereinbarten Umfang zu nutzen. Eine Unterlizenzierung ist ausgeschlossen.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">5. Acceptable-Use-Policy (AUP)</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Die Nutzung unterliegt der Acceptable-Use-Policy. Untersagt sind insbesondere Inhalte, die gegen Strafgesetze oder den Jugendmedienschutz verstoßen, Rechte Dritter verletzen, Malware enthalten oder terroristische beziehungsweise gewaltverherrlichende Ziele fördern. Untersagt ist außerdem der Versand irreführender oder täuschender Massenkommunikation (Spam). Technisch ist jede Umgehung von Authentifizierungs-, Zugriffskontroll- oder Ratelimit-Mechanismen sowie Prompt-Injection untersagt; eine Überlastung der Infrastruktur ist zu vermeiden. Verstöße oder Hinweise auf illegale Inhalte sind unverzüglich an die 24/7-Meldestelle zu senden; der Eingang wird innerhalb von 24 Stunden bestätigt. EcomTask kann betroffene Postfächer oder Anfragen vorübergehend sperren, eine Frist zur Abhilfe setzen und bei schwerwiegenden oder wiederholten Verletzungen dauerhaft sperren oder außerordentlich kündigen. Änderungen der AUP werden mindestens sechs Wochen vor Inkrafttreten angekündigt.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">6. Service Levels, Wartung und Störungen</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          EcomTask stellt eine Monatsverfügbarkeit von 98 % am Übergabepunkt bereit. Schwerwiegende Störungen werden – bei Meldung innerhalb der Servicezeiten – spätestens binnen 12 Stunden behoben; sonstige erhebliche Störungen werden innerhalb von 48 Stunden innerhalb der Servicezeiten behoben. Zusätzlich gilt eine Lösungsfrist von 48 Stunden für 95 % der gemeldeten technischen Störungen; wird diese überschritten, hat der Kunde ein Minderungsrecht. Störungen sind über den Support zu melden; die Servicezeiten sind Montag bis Freitag (bundesweite Feiertage ausgenommen) von 9 bis 16 Uhr. Wartungen finden grundsätzlich außerhalb üblicher Geschäftszeiten statt und werden vorab kommuniziert.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">7. Preise, Abrechnung und etwaige Limits</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Für Entgelte, Abrechnung und etwaige Nutzungs-Limits gelten ausschließlich die Regelungen des Hauptvertrags. Diese Nutzungsbedingungen enthalten keine eigenständigen Preis- oder Planangaben.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">8. Datenschutz, AVV und Unterauftragsverarbeiter</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Soweit EcomTask personenbezogene Daten im Auftrag des Kunden verarbeitet (insbesondere E-Mail-Inhalte), gilt vorrangig der Auftragsverarbeitungsvertrag (AVV) gemäß Art. 28 DSGVO einschließlich seiner Anlagen zu technisch-organisatorischen Maßnahmen (TOMs) sowie der Unterauftragsverarbeiter-Liste. Die Verarbeitung erfolgt primär im EU/EWR-Raum; Drittlandzugriffe sind nur unter geeigneten Garantien (insbesondere EU-SCCs) zulässig. Als Unterauftragsverarbeiter sind in der AVV u. a. Microsoft (Azure/Graph/Exchange Online) und OpenAI mit den jeweils vereinbarten Maßnahmen benannt.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">9. Datenportabilität und Anbieterwechsel</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Der Kunde kann jederzeit, spätestens 30 Tage nach Vertragsende, die Bereitstellung maschinenlesbarer Exporte verarbeiten lassen, die insbesondere Roh-E-Mails, Klassifizierungs-Labels, Wissensdatenbank-Snapshots sowie Konfigurations- und Nutzungsdaten umfassen können. EcomTask unterstützt den Wechsel durch kostenfreien Export, die Bereitstellung einer Übergabe-Schnittstelle (REST-API) für 14 Tage und die Dokumentation. Diese Leistungen werden spätestens binnen zehn Werktagen nach Eingang des Verlangens erbracht.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">10. KI-Transparenz und menschliche Aufsicht</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Der Kunde informiert seine Endnutzer nachvollziehbar darüber, dass Antworten ganz oder teilweise automatisiert generiert sein können. Antworten mit rechtlichem, sicherheitsrelevantem oder haftungsrechtlichem Gewicht müssen vor dem Versand durch eine sachkundige Person geprüft werden (human-in-the-loop). Änderungen an Modellen und Prompts werden zu Audit-Zwecken versioniert und nachvollziehbar dokumentiert.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">11. Betrieb, Sicherheit, Backup und Wiederherstellung</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Die Datenübertragung erfolgt mittels TLS 1.2+, die Speicherung ist mit AES-256 geschützt. EcomTask setzt SSO/OIDC, rollenbasierte Zugriffskontrolle (RBAC) mit MFA, WAF, Rate-Limiting, CSRF/XSS-Schutz, sowie Monitoring/SIEM ein. Backups werden täglich inkrementell und wöchentlich vollständig erstellt; die Wiederherstellungsziele betragen RTO ≤ 4 Stunden und RPO ≤ 24 Stunden; quartalsweise Restore-Tests sind etabliert.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">12. Pflichten des Kunden</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Der Kunde schützt ihm übermittelte Zugangsdaten vor dem Zugriff Unbefugter und nutzt die AI-Mitarbeiter Lösung nur im vereinbarten Umfang. Verdachtsfälle unberechtigter Nutzung sind EcomTask unverzüglich mitzuteilen. Der Kunde stellt während der Vertragslaufzeit eine funktionsfähige Microsoft-365-Instanz bereit und gewährt die notwendigen Graph-Berechtigungen.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">13. Gewährleistung und Haftung</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Es gelten die mietrechtlichen Gewährleistungsregeln (§§ 535 ff. BGB). Eine verschuldensunabhängige Haftung für bereits bei Vertragsschluss vorhandene Mängel (§ 536a Abs. 1 BGB) ist ausgeschlossen. Im Übrigen bleiben gesetzliche Ansprüche unberührt.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">14. Laufzeit, Kündigung und Löschung</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Der Vertrag läuft auf unbestimmte Zeit und kann mit zwei Wochen zum Monatsende schriftlich gekündigt werden; das Recht zur fristlosen Kündigung aus wichtigem Grund bleibt unberührt. Spätestens 30 Tage nach Vertragsende löscht EcomTask verbleibende Kundendaten unwiederherstellbar.
        </p>
      </section>

      <section className="mb-6 sm:mb-8">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">15. Sicherheitsvorfälle und Meldepflichten</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Sicherheitsvorfälle, die Verfügbarkeit, Integrität oder Vertraulichkeit wesentlich beeinträchtigen, meldet EcomTask unverzüglich, spätestens innerhalb von 24 Stunden an die zuständige Stelle; ein detaillierter technischer Bericht folgt innerhalb von 72 Stunden. Lessons Learned werden dokumentiert, und erforderliche TOMs werden angepasst. Diese Meldefristen gehen abweichenden SLA-Pflichten vor.
        </p>
      </section>

      <section className="mb-8 sm:mb-10">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">16. Änderungen dieser Nutzungsbedingungen</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Wesentliche Änderungen werden rechtzeitig vor Inkrafttreten mitgeteilt; Änderungen der AUP werden mindestens sechs Wochen vorher angekündigt.
        </p>
      </section>

      <section className="mb-8 sm:mb-10">
        <h2 className="mb-2 sm:mb-3 text-lg sm:text-xl font-semibold">17. Schlussbestimmungen</h2>
        <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
          Es gilt das im Hauptvertrag vereinbarte Recht und der dort festgelegte Gerichtsstand. Schriftformerfordernisse und die vertraglich vereinbarte Rangfolge bleiben unberührt.
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


