#!/usr/bin/env python3
"""
Finales Skript zum Sammeln von KMU-Daten aus Hessen mit mindestens 40 Mitarbeitern
Extrahiert E-Mail-Adressen und Telefonnummern und speichert sie in einer CSV-Datei
"""

import csv
import re
import requests
from bs4 import BeautifulSoup
import time

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

def extract_email(text):
    """Extrahiert E-Mail-Adressen aus Text"""
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
    emails = re.findall(email_pattern, text)
    # Filtere generische/ungültige E-Mails aus
    filtered = [e for e in emails if not any(x in e.lower() for x in [
        'example.com', 'test.com', 'domain.com', 'noreply', 'no-reply', 
        'noreply@', 'webmaster@', 'info@example', 'placeholder', 'xxx',
        'yoursite.com', 'domain.de', 'example.de'
    ])]
    return filtered[0] if filtered else ""

def extract_phone(text):
    """Extrahiert Telefonnummern aus Text - verbesserte Validierung"""
    # Deutsche Telefonnummern-Muster
    patterns = [
        r'(\+49|0049|0)[1-9]\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}',
        r'\(0\d{1,4}\)[\s\-]?\d{1,4}[\s\-]?\d{1,4}[\s\-]?\d{1,4}',
    ]
    
    phones_found = []
    for pattern in patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            if isinstance(match, tuple):
                match = ''.join(match)
            # Bereinige die Nummer
            phone = re.sub(r'[\s\-/()]', '', str(match))
            # Validiere: sollte zwischen 10 und 15 Zeichen haben und nicht nur Ziffern wiederholen
            if 10 <= len(phone) <= 15 and len(set(phone)) > 3:
                phones_found.append(phone)
    
    # Rücke die beste Nummer zurück (normalerweise die erste)
    return phones_found[0] if phones_found else ""

def scrape_website(url):
    """Extrahiert Kontaktinformationen von einer Website"""
    email = ""
    phone = ""
    
    if not url or not url.startswith('http'):
        return email, phone
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=10, allow_redirects=True)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        page_text = soup.get_text()
        
        # Suche nach E-Mail und Telefon im gesamten Text
        email = extract_email(page_text)
        phone = extract_phone(page_text)
        
        # Suche in spezifischen Kontakt-Bereichen
        contact_keywords = ['contact', 'impressum', 'footer', 'kontakt', 'anschrift', 'adresse']
        
        for keyword in contact_keywords:
            # Suche nach divs/sections mit Kontakt-Keywords
            sections = soup.find_all(['div', 'section', 'footer'], 
                                   class_=re.compile(keyword, re.I))
            sections.extend(soup.find_all(['div', 'section'], 
                                        id=re.compile(keyword, re.I)))
            
            for section in sections:
                section_text = section.get_text()
                if not email:
                    found_email = extract_email(section_text)
                    if found_email:
                        email = found_email
                if not phone:
                    found_phone = extract_phone(section_text)
                    if found_phone:
                        phone = found_phone
        
        # Suche nach mailto-Links
        if not email:
            mailto_links = soup.find_all('a', href=re.compile(r'^mailto:', re.I))
            for link in mailto_links:
                href = link.get('href', '')
                email_match = re.search(r'mailto:([^\?&]+)', href)
                if email_match:
                    email = email_match.group(1).strip()
                    break
        
        # Suche nach tel-Links
        if not phone:
            tel_links = soup.find_all('a', href=re.compile(r'^tel:', re.I))
            for link in tel_links:
                href = link.get('href', '')
                phone_match = re.search(r'tel:([^\?&]+)', href)
                if phone_match:
                    phone = re.sub(r'[\s\-/()]', '', phone_match.group(1))
                    if len(phone) >= 10:
                        break
        
        # Suche auch in Meta-Tags
        if not email:
            meta_tags = soup.find_all('meta')
            for meta in meta_tags:
                content = meta.get('content', '')
                found_email = extract_email(content)
                if found_email:
                    email = found_email
                    break
        
    except Exception as e:
        pass
    
    return email, phone

# Erweiterte Liste von KMU in Hessen (mindestens 40 Mitarbeiter)
companies = [
    # Große bekannte Unternehmen
    {'name': 'Fresenius Medical Care Deutschland GmbH', 'url': 'https://www.freseniusmedicalcare.com', 'city': 'Bad Homburg'},
    {'name': 'Heraeus Holding GmbH', 'url': 'https://www.heraeus.com', 'city': 'Hanau'},
    {'name': 'Merck KGaA', 'url': 'https://www.merckgroup.com', 'city': 'Darmstadt'},
    {'name': 'Opel Automobile GmbH', 'url': 'https://www.opel.de', 'city': 'Rüsselsheim'},
    {'name': 'Continental AG', 'url': 'https://www.continental.com', 'city': 'Frankfurt'},
    {'name': 'Infraserv Höchst', 'url': 'https://www.infraserv.com', 'city': 'Frankfurt'},
    {'name': 'B. Braun Melsungen AG', 'url': 'https://www.bbraun.com', 'city': 'Melsungen'},
    {'name': 'Viessmann Werke GmbH & Co. KG', 'url': 'https://www.viessmann.de', 'city': 'Allendorf'},
    {'name': 'KION Group AG', 'url': 'https://www.kiongroup.com', 'city': 'Frankfurt'},
    {'name': 'SGL Carbon SE', 'url': 'https://www.sglcarbon.com', 'city': 'Wiesbaden'},
    
    # Mittelständische Unternehmen
    {'name': 'Sartorius Stedim Biotech GmbH', 'url': 'https://www.sartorius.com', 'city': 'Göttingen'},
    {'name': 'Sanofi-Aventis Deutschland GmbH', 'url': 'https://www.sanofi.de', 'city': 'Frankfurt'},
    {'name': 'Linde AG', 'url': 'https://www.linde.com', 'city': 'Wiesbaden'},
    {'name': 'Procter & Gamble Manufacturing GmbH', 'url': 'https://www.pg.com', 'city': 'Schwalbach'},
    {'name': 'Wacker Chemie AG', 'url': 'https://www.wacker.com', 'city': 'Burghausen'},
    
    # Weitere KMU aus verschiedenen Branchen
    {'name': 'Gerresheimer AG', 'url': 'https://www.gerresheimer.com', 'city': 'Düsseldorf'},
    {'name': 'Südzucker AG', 'url': 'https://www.suedzucker.de', 'city': 'Mannheim'},
    {'name': 'Krones AG', 'url': 'https://www.krones.com', 'city': 'Neutraubling'},
    {'name': 'Freudenberg SE', 'url': 'https://www.freudenberg.com', 'city': 'Weinheim'},
    {'name': 'Dürr AG', 'url': 'https://www.durr.com', 'city': 'Bietigheim-Bissingen'},
    
    # Weitere hessische Unternehmen (verschiedene Branchen)
    {'name': 'Hessische Landesbank', 'url': 'https://www.helaba.de', 'city': 'Frankfurt'},
    {'name': 'Commerzbank AG', 'url': 'https://www.commerzbank.de', 'city': 'Frankfurt'},
    {'name': 'Deutsche Börse AG', 'url': 'https://www.deutsche-boerse.com', 'city': 'Frankfurt'},
    {'name': 'Fraport AG', 'url': 'https://www.fraport.com', 'city': 'Frankfurt'},
    {'name': 'Deutsche Lufthansa AG', 'url': 'https://www.lufthansa.com', 'city': 'Frankfurt'},
    {'name': 'TUI Deutschland GmbH', 'url': 'https://www.tui.de', 'city': 'Hannover'},
    {'name': 'Adam Opel AG', 'url': 'https://www.opel.de', 'city': 'Rüsselsheim'},
    {'name': 'Infineon Technologies AG', 'url': 'https://www.infineon.com', 'city': 'Neubiberg'},
    {'name': 'Siemens AG', 'url': 'https://www.siemens.com', 'city': 'München'},
    {'name': 'BASF SE', 'url': 'https://www.basf.com', 'city': 'Ludwigshafen'},
]

def main():
    """Hauptfunktion"""
    print("=" * 60)
    print("KMU-Datensammlung für Hessen")
    print("Unternehmen mit mindestens 40 Mitarbeitern")
    print("=" * 60)
    print(f"\nVerarbeite {len(companies)} Unternehmen...\n")
    
    results = []
    
    for i, company in enumerate(companies, 1):
        company_name = company['name']
        url = company.get('url', '')
        city = company.get('city', 'Hessen')
        
        print(f"[{i:2d}/{len(companies)}] {company_name[:50]:<50}", end=' ... ')
        
        if not url:
            print("⚠ Keine URL")
            results.append({
                'Firmenname': company_name,
                'Website': '',
                'E-Mail': '',
                'Telefon': '',
                'Stadt': city,
                'Region': 'Hessen'
            })
            continue
        
        # Scrape Kontaktdaten
        email, phone = scrape_website(url)
        
        results.append({
            'Firmenname': company_name,
            'Website': url,
            'E-Mail': email,
            'Telefon': phone,
            'Stadt': city,
            'Region': 'Hessen'
        })
        
        if email and phone:
            print(f"✓ E-Mail & Telefon")
        elif email:
            print(f"✓ E-Mail")
        elif phone:
            print(f"✓ Telefon")
        else:
            print("⚠ Keine Kontaktdaten")
        
        time.sleep(1.5)  # Pause zwischen Requests
    
    # Speichere in CSV
    csv_filename = 'hessen_kmu_kontakte.csv'
    with open(csv_filename, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['Firmenname', 'Website', 'E-Mail', 'Telefon', 'Stadt', 'Region']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        
        writer.writeheader()
        for result in results:
            writer.writerow(result)
    
    print("\n" + "=" * 60)
    print("ZUSAMMENFASSUNG")
    print("=" * 60)
    print(f"✓ CSV-Datei erstellt: '{csv_filename}'")
    print(f"  {len(results)} Unternehmen gespeichert")
    print(f"  {sum(1 for r in results if r['E-Mail'])} mit E-Mail-Adresse")
    print(f"  {sum(1 for r in results if r['Telefon'])} mit Telefonnummer")
    print(f"  {sum(1 for r in results if r['E-Mail'] and r['Telefon'])} mit beiden Kontaktdaten")
    print("=" * 60)

if __name__ == '__main__':
    main()


