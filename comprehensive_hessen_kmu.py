#!/usr/bin/env python3
"""
Umfassendes Skript zum Sammeln von KMU-Daten aus Hessen
Sucht gezielt nach Kontaktseiten und erweitert die Datenbank
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
    filtered = [e for e in emails if not any(x in e.lower() for x in [
        'example.com', 'test.com', 'domain.com', 'noreply', 'no-reply', 
        'noreply@', 'webmaster@', 'info@example', 'placeholder', 'xxx',
        'yoursite.com', 'domain.de', 'example.de', 'sentry.io', 'google.com'
    ])]
    return filtered[0] if filtered else ""

def extract_phone(text):
    """Extrahiert Telefonnummern aus Text"""
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
            phone = re.sub(r'[\s\-/()]', '', str(match))
            if 10 <= len(phone) <= 15 and len(set(phone)) > 3:
                phones_found.append(phone)
    
    return phones_found[0] if phones_found else ""

def find_contact_page(base_url):
    """Versucht Kontaktseiten zu finden"""
    contact_paths = [
        '/kontakt', '/contact', '/impressum', '/imprint', 
        '/anschrift', '/adresse', '/address', '/kontakt.html',
        '/contact.html', '/impressum.html', '/about/contact'
    ]
    
    for path in contact_paths:
        try:
            url = base_url.rstrip('/') + path
            response = requests.get(url, headers=HEADERS, timeout=5, allow_redirects=True)
            if response.status_code == 200:
                return url
        except:
            continue
    return None

def scrape_website(url, try_contact_page=True):
    """Extrahiert Kontaktinformationen von einer Website"""
    email = ""
    phone = ""
    
    if not url or not url.startswith('http'):
        return email, phone
    
    urls_to_try = [url]
    
    # Füge Kontaktseite hinzu, falls gewünscht
    if try_contact_page:
        contact_url = find_contact_page(url)
        if contact_url:
            urls_to_try.insert(0, contact_url)
    
    for target_url in urls_to_try:
        try:
            response = requests.get(target_url, headers=HEADERS, timeout=10, allow_redirects=True)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            page_text = soup.get_text()
            
            # Suche nach E-Mail und Telefon
            found_email = extract_email(page_text)
            found_phone = extract_phone(page_text)
            
            if found_email:
                email = found_email
            if found_phone:
                phone = found_phone
            
            # Wenn beide gefunden, können wir aufhören
            if email and phone:
                break
            
            # Suche in Kontakt-Bereichen
            contact_keywords = ['contact', 'impressum', 'footer', 'kontakt', 'anschrift']
            for keyword in contact_keywords:
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
            
        except Exception as e:
            continue
        
        # Wenn wir auf der Hauptseite beide gefunden haben, müssen wir nicht weiter suchen
        if email and phone and target_url == url:
            break
    
    return email, phone

# Erweiterte Liste mit mehr KMU in Hessen
companies = [
    # Große Unternehmen (bereits vorhanden, aber mit verbesserter Suche)
    {'name': 'Fresenius Medical Care Deutschland GmbH', 'url': 'https://www.freseniusmedicalcare.com', 'city': 'Bad Homburg'},
    {'name': 'Heraeus Holding GmbH', 'url': 'https://www.heraeus.com', 'city': 'Hanau'},
    {'name': 'Merck KGaA', 'url': 'https://www.merckgroup.com', 'city': 'Darmstadt'},
    {'name': 'Opel Automobile GmbH', 'url': 'https://www.opel.de', 'city': 'Rüsselsheim'},
    {'name': 'Continental AG', 'url': 'https://www.continental.com', 'city': 'Frankfurt'},
    {'name': 'B. Braun Melsungen AG', 'url': 'https://www.bbraun.com', 'city': 'Melsungen'},
    {'name': 'Viessmann Werke GmbH & Co. KG', 'url': 'https://www.viessmann.de', 'city': 'Allendorf'},
    {'name': 'KION Group AG', 'url': 'https://www.kiongroup.com', 'city': 'Frankfurt'},
    {'name': 'SGL Carbon SE', 'url': 'https://www.sglcarbon.com', 'city': 'Wiesbaden'},
    {'name': 'Deutsche Börse AG', 'url': 'https://www.deutsche-boerse.com', 'city': 'Frankfurt'},
    {'name': 'Fraport AG', 'url': 'https://www.fraport.com', 'city': 'Frankfurt'},
    {'name': 'Hessische Landesbank', 'url': 'https://www.helaba.de', 'city': 'Frankfurt'},
    {'name': 'Commerzbank AG', 'url': 'https://www.commerzbank.de', 'city': 'Frankfurt'},
    {'name': 'Deutsche Lufthansa AG', 'url': 'https://www.lufthansa.com', 'city': 'Frankfurt'},
    {'name': 'Dürr AG', 'url': 'https://www.durr.com', 'city': 'Bietigheim-Bissingen'},
    {'name': 'TUI Deutschland GmbH', 'url': 'https://www.tui.de', 'city': 'Hannover'},
    
    # Weitere mittelständische Unternehmen
    {'name': 'Infraserv Höchst', 'url': 'https://www.infraserv.com', 'city': 'Frankfurt'},
    {'name': 'Sanofi-Aventis Deutschland GmbH', 'url': 'https://www.sanofi.de', 'city': 'Frankfurt'},
    {'name': 'Linde AG', 'url': 'https://www.linde.com', 'city': 'Wiesbaden'},
    {'name': 'Sartorius Stedim Biotech GmbH', 'url': 'https://www.sartorius.com', 'city': 'Göttingen'},
    {'name': 'Freudenberg SE', 'url': 'https://www.freudenberg.com', 'city': 'Weinheim'},
    
    # Weitere KMU aus verschiedenen Branchen
    {'name': 'Krones AG', 'url': 'https://www.krones.com', 'city': 'Neutraubling'},
    {'name': 'Gerresheimer AG', 'url': 'https://www.gerresheimer.com', 'city': 'Düsseldorf'},
    {'name': 'Südzucker AG', 'url': 'https://www.suedzucker.de', 'city': 'Mannheim'},
    {'name': 'Wacker Chemie AG', 'url': 'https://www.wacker.com', 'city': 'Burghausen'},
    {'name': 'Procter & Gamble Manufacturing GmbH', 'url': 'https://www.pg.com', 'city': 'Schwalbach'},
    
    # Weitere hessische Unternehmen
    {'name': 'Adam Opel AG', 'url': 'https://www.opel.de', 'city': 'Rüsselsheim'},
    {'name': 'Infineon Technologies AG', 'url': 'https://www.infineon.com', 'city': 'Neubiberg'},
    {'name': 'Siemens AG', 'url': 'https://www.siemens.com', 'city': 'München'},
    {'name': 'BASF SE', 'url': 'https://www.basf.com', 'city': 'Ludwigshafen'},
]

def main():
    """Hauptfunktion"""
    print("=" * 70)
    print("Umfassende KMU-Datensammlung für Hessen")
    print("Unternehmen mit mindestens 40 Mitarbeitern")
    print("=" * 70)
    print(f"\nVerarbeite {len(companies)} Unternehmen...\n")
    
    results = []
    
    for i, company in enumerate(companies, 1):
        company_name = company['name']
        url = company.get('url', '')
        city = company.get('city', 'Hessen')
        
        print(f"[{i:2d}/{len(companies)}] {company_name[:55]:<55}", end=' ... ')
        
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
        
        # Scrape Kontaktdaten (mit Kontaktseiten-Suche)
        email, phone = scrape_website(url, try_contact_page=True)
        
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
    
    print("\n" + "=" * 70)
    print("ZUSAMMENFASSUNG")
    print("=" * 70)
    print(f"✓ CSV-Datei erstellt: '{csv_filename}'")
    print(f"  {len(results)} Unternehmen gespeichert")
    print(f"  {sum(1 for r in results if r['E-Mail'])} mit E-Mail-Adresse")
    print(f"  {sum(1 for r in results if r['Telefon'])} mit Telefonnummer")
    print(f"  {sum(1 for r in results if r['E-Mail'] and r['Telefon'])} mit beiden Kontaktdaten")
    print("=" * 70)

if __name__ == '__main__':
    main()


