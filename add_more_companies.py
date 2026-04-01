#!/usr/bin/env python3
"""
Fügt weitere KMU zu der bestehenden CSV-Datei hinzu
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
        'yoursite.com', 'domain.de', 'example.de', 'sentry.io', 'google.com',
        'remove-this', 'kionkiongroupgroup'
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
            
            found_email = extract_email(page_text)
            found_phone = extract_phone(page_text)
            
            if found_email:
                email = found_email
            if found_phone:
                phone = found_phone
            
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
        
        if email and phone and target_url == url:
            break
    
    return email, phone

# Weitere KMU in Hessen
additional_companies = [
    {'name': 'Hess Natur Textilien GmbH & Co. KG', 'url': 'https://www.hessnatur.com', 'city': 'Butzbach'},
    {'name': 'Wella Operations Germany GmbH', 'url': 'https://www.wella.com', 'city': 'Darmstadt'},
    {'name': 'Röhm GmbH', 'url': 'https://www.roehm.com', 'city': 'Darmstadt'},
    {'name': 'Evonik Industries AG', 'url': 'https://www.evonik.com', 'city': 'Essen'},
    {'name': 'Schott AG', 'url': 'https://www.schott.com', 'city': 'Mainz'},
    {'name': 'K+S AG', 'url': 'https://www.k-plus-s.com', 'city': 'Kassel'},
    {'name': 'VW Nutzfahrzeuge', 'url': 'https://www.volkswagen-nutzfahrzeuge.de', 'city': 'Hannover'},
    {'name': 'Wintershall Dea', 'url': 'https://www.wintershalldea.com', 'city': 'Kassel'},
    {'name': 'Brenntag SE', 'url': 'https://www.brenntag.com', 'city': 'Mülheim'},
    {'name': 'Symrise AG', 'url': 'https://www.symrise.com', 'city': 'Holzminden'},
    {'name': 'KWS Saat SE', 'url': 'https://www.kws.com', 'city': 'Einbeck'},
    {'name': 'Nordzucker AG', 'url': 'https://www.nordzucker.com', 'city': 'Braunschweig'},
    {'name': 'Aurubis AG', 'url': 'https://www.aurubis.com', 'city': 'Hamburg'},
    {'name': 'GEA Group AG', 'url': 'https://www.gea.com', 'city': 'Düsseldorf'},
    {'name': 'Hugo Boss AG', 'url': 'https://www.hugoboss.com', 'city': 'Metzingen'},
]

def main():
    """Hauptfunktion"""
    print("=" * 70)
    print("Hinzufügen weiterer KMU zu der bestehenden CSV-Datei")
    print("=" * 70)
    
    # Lese bestehende CSV
    existing_companies = {}
    csv_filename = 'hessen_kmu_kontakte.csv'
    
    try:
        with open(csv_filename, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                existing_companies[row['Firmenname'].lower()] = row
    except FileNotFoundError:
        print(f"Datei {csv_filename} nicht gefunden. Erstelle neue Datei.")
    
    print(f"\nBestehende Unternehmen: {len(existing_companies)}")
    print(f"Neue Unternehmen: {len(additional_companies)}\n")
    
    results = list(existing_companies.values())
    
    for i, company in enumerate(additional_companies, 1):
        company_name = company['name']
        url = company.get('url', '')
        city = company.get('city', 'Hessen')
        
        # Überspringe, wenn bereits vorhanden
        if company_name.lower() in existing_companies:
            print(f"[{i:2d}/{len(additional_companies)}] {company_name[:55]:<55} ... ⏭ Übersprungen (bereits vorhanden)")
            continue
        
        print(f"[{i:2d}/{len(additional_companies)}] {company_name[:55]:<55}", end=' ... ')
        
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
        
        time.sleep(1.5)
    
    # Speichere aktualisierte CSV
    with open(csv_filename, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['Firmenname', 'Website', 'E-Mail', 'Telefon', 'Stadt', 'Region']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        
        writer.writeheader()
        for result in results:
            writer.writerow(result)
    
    print("\n" + "=" * 70)
    print("ZUSAMMENFASSUNG")
    print("=" * 70)
    print(f"✓ CSV-Datei aktualisiert: '{csv_filename}'")
    print(f"  {len(results)} Unternehmen gespeichert")
    print(f"  {sum(1 for r in results if r['E-Mail'])} mit E-Mail-Adresse")
    print(f"  {sum(1 for r in results if r['Telefon'])} mit Telefonnummer")
    print(f"  {sum(1 for r in results if r['E-Mail'] and r['Telefon'])} mit beiden Kontaktdaten")
    print("=" * 70)

if __name__ == '__main__':
    main()


