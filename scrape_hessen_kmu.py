#!/usr/bin/env python3
"""
Skript zum Sammeln von KMU-Daten aus Hessen mit mindestens 40 Mitarbeitern
Extrahiert E-Mail-Adressen und Telefonnummern und speichert sie in einer CSV-Datei
"""

import csv
import re
import requests
from bs4 import BeautifulSoup
import time
from urllib.parse import quote_plus
import json

# User-Agent für Web-Requests
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

def extract_email(text):
    """Extrahiert E-Mail-Adressen aus Text"""
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
    emails = re.findall(email_pattern, text)
    # Filtere generische E-Mails aus
    filtered = [e for e in emails if not any(x in e.lower() for x in ['example.com', 'test.com', 'domain.com', 'noreply'])]
    return filtered[0] if filtered else ""

def extract_phone(text):
    """Extrahiert Telefonnummern aus Text"""
    # Deutsche Telefonnummern-Muster
    patterns = [
        r'(\+49|0)[1-9]\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}[\s\-/]?\d{1,4}',
        r'\(0\d{1,4}\)[\s\-]?\d{1,4}[\s\-]?\d{1,4}[\s\-]?\d{1,4}',
        r'\d{3,4}[\s\-/]?\d{6,8}',
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, text)
        if matches:
            # Bereinige die Nummer
            phone = re.sub(r'[\s\-/]', '', str(matches[0]))
            if len(phone) >= 10:
                return phone
    
    return ""

def search_google_companies(query, max_results=10):
    """Sucht nach Unternehmen über Google"""
    companies = []
    
    try:
        # Google-Suche URL
        search_url = f"https://www.google.com/search?q={quote_plus(query)}&num={max_results}"
        
        response = requests.get(search_url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Verschiedene Selektoren für Google-Suchergebnisse
        results = soup.find_all('div', class_='g')[:max_results]
        if not results:
            # Alternative Selektoren
            results = soup.find_all('div', {'data-ved': True})[:max_results]
        
        for result in results:
            try:
                # Extrahiere Firmenname
                title_elem = result.find('h3') or result.find('h2')
                if not title_elem:
                    continue
                
                company_name = title_elem.get_text().strip()
                if not company_name or len(company_name) < 3:
                    continue
                
                # Extrahiere URL
                link_elem = result.find('a', href=True)
                company_url = link_elem.get('href', '') if link_elem else ''
                
                # Bereinige URL (entferne Google-Redirect)
                if company_url.startswith('/url?q='):
                    company_url = company_url.split('/url?q=')[1].split('&')[0]
                
                # Extrahiere Beschreibung
                desc_elem = result.find('span', class_='aCOpRe') or result.find('div', class_='VwiC3b') or result.find('span', class_='st')
                description = desc_elem.get_text() if desc_elem else ''
                
                companies.append({
                    'name': company_name,
                    'url': company_url,
                    'description': description
                })
                
            except Exception as e:
                continue
                
    except Exception as e:
        print(f"Fehler bei Google-Suche: {e}")
    
    return companies

def scrape_company_contact_info(url):
    """Extrahiert Kontaktinformationen von einer Unternehmens-Website"""
    email = ""
    phone = ""
    
    if not url or not url.startswith('http'):
        return email, phone
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        page_text = soup.get_text()
        
        # Suche nach E-Mail und Telefon
        email = extract_email(page_text)
        phone = extract_phone(page_text)
        
        # Suche auch in spezifischen Bereichen
        contact_sections = soup.find_all(['div', 'section'], class_=re.compile(r'contact|impressum|footer', re.I))
        for section in contact_sections:
            section_text = section.get_text()
            if not email:
                email = extract_email(section_text)
            if not phone:
                phone = extract_phone(section_text)
        
    except Exception as e:
        print(f"Fehler beim Scraping von {url}: {e}")
    
    return email, phone

def main():
    """Hauptfunktion"""
    print("Starte Suche nach KMU in Hessen...")
    
    # Verschiedene Suchanfragen
    search_queries = [
        "KMU Hessen 40-250 Mitarbeiter",
        "Mittelständische Unternehmen Hessen",
        "Unternehmen Hessen 50 Mitarbeiter",
        "Firmenverzeichnis Hessen KMU",
        "Industrieunternehmen Hessen 40 Mitarbeiter",
    ]
    
    all_companies = []
    seen_companies = set()
    
    for query in search_queries:
        print(f"\nSuche: {query}")
        companies = search_google_companies(query, max_results=10)
        
        for company in companies:
            # Vermeide Duplikate
            if company['name'].lower() in seen_companies:
                continue
            
            seen_companies.add(company['name'].lower())
            all_companies.append(company)
            print(f"  Gefunden: {company['name']}")
        
        time.sleep(2)  # Pause zwischen Anfragen
    
    print(f"\nInsgesamt {len(all_companies)} Unternehmen gefunden.")
    print("Extrahiere Kontaktinformationen...")
    
    # Extrahiere Kontaktinformationen
    results = []
    for i, company in enumerate(all_companies, 1):
        print(f"[{i}/{len(all_companies)}] Verarbeite {company['name']}...")
        
        email, phone = scrape_company_contact_info(company['url'])
        
        results.append({
            'Firmenname': company['name'],
            'Website': company['url'],
            'E-Mail': email,
            'Telefon': phone,
            'Beschreibung': company['description'][:200]  # Begrenze auf 200 Zeichen
        })
        
        time.sleep(1)  # Pause zwischen Requests
    
    # Speichere in CSV
    csv_filename = 'hessen_kmu_kontakte.csv'
    with open(csv_filename, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['Firmenname', 'Website', 'E-Mail', 'Telefon', 'Beschreibung']
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

