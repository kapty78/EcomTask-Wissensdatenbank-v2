Tools=[
    {
        "type": "function",
        "function": {
            "name": "getSites",
            "description": "Zeigt die verfügbaren Standorte mit Informationen wie 'siteCd', 'Adresse', 'Telefonnummer', 'Öffnungszeiten' usw.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "getProducts",
            "description": "Listet alle verfügbaren Dienstleistungen eines Salons auf mit jeweiligem Namen 'onlineNm', Beschreibung 'onlineHint' und Dauer 'durationTime'",
            "parameters": {
                "type": "object",
                "properties": {
                    "siteCd": {
                        "type": "string",
                        "description": "Der 'siteCd' des jeweiligen Salons aus *getSites*"
                    }
                },
                "required": ["siteCd"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "getEmployees",
            "description": "Hier bekommst du eine Liste der verfügbaren Mitarbeiter für eine, oder mehrere Dienstleistungen in einem bestimmten Zeitraum. Erforderliche Parameter sind 'siteCd', 'week' und 'items'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "siteCd": {
                        "type": "string",
                        "description": "Der 'siteCd' des jeweiligen Salons aus *getSites*"
                    },
                    "week": {
                        "type": "integer",
                        "description": "Die gewünschte Woche (0 = die aktuelle Woche, 1 = die folgende Woche, 2 = die übernächste Woche, usw.)."
                    },
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "description": "Ein Array mit den 'itemNo'-Werten aus *getProducts* (z. B. [\"14\"])."
                    }
                },
                "required": ["siteCd", "week", "items"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "AppointmentSuggestion",
            "description": "Zeigt freie Termin-Slots in einer bestimmten Woche für eine oder mehrere Dienstleistungen an. In 'positions' kannst du für jeden Service den 'itemNo' angeben und optional den 'employeeId', falls ein bestimmter Mitarbeiter gewünscht wird. Optional kann mit 'dateSearchString' nach einem bestimmten Datum oder Datumsteil im 'beginTs' der Vorschläge gefiltert werden (z.B. '21T' oder '2025-05-21').",
            "parameters": {
                "type": "object",
                "properties": {
                    "siteCd": {
                        "type": "string",
                        "description": "Der 'siteCd' des jeweiligen Salons aus *getSites*"
                    },
                    "week": {
                        "type": "integer",
                        "description": "PFLICHTPARAMETER: Bestimmt die Kalenderwoche für die Terminsuche (0 = aktuelle Woche, 1 = nächste Woche, 2 = übernächste Woche, usw.). WICHTIG: Dieser Parameter muss immer korrekt zur Kalenderwoche des gewünschten Datums im 'dateSearchString' passen. Beispiel: Wenn der Kunde einen Termin am 21. Januar möchte und dieser Tag in der nächsten Woche liegt, dann muss 'week': 1 gesetzt werden."
                    },
                    "positions": {
                        "type": "array",
                        "description": "Ein Array von Objekten, in denen für jeden Service der 'itemNo' (Pflicht) und optional der 'employeeId' angegeben wird.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "itemNo": {
                                    "type": "integer",
                                    "description": "Die 'itemNo' der gewünschten Dienstleistung aus *getProducts*."
                                },
                                "employeeId": {
                                    "type": "integer",
                                    "description": "Optional: Die 'employeeId' des gewünschten Mitarbeiters aus *getEmployees*."
                                }
                            },
                            "required": ["itemNo"]
                        }
                    },
                    "dateSearchString": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "description": "PFLICHTPARAMETER: Array von Tages-Filtern im Format [\"TTT\"] (z.B. [\"21T\"] für den 21. Tag des Monats). KRITISCH: Die hier angegebenen Tage müssen in der durch 'week' definierten Kalenderwoche liegen! Beispiel: Für einen Termin am 21. Januar - wenn dieser Tag in Woche 1 liegt, dann 'week': 1 UND 'dateSearchString': [\"21T\"]. Falsche Kombination führt zu leeren Ergebnissen. Bei mehreren gewünschten Tagen: [\"21T\", \"22T\", \"23T\"]."
                    }
                },
                "required": ["siteCd", "week", "positions", "dateSearchString"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "bookAppointment",
            "description": "Bucht einen Termin oder mehrere Termine in einem Rutsch und nutzt dafür exakt die Positionen des ausgewählen *AppointmentSuggestion*.",
            "parameters": {
                "type": "object",
                "properties": {
                    "siteCd": {
                        "type": "string",
                        "description": "Der 'siteCd' des jeweiligen Salons aus *getSites*"
                    },
                    "positions": {
                        "type": "array",
                        "description": "Ein Array der Buchungspositionen aus *AppointmentSuggestion*. Jede Position entspricht einer Dienstleistung und enthält die folgenden Felder:",
                        "items": {
                            "type": "object",
                            "properties": {
                                "ordinalPosition": {
                                    "type": "integer",
                                    "description": "Die Reihenfolge der Dienstleistung im Termin (z. B. 1 für den ersten Service, 2 für den zweiten Service, etc.)."
                                },
                                "beginTs": {
                                    "type": "string",
                                    "description": "Startzeit (UTC) im ISO-8601-Format, z. B. YYYY-MM-DDTHH:MM:SS.000Z."
                                },
                                "durationMillis": {
                                    "type": "integer",
                                    "description": "Dauer der Dienstleistung in Millisekunden (z. B. 2700000 für 45 Minuten)."
                                },
                                "employeeId": {
                                    "type": "integer",
                                    "description": "'employeeId' aus *AppointmentSuggestion*. Darf niemals null, oder leer sein."
                                },
                                "itemNo": {
                                    "type": "integer",
                                    "description": "'itemNo' aus *getProducts*."
                                },
                                "itemNm": {
                                    "type": "string",
                                    "description": "Name der Dienstleistung (z. B. 'Waschen, Schneiden, Styling')."
                                }
                            },
                            "required": ["ordinalPosition", "beginTs", "durationMillis", "employeeId", "itemNo", "itemNm"]
                        }
                    }
                },
                "required": ["siteCd", "positions"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cancelAppointment",
            "description": "Storniert einen bestehenden Termin mithilfe der 'orderId' aus *getOrders*.",
            "parameters": {
                "type": "object",
                "properties": {
                    "orderId": {
                        "type": "integer",
                        "description": "Die 'orderId' des zu stornierenden Termins aus *getOrders*."
                    },
                    "siteCd": {
                        "type": "string",
                        "description": "Der 'siteCd' des jeweiligen Salons aus *getSites*"
                    }
                },
                "required": ["siteCd", "orderId"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "getProfile",
            "description": "Ruft das Profil des aktuellen Nutzers ab. Liefert 'Vorname', 'Nachname', 'Geschlecht', 'Email' und weitere Infos.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "getOrders",
            "description": "Holt sich eine Liste von offenen Orders des Users inklusive der 'orderId'",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "store_profile",
            "description": "Erstellt ein neues Nutzerprofil bei der ersten Anmeldung. Nur für Neukunden verwenden - für Updates bestehender Profile die spezifischen update-Funktionen nutzen.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fullNm": {
                        "type": "string",
                        "description": "Vollständiger Name des Nutzers (Pflichtfeld). Beispiel: 'Max Mustermann'."
                    },
                    "lastNm": {
                        "type": "string",
                        "description": "Nachname des Nutzers (Optional)."
                    },
                    "firstNm": {
                        "type": "string",
                        "description": "Vorname des Nutzers (Optional)."
                    },
                    "salutationCd": {
                        "type": "string",
                        "enum": ["na", "male", "female", "diverse"],
                        "description": "Anrede/Geschlecht: 'na' (keine Angabe), 'male' (männlich), 'female' (weiblich), 'diverse' (divers). Standard: 'na'."
                    },
                    "email": {
                        "type": "string",
                        "description": "E-Mail-Adresse des Nutzers (Optional)."
                    },
                    "newContact": {
                        "type": "boolean",
                        "description": "Kennzeichnet einen Neukunden. Standard: false."
                    },
                    "dplAccepted": {
                        "type": "boolean",
                        "description": "DSGVO-Zustimmung: true = Zustimmung erteilt, false = keine Zustimmung. Standard: false."
                    },
                    "marketingAccepted": {
                        "type": "boolean",
                        "description": "Marketing-Zustimmung: true = Zustimmung erteilt, false = keine Zustimmung. Standard: false."
                    }
                },
                "required": ["fullNm"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "updateProfileName",
            "description": "Aktualisiert nur den Namen im bestehenden Profil des Nutzers. Ermöglicht granulare Updates ohne komplette Profil-Neuerstellung.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fullNm": {
                        "type": "string",
                        "description": "Vollständiger Name des Nutzers (Pflichtfeld). Beispiel: 'Max Mustermann'."
                    },
                    "lastNm": {
                        "type": "string",
                        "description": "Nachname des Nutzers (Optional)."
                    },
                    "firstNm": {
                        "type": "string",
                        "description": "Vorname des Nutzers (Optional)."
                    }
                },
                "required": ["fullNm"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "updateProfileEmail",
            "description": "Aktualisiert nur die E-Mail-Adresse im bestehenden Profil des Nutzers. Ermöglicht granulare Updates ohne komplette Profil-Neuerstellung.",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {
                        "type": "string",
                        "description": "E-Mail-Adresse des Nutzers."
                    }
                },
                "required": ["email"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "updateProfileSalutation",
            "description": "Aktualisiert nur die Anrede/das Geschlecht im bestehenden Profil des Nutzers. Ermöglicht granulare Updates ohne komplette Profil-Neuerstellung.",
            "parameters": {
                "type": "object",
                "properties": {
                    "salutationCd": {
                        "type": "string",
                        "enum": ["na", "male", "female", "diverse"],
                        "description": "Anrede/Geschlecht des Nutzers: 'na' (keine Angabe), 'male' (männlich), 'female' (weiblich), 'diverse' (divers)."
                    }
                },
                "required": ["salutationCd"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "updateDataProtection",
            "description": "Aktualisiert nur die DSGVO-Zustimmung im bestehenden Profil des Nutzers. Ermöglicht nachträgliche DSGVO-Zustimmung ohne komplette Profil-Neuerstellung.",
            "parameters": {
                "type": "object",
                "properties": {
                    "dplAccepted": {
                        "type": "boolean",
                        "description": "DSGVO-Zustimmung: true = Zustimmung erteilt, false = keine Zustimmung."
                    }
                },
                "required": ["dplAccepted"]
            }
        }
    }
]
