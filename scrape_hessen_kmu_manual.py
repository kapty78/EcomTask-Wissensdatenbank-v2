#!/usr/bin/env python3
"""
Manuelles Skript zum Sammeln von KMU-Daten aus Hessen
Nutzt Browser-Integration und manuelle Datenextraktion
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
    filtered = [e for e in emails if not any(x in e.lower() for x in ['example.com', 'test.com', 'domain.com', 'noreply', 'no-reply', 'noreply@'])]
    return filtered[0] if filtered else ""

def extract_phone(text):
    """Extrahiert Telefonnummern aus Text"""
    patterns = [
        r'(\+49|0)[1-9]\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}',
        r'\(0\d{1,4}\)[\s\-]?\d{1,4}[\s\-]?\d{1,4}[\s\-]?\d{1,4}',
        r'\d{3,4}[\s\-/]?\d{6,8}',
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, text)
        if matches:
            phone = re.sub(r'[\s\-/]', '', str(matches[0]))
            if len(phone) >= 10:
                return phone
    return ""

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
        
        email = extract_email(page_text)
        phone = extract_phone(page_text)
        
        # Suche in Kontakt-Bereichen
        contact_selectors = [
            {'class': re.compile(r'contact', re.I)},
            {'class': re.compile(r'impressum', re.I)},
            {'class': re.compile(r'footer', re.I)},
            {'id': re.compile(r'contact', re.I)},
            {'id': re.compile(r'impressum', re.I)},
        ]
        
        for selector in contact_selectors:
            sections = soup.find_all(['div', 'section'], selector)
            for section in sections:
                section_text = section.get_text()
                if not email:
                    email = extract_email(section_text)
                if not phone:
                    phone = extract_phone(section_text)
        
        # Suche nach mailto-Links
        if not email:
            mailto_links = soup.find_all('a', href=re.compile(r'^mailto:', re.I))
            for link in mailto_links:
                href = link.get('href', '')
                email_match = re.search(r'mailto:([^\?]+)', href)
                if email_match:
                    email = email_match.group(1)
                    break
        
        # Suche nach tel-Links
        if not phone:
            tel_links = soup.find_all('a', href=re.compile(r'^tel:', re.I))
            for link in tel_links:
                href = link.get('href', '')
                phone_match = re.search(r'tel:([^\?]+)', href)
                if phone_match:
                    phone = re.sub(r'[\s\-/]', '', phone_match.group(1))
                    break
        
    except Exception as e:
        print(f"  Fehler beim Scraping von {url}: {e}")
    
    return email, phone

# Bekannte KMU in Hessen (Beispiele - werden durch Suche ergänzt)
known_companies = [
    {
        'name': 'Fresenius Medical Care',
        'url': 'https://www.freseniusmedicalcare.com',
        'region': 'Hessen',
        'employees': '>40'
    },
    {
        'name': 'Heraeus',
        'url': 'https://www.heraeus.com',
        'region': 'Hessen',
        'employees': '>40'
    },
    {
        'name': 'Merck KGaA',
        'url': 'https://www.merckgroup.com',
        'region': 'Hessen',
        'employees': '>40'
    },
]

def main():
    """Hauptfunktion - sammelt Daten von bekannten Unternehmen"""
    print("Starte Datensammlung für KMU in Hessen...")
    print("Hinweis: Dieses Skript nutzt manuelle Suche und bekannte Unternehmen.")
    print("Für vollständige Ergebnisse sollten Sie die Browser-Integration nutzen.\n")
    
    results = []
    
    # Verarbeite bekannte Unternehmen
    print(f"Verarbeite {len(known_companies)} bekannte Unternehmen...")
    for i, company in enumerate(known_companies, 1):
        print(f"[{i}/{len(known_companies)}] {company['name']}...")
        email, phone = scrape_website(company['url'])
        results.append({
            'Firmenname': company['name'],
            'Website': company['url'],
            'E-Mail': email,
            'Telefon': phone,
            'Region': company.get('region', 'Hessen'),
            'Mitarbeiter': company.get('employees', '')
        })
        time.sleep(2)
    
    # Speichere in CSV
    csv_filename = 'hessen_kmu_kontakte.csv'
    with open(csv_filename, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['Firmenname', 'Website', 'E-Mail', 'Telefon', 'Region', 'Mitarbeiter']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        
        writer.writeheader()
        for result in results:
            writer.writerow(result)
    
    print(f"\n✓ Daten wurden in '{csv_filename}' gespeichert.")
    print(f"  {len(results)} Unternehmen gespeichert.")
    print(f"  {sum(1 for r in results if r['E-Mail'])} mit E-Mail-Adresse")
    print(f"  {sum(1 for r in results if r['Telefon'])} mit Telefonnummer")
    print("\nHinweis: Für mehr Unternehmen nutzen Sie bitte die Browser-Integration")
    print("oder fügen Sie weitere Unternehmen zur Liste hinzu.")

if __name__ == '__main__':
    main()


