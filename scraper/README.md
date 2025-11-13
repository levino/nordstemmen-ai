# OParl Scraper für Nordstemmen

Lädt Dokumente vom Ratsinformationssystem der Gemeinde Nordstemmen via OParl-API.

## Scraping-Strategie

Der Scraper crawlt die **Paper** und **Meeting** Collections (nicht `/file`):

```
/body/1/paper → Drucksachen mit DS-Nummern
  ├─ Extrahiere: reference, paperType, consultation[], relatedPaper[]
  ├─ Download: mainFile
  └─ Download: auxiliaryFile[]

/body/1/meeting → Sitzungen mit Protokollen
  ├─ Extrahiere: name, date, organization[], agendaItem[]
  ├─ Download: invitation
  ├─ Download: resultsProtocol
  └─ Download: verbatimProtocol
```

**Warum nicht `/file` crawlen?**

⚠️ **Wichtig:** File-Objekte haben **keine Rückverweise** auf Paper oder Meeting. Von einem File kommt man nicht zurück zur Drucksache oder Sitzung. Deshalb ist ein File-first Ansatz nicht praktikabel - man verliert den Kontext (DS-Nummer, Sitzungsbezug, etc.).

## OParl Datenmodell

### Übersicht der Objekttypen

```
Body (Körperschaft)
│
├─ Paper (Drucksachen)
│  │  • Logische Dokumente: Beschlussvorlagen, Anträge, Anfragen
│  │  • Haben DS-Nummer (reference): "DS 46/2024"
│  │  • Metadaten: paperType, consultation[], relatedPaper[]
│  │
│  ├─ mainFile (File)
│  └─ auxiliaryFile[] (Files)
│
├─ Meeting (Sitzungen)
│  │  • Sitzungen von Rat, Ausschüssen, Ortsräten
│  │  • Metadaten: date, location, agendaItem[], participants[]
│  │
│  ├─ invitation (File) - Einladung/Bekanntmachung
│  ├─ resultsProtocol (File) - Niederschrift
│  ├─ verbatimProtocol (File) - Wörtliches Protokoll
│  └─ auxiliaryFile[] (Files) - Weitere Anlagen
│
└─ File (Dateien)
   • Physische PDF-Dateien
   • Keine Rückverweise auf Paper oder Meeting!
```

### Paper (Drucksache)

**Beispiel:** https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/paper/1-12345

```json
{
  "id": "https://nordstemmen.../body/1/paper/1-12345",
  "type": "https://schema.oparl.org/1.1/Paper",
  "reference": "DS 46/2024",
  "name": "Neugestaltung der Tarifstruktur/Eintrittsgelder Freizeitbad",
  "paperType": "Beschlussvorlage",
  "date": "2024-09-24",
  "mainFile": {
    "id": "https://nordstemmen.../body/1/file/1-39882",
    "name": "Beschlussvorlage (Neugestaltung...)",
    "accessUrl": "https://nordstemmen.../Beschlussvorlage_DS_46-2024_1._Ergaenzung.pdf"
  },
  "auxiliaryFile": [
    {
      "id": "https://nordstemmen.../body/1/file/1-39883",
      "name": "Anlage: Preisvergleich",
      "accessUrl": "https://nordstemmen.../Anlage_DS_46-2024.pdf"
    }
  ],
  "consultation": [
    {
      "id": "https://nordstemmen.../consultation/123",
      "meeting": "https://nordstemmen.../meeting/5083",
      "role": "Beschlussfassung"
    }
  ],
  "relatedPaper": [
    "https://nordstemmen.../paper/1-11111"
  ],
  "originatorPerson": [],
  "originatorOrganization": ["Verwaltung"]
}
```

**Wichtige Felder:**
- `reference`: DS-Nummer (eindeutige Kennung)
- `paperType`: Art der Drucksache
- `mainFile`: Hauptdokument
- `auxiliaryFile[]`: Anlagen
- `consultation[]`: Links zu Sitzungen, wo das Paper behandelt wurde
- `relatedPaper[]`: Verweise auf andere Drucksachen

### Meeting (Sitzung)

**Beispiel:** https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/meeting/5083

```json
{
  "id": "https://nordstemmen.../body/1/meeting/5083",
  "type": "https://schema.oparl.org/1.1/Meeting",
  "name": "Ortsrat Heyersum (5. Sitzung)",
  "meetingState": "durchgeführt",
  "cancelled": false,
  "start": "2022-11-10T19:00:00+01:00",
  "location": {
    "description": "Feuerwehrgerätehaus Heyersum"
  },
  "organization": [
    "https://nordstemmen.../organization/123"
  ],
  "invitation": {
    "id": "https://nordstemmen.../body/1/file/1-35058",
    "name": "Bekanntmachung (Ortsrat Heyersum)",
    "accessUrl": "https://nordstemmen.../Bekanntmachung_Ortsrat_Heyersum_10.11.2022.pdf"
  },
  "resultsProtocol": {
    "id": "https://nordstemmen.../body/1/file/1-35420",
    "name": "Öffentliche Niederschrift (Ortsrat Heyersum)",
    "accessUrl": "https://nordstemmen.../Niederschrift_Ortsrat_Heyersum_10.11.2022.pdf"
  },
  "verbatimProtocol": null,
  "agendaItem": [
    {
      "id": "https://nordstemmen.../agendaitem/456",
      "number": "3",
      "name": "DS 46/2024 - Schwimmbad Tarifstruktur",
      "consultation": "https://nordstemmen.../consultation/123",
      "result": "angenommen",
      "resolutionText": "Der Rat beschließt..."
    }
  ]
}
```

**Wichtige Felder:**
- `invitation`: Einladung/Bekanntmachung
- `resultsProtocol`: Niederschrift
- `verbatimProtocol`: Wörtliches Protokoll (optional)
- `agendaItem[]`: Tagesordnungspunkte mit Beschlüssen
- `organization[]`: Welches Gremium (Rat, Ausschuss, Ortsrat)

### File (Datei)

**Beispiel:** https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/file/1-39882

```json
{
  "id": "https://nordstemmen.../body/1/file/1-39882",
  "type": "https://schema.oparl.org/1.1/File",
  "name": "Beschlussvorlage (Neugestaltung der Tarifstruktur...)",
  "mimeType": "application/pdf",
  "date": "2024-09-24",
  "accessUrl": "https://nordstemmen.../Beschlussvorlage_DS_46-2024_1._Ergaenzung.pdf",
  "downloadUrl": "https://nordstemmen.../download/.../Beschlussvorlage_DS_46-2024_1._Ergaenzung.pdf"
}
```

## Datei-Organisation

Die Dokumente werden nach ihrer OParl-Struktur gruppiert:

```
documents/
├── papers/
│   ├── DS_78-2022/
│   │   ├── metadata.json
│   │   ├── mainFile.pdf
│   │   ├── Anlage_1.pdf
│   │   ├── Anlage_2.pdf
│   │   └── Anlage_3.pdf
│   └── DS_46-2024/
│       ├── metadata.json
│       └── mainFile.pdf
└── meetings/
    ├── 2024-09-24_Rat/
    │   ├── metadata.json
    │   ├── invitation.pdf
    │   ├── resultsProtocol.pdf
    │   └── agendaItem_3_Anlage.pdf
    └── 2022-11-10_Ortsrat_Heyersum/
        ├── metadata.json
        ├── invitation.pdf
        └── resultsProtocol.pdf
```

**Vorteile:**
- Logische Gruppierung (ein Paper/Meeting = ein Ordner)
- Metadaten lokal bei zugehörigen Files
- Übersichtliche Struktur nach OParl-Objekten
- Einfaches Löschen/Updaten (ganzer Ordner)

## Metadaten-Struktur

### Paper metadata.json

```json
{
  "type": "Paper",
  "oparl_paper_id": "https://nordstemmen.../body/1/paper/5189",
  "reference": "DS 78/2022",
  "name": "Bebauungsplan Nr. 0122...",
  "paper_type": "Beschlussvorlage",
  "date": "2022-08-30",
  "files": [
    {
      "file_id": "1-12345",
      "oparl_file_id": "https://nordstemmen.../body/1/file/1-12345",
      "role": "mainFile",
      "local_path": "mainFile.pdf",
      "access_url": "https://nordstemmen.../Beschlussvorlage_DS_78-2022.pdf"
    },
    {
      "file_id": "2-5687",
      "oparl_file_id": "https://nordstemmen.../body/1/file/2-5687",
      "role": "auxiliaryFile",
      "name": "Anlage 1",
      "local_path": "Anlage_1.pdf",
      "access_url": "https://nordstemmen.../Anlage_1_DS_78-2022.pdf"
    }
  ],
  "consultations": [
    {
      "oparl_consultation_id": "https://nordstemmen.../consultation/123",
      "meeting_id": "https://nordstemmen.../meeting/5083",
      "role": "Beschlussfassung"
    }
  ],
  "related_papers": [
    "https://nordstemmen.../paper/1-11111"
  ]
}
```

### Meeting metadata.json

```json
{
  "type": "Meeting",
  "oparl_meeting_id": "https://nordstemmen.../body/1/meeting/5083",
  "name": "Ortsrat Heyersum (5. Sitzung)",
  "date": "2022-11-10",
  "start": "2022-11-10T19:00:00+01:00",
  "location": "Feuerwehrgerätehaus Heyersum",
  "organization": [
    {
      "id": "https://nordstemmen.../organization/123",
      "name": "Ortsrat Heyersum"
    }
  ],
  "files": [
    {
      "file_id": "1-35058",
      "oparl_file_id": "https://nordstemmen.../body/1/file/1-35058",
      "role": "invitation",
      "local_path": "invitation.pdf",
      "access_url": "https://nordstemmen.../Bekanntmachung_Ortsrat_Heyersum.pdf"
    },
    {
      "file_id": "1-35420",
      "oparl_file_id": "https://nordstemmen.../body/1/file/1-35420",
      "role": "resultsProtocol",
      "local_path": "resultsProtocol.pdf",
      "access_url": "https://nordstemmen.../Niederschrift_Ortsrat_Heyersum.pdf"
    }
  ],
  "agenda_items": [
    {
      "oparl_agendaitem_id": "https://nordstemmen.../agendaitem/456",
      "number": "3",
      "name": "DS 46/2024 - Schwimmbad Tarifstruktur",
      "consultation": "https://nordstemmen.../consultation/123",
      "result": "angenommen",
      "auxiliary_files": [
        {
          "file_id": "1-99999",
          "oparl_file_id": "https://nordstemmen.../body/1/file/1-99999",
          "name": "Zusatzdokument TOP 3",
          "local_path": "agendaItem_3_Anlage.pdf",
          "access_url": "https://nordstemmen.../TOP_3_Anlage.pdf"
        }
      ]
    }
  ]
}
```

## MCP Suchergebnisse

Die Suchergebnisse hängen davon ab, welches File gefunden wurde:

### Paper mainFile

```json
{
  "type": "Paper",
  "reference": "DS 78/2022",
  "title": "Bebauungsplan Nr. 0122...",
  "oparl_paper": "https://nordstemmen.../paper/5189",
  "oparl_file": "https://nordstemmen.../file/1-12345",
  "pdf_url": "https://nordstemmen.../Beschlussvorlage_DS_78-2022.pdf",
  "date": "2022-08-30",
  "excerpt": "Der Rat beschließt..."
}
```

### Paper auxiliaryFile

```json
{
  "type": "Paper",
  "reference": "DS 78/2022",
  "title": "Bebauungsplan Nr. 0122...",
  "file_name": "Anlage 1",
  "oparl_paper": "https://nordstemmen.../paper/5189",
  "oparl_file": "https://nordstemmen.../file/2-5687",
  "pdf_url": "https://nordstemmen.../Anlage_1_DS_78-2022.pdf",
  "date": "2022-08-30",
  "excerpt": "Planzeichnung..."
}
```

**Wichtig:** Bei auxiliaryFile wird `file_name` angegeben, damit Claude weiß, welche Anlage es ist.

### Meeting invitation/resultsProtocol

```json
{
  "type": "Meeting",
  "meeting_name": "Ortsrat Heyersum (5. Sitzung)",
  "document_type": "Niederschrift",
  "oparl_meeting": "https://nordstemmen.../meeting/5083",
  "oparl_file": "https://nordstemmen.../file/1-35420",
  "pdf_url": "https://nordstemmen.../Niederschrift_Ortsrat_Heyersum.pdf",
  "date": "2022-11-10",
  "excerpt": "TOP 3: Der Ortsrat beschließt..."
}
```

### Meeting agendaItem auxiliaryFile

```json
{
  "type": "Meeting",
  "meeting_name": "Ortsrat Heyersum (5. Sitzung)",
  "document_type": "Zusatzdokument TOP 3",
  "oparl_meeting": "https://nordstemmen.../meeting/5083",
  "oparl_file": "https://nordstemmen.../file/1-99999",
  "pdf_url": "https://nordstemmen.../TOP_3_Anlage.pdf",
  "date": "2022-11-10",
  "excerpt": "..."
}
```

**Wichtig:** Die `oparl_file` ID ist essentiell! Claude kann damit:
- Im Paper-JSON: Identifizieren, ob es mainFile oder welches auxiliaryFile ist
- Im Meeting-JSON: Die Datei in `invitation`, `resultsProtocol` oder `agendaItem[].auxiliary_files[]` finden

## Implementierung

### Scraper
- Crawle `/paper` und `/meeting` Collections
- Extrahiere vollständige OParl-Metadaten (reference, consultation, relatedPaper, agendaItem)
- Speichere OParl-IDs und strukturierte Daten in metadata.json

### Embedding Generator
- Lese erweiterte Metadaten aus metadata.json
- Speichere vollständige Metadaten im Qdrant Payload:
  - Papers: `reference`, `paper_type`, `oparl_paper_id`, `consultations`, `related_papers`
  - Meetings: `meeting_name`, `organization`, `oparl_meeting_id`, `agenda_items`

### MCP Server
- Gebe OParl-Links in Suchergebnissen zurück
- Erweitere Tool-Beschreibung mit OParl-Erklärung:
  - Link zur OParl-Spezifikation (https://spec.oparl.org/1.1/)
  - Erklärung der wichtigsten Objekttypen (Paper, Meeting, File)
  - Hinweis, dass Claude OParl-Links selbstständig aufrufen kann

## OParl Ressourcen

- **OParl Spezifikation:** https://spec.oparl.org/1.1/
- **Nordstemmen OParl-API:** https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/
- **OParl-Website:** https://oparl.org

## Lizenz

MIT License - siehe [LICENSE](../LICENSE)
