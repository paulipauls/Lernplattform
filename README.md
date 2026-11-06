# Lernplattform

Eine Webseite zum Lernen und Üben für Schülerinnen und Schüler.

- Jede Schülerin und jeder Schüler meldet sich mit einem eigenen Code an und ist damit einer Klasse zugeordnet.
- Lehrkräfte stellen jeder Klasse Aufgabenblätter, getrennt nach **Erarbeitungsaufgaben** und **Lernaufgaben**.
- Aufgaben entstehen aus einem hochgeladenen **PDF- oder Word-Dokument**: Multiple Choice, Richtig/Falsch, Zuordnung, Texteingabe, Lückentext, Reihenfolge, Freitext und Infotexte.
- Aufgaben sind nur in einem festgelegten **Zeitraum** sichtbar. In dieser Zeit gibt es keine Rückmeldung. Danach sehen die Lernenden ihre Ergebnisse mit Lösungen, über alle Zeiträume hinweg.
- Pro Aufgabenblatt lässt sich erfassen, **wie oft und wie lange die Seite verlassen** wurde (z. B. Wechsel in einen anderen Tab). Es werden nur Anzahl und Dauer gespeichert; die Lernenden sehen einen Hinweis.
- Die Lehrkraft sieht jederzeit, wer welche Aufgabe in welchem Umfang bearbeitet hat, und für jede Person die Gesamtprozentzahl richtiger Antworten.

## So funktioniert es

| Teil | Wo | Aufgabe |
|---|---|---|
| `index.html`, `config.js` | GitHub Pages | Die Webseite, die alle öffnen |
| `apps-script/Code.gs` | Google Apps Script in deiner Google Tabelle | Speichert Klassen, Codes, Aufgaben und Antworten |

GitHub zeigt nur die Webseite an. **Alle Daten liegen in deiner Google Tabelle**, nicht auf GitHub. Der Code in diesem Repository enthält keine Namen, Codes oder Passwörter.

## Einrichtung in Kürze

Die ausführliche Anleitung mit allen Klicks steht in [`anleitung/Anleitung_Einrichtung.docx`](anleitung/Anleitung_Einrichtung.docx).

1. **Google Tabelle anlegen:** `sheets.new` öffnen → *Erweiterungen → Apps Script* → Inhalt von `apps-script/Code.gs` einfügen → speichern.
2. **Einrichten:** Funktion `einrichten` auswählen → *Ausführen* → Berechtigungen erlauben.
3. **Als Web-App bereitstellen:** *Bereitstellen → Neue Bereitstellung → Web-App*, *Ausführen als: Ich*, *Zugriff: Jeder* → Web-App-URL kopieren.
4. **Adresse eintragen:** In diesem Repository `config.js` öffnen → Stift-Symbol → die URL zwischen die Anführungszeichen setzen → *Commit changes*.
5. **GitHub Pages einschalten:** *Settings → Pages → Source: Deploy from a branch → Branch: main, Ordner: / (root) → Save*. Nach ein bis zwei Minuten ist die Seite unter `https://DEINNAME.github.io/REPOSITORYNAME/` erreichbar.
6. Seite öffnen → *Ich bin Lehrkraft* → Passwort festlegen → Klassen anlegen.

Ist in `config.js` keine Adresse eingetragen, läuft die Seite als **Demo** mit Beispieldaten, die nur im eigenen Browser gespeichert werden (Schüler-Code `LNA-7K3`, Lehrkraft-Passwort `lehrer123`).

## Aufgabenblätter schreiben

Jede Aufgabe beginnt mit einer Zeile wie `Aufgabe 1 (Multiple Choice)` oder `Aufgabe 2 (Freitext, 3 Punkte)`. Ein Beispiel mit allen Aufgabenarten liegt in [`vorlagen/`](vorlagen/) als Word- und PDF-Datei. Zeilen, die mit `//` beginnen, sind Notizen und werden ignoriert.

## Updates

- **Webseite ändern:** neue `index.html` hochladen (*Add file → Upload files*). `config.js` dabei nicht überschreiben.
- **Code.gs ändern:** im Apps-Script-Editor einfügen → *Bereitstellen → Bereitstellungen verwalten → Stift → Version: Neue Version → Bereitstellen*. Die Adresse bleibt gleich. Neue Spalten in der Tabelle werden automatisch ergänzt.

## Datenschutz

Die Daten liegen im Google-Konto der Lehrkraft (am besten ein Schulkonto). Bitte die Nutzung mit der Schule abstimmen und nach Möglichkeit nur Vornamen mit Initiale anlegen. Wer einen Code kennt, sieht die Aufgaben und Ergebnisse dieser Person.
