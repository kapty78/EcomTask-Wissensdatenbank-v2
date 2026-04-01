#!/usr/bin/env python3
"""
Extrahiert Unternehmen aus Browser-Snapshots und sammelt Kontaktdaten
"""

import csv
import re
import requests
from bs4 import BeautifulSoup
import time
import json

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

def extract_email(text):
    """Extrahiert E-Mail-Adressen aus Text"""
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
    emails = re.findall(email_pattern, text)
    filtered = [e for e in emails if not any(x in e.lower() for x in ['example.com', 'test.com', 'domain.com', 'noreply', 'no-reply', 'noreply@', 'webmaster@', 'info@example'])]
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
        pass
    
    return email, phone

# Unternehmen aus den Suchergebnissen (manuell extrahiert und erweitert)
companies_data = [
    # Aus Gelbe Seiten gefunden
    {'name': 'Arlan Bau GmbH', 'url': 'https://www.gelbeseiten.de', 'city': 'Wetzlar'},
    {'name': 'Bauunternehmung Schneider GmbH', 'url': 'https://www.gelbeseiten.de', 'city': 'Hatzfeld'},
    {'name': 'Autohaus Schneider GmbH', 'url': 'https://www.gelbeseiten.de', 'city': 'Hessen'},
    {'name': 'Zirotec GmbH', 'url': 'https://www.gelbeseiten.de', 'city': 'Neu-Isenburg'},
    {'name': 'Wilhelm Pauly GmbH & Co. KG', 'url': 'https://www.gelbeseiten.de', 'city': 'Bad Homburg'},
    {'name': 'Blohberger & Olma GmbH', 'url': 'https://www.gelbeseiten.de', 'city': 'Rüsselsheim'},
    
    # Bekannte größere KMU in Hessen
    {'name': 'Fresenius Medical Care Deutschland GmbH', 'url': 'https://www.freseniusmedicalcare.com', 'city': 'Bad Homburg'},
    {'name': 'Heraeus Holding GmbH', 'url': 'https://www.heraeus.com', 'city': 'Hanau'},
    {'name': 'Merck KGaA', 'url': 'https://www.merckgroup.com', 'city': 'Darmstadt'},
    {'name': 'Sartorius AG', 'url': 'https://www.sartorius.com', 'city': 'Göttingen'},
    {'name': 'Krones AG', 'url': 'https://www.krones.com', 'city': 'Neutraubling'},
    {'name': 'Procter & Gamble Manufacturing GmbH', 'url': 'https://www.pg.com', 'city': 'Schwalbach'},
    {'name': 'Opel Automobile GmbH', 'url': 'https://www.opel.de', 'city': 'Rüsselsheim'},
    {'name': 'Continental AG', 'url': 'https://www.continental.com', 'city': 'Frankfurt'},
    {'name': 'Infraserv Höchst', 'url': 'https://www.infraserv.com', 'city': 'Frankfurt'},
    {'name': 'Linde AG', 'url': 'https://www.linde.com', 'city': 'Wiesbaden'},
    {'name': 'Sanofi-Aventis Deutschland GmbH', 'url': 'https://www.sanofi.com', 'city': 'Frankfurt'},
    {'name': 'B. Braun Melsungen AG', 'url': 'https://www.bbraun.com', 'city': 'Melsungen'},
    {'name': 'Viessmann Werke GmbH & Co. KG', 'url': 'https://www.viessmann.de', 'city': 'Allendorf'},
    {'name': 'Wacker Chemie AG', 'url': 'https://www.wacker.com', 'city': 'Burghausen'},
    {'name': 'SGL Carbon SE', 'url': 'https://www.sglcarbon.com', 'city': 'Wiesbaden'},
    {'name': 'KION Group AG', 'url': 'https://www.kiongroup.com', 'city': 'Frankfurt'},
    {'name': 'Gerresheimer AG', 'url': 'https://www.gerresheimer.com', 'city': 'Düsseldorf'},
    {'name': 'Südzucker AG', 'url': 'https://www.suedzucker.de', 'city': 'Mannheim'},
]

def find_company_website(company_name, city=""):
    """Versucht die Website eines Unternehmens zu finden"""
    # Für Gelbe Seiten Unternehmen müssen wir die Website separat finden
    if 'gelbeseiten.de' in company_name.lower() or 'gelbeseiten' in str(company_name):
        return ""
    
    # Versuche Google-Suche nach Website
    try:
        search_query = f"{company_name} {city} website"
        search_url = f"https://www.google.com/search?q={search_query.replace(' ', '+')}"
        response = requests.get(search_url, headers=HEADERS, timeout=5)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Suche nach ersten Ergebnis-Link
        results = soup.find_all('div', class_='g')[:3]
        for result in results:
            link = result.find('a', href=True)
            if link:
                url = link.get('href', '')
                if url.startswith('/url?q='):
                    url = url.split('/url?q=')[1].split('&')[0]
                if url.startswith('http') and 'google.com' not in url:
                    return url
    except:
        pass
    
    return ""

def main():
    """Hauptfunktion"""
    print("Starte Datensammlung für KMU in Hessen...")
    print(f"Verarbeite {len(companies_data)} Unternehmen...\n")
    
    results = []
    
    for i, company in enumerate(companies_data, 1):
        company_name = company['name']
        url = company.get('url', '')
        city = company.get('city', 'Hessen')
        
        print(f"[{i}/{len(companies_data)}] {company_name}...")
        
        # Wenn URL Gelbe Seiten ist, versuche echte Website zu finden
        if 'gelbeseiten.de' in url:
            url = find_company_website(company_name, city)
            if not url:
                print(f"  ⚠ Keine Website gefunden")
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
        
        if email or phone:
            print(f"  ✓ E-Mail: {email if email else 'N/A'}, Telefon: {phone if phone else 'N/A'}")
        else:
            print(f"  ⚠ Keine Kontaktdaten gefunden")
        
        time.sleep(2)  # Pause zwischen Requests
    
    # Speichere in CSV
    csv_filename = 'hessen_kmu_kontakte.csv'
    with open(csv_filename, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['Firmenname', 'Website', 'E-Mail', 'Telefon', 'Stadt', 'Region']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        
        writer.writeheader()
        for result in results:
            writer.writerow(result)
    
    print(f"\n✓ Daten wurden in '{csv_filename}' gespeichert.")
    print(f"  {len(results)} Unternehmen gespeichert.")
    print(f"  {sum(1 for r in results if r['E-Mail'])} mit E-Mail-Adresse")
    print(f"  {sum(1 for r in results if r['Telefon'])} mit Telefonnummer")

if __name__ == '__main__':
    main()


