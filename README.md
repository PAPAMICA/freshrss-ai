# 🧠 FreshRSS AI Digest

Extension FreshRSS pour résumer intelligemment vos articles non lus grâce à l'IA.

## Fonctionnalités

- **Bouton "Résumé IA"** intégré dans l'interface FreshRSS
- **Résumé contextuel** : respecte le filtre actif (tout, catégorie, flux)
- **Multi-fournisseurs LLM** : OpenAI, Anthropic Claude, Mistral AI, Ollama (local), API compatible OpenAI
- **Rendu Markdown** : le résumé est affiché avec une mise en forme riche
- **Marquer comme lu** : depuis la modale, marquer tout ou une sélection d'articles comme lus
- **Rapport par email** : résumé HTML envoyé automatiquement (quotidien ou hebdomadaire)
- **Configuration complète** : prompt personnalisable, température, modèle, SMTP, etc.
- **Mode sombre** : interface adaptive (suit le thème FreshRSS)

## Installation

1. Téléchargez ou clonez ce dépôt dans le dossier `extensions/` de FreshRSS :
   ```bash
   cd /path/to/freshrss/extensions
   git clone https://github.com/papamica/freshrss-ai xExtension-AIDigest
   ```

2. Dans FreshRSS, allez dans **Administration → Extensions** et activez **AI Digest**.

3. Cliquez sur **Configurer** pour saisir votre clé API et choisir votre fournisseur IA.

## Configuration

### Fournisseurs supportés

| Fournisseur | Clé API | URL personnalisée | Modèles conseillés |
|---|---|---|---|
| **OpenAI** | ✅ | ❌ | `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini` |
| **Anthropic Claude** | ✅ | ❌ | `claude-3-5-haiku-20241022`, `claude-opus-4-5` |
| **Mistral AI** | ✅ | ❌ | `mistral-large-latest`, `mistral-small-latest` |
| **Ollama (local)** | ❌ | ✅ `http://localhost:11434` | `llama3.2`, `mistral`, `qwen2.5` |
| **API compatible OpenAI** | ✅ | ✅ | Tout modèle compatible |

### Prompt

Le prompt par défaut est optimisé pour produire un résumé en français, structuré et sans doublons.  
Vous pouvez le personnaliser entièrement. Utilisez `{{ARTICLES}}` comme emplacement pour les articles.

## Rapport email automatique

### Via PHP `mail()`

Si votre serveur a `mail()` configuré, aucune config SMTP n'est nécessaire.

### Via SMTP

Renseignez dans la configuration :
- Hôte SMTP (ex: `smtp.gmail.com`)
- Port (587 pour STARTTLS, 465 pour SSL)
- Utilisateur / Mot de passe

### Cron

Ajoutez cette ligne à votre crontab (`crontab -e`) :

```cron
0 8 * * * www-data php /path/to/freshrss/extensions/xExtension-AIDigest/cron.php >> /var/log/freshrss-ai-digest.log 2>&1
```

Pour cibler un utilisateur spécifique :

```cron
0 8 * * * www-data php /path/to/freshrss/extensions/xExtension-AIDigest/cron.php mon_utilisateur
```

Ou via la variable d'environnement :

```cron
0 8 * * * www-data FRESHRSS_USER=mon_utilisateur php /path/to/freshrss/extensions/xExtension-AIDigest/cron.php
```

Le script respecte la planification configurée dans l'extension (quotidien / hebdomadaire / jamais) et l'heure configurée.

## Utilisation

1. **Ouvrez FreshRSS** et naviguez dans vos flux/catégories
2. **Cliquez sur "🧠 Résumé IA"** dans la barre de navigation
3. Attendez quelques secondes que l'IA génère le résumé
4. **Lisez le digest** : les articles sont regroupés par thème
5. **Marquez comme lus** :
   - Cliquez sur `✅ Tout marquer lu` pour marquer tous les articles résumés
   - Ou cochez/décochez individuellement dans la liste des articles
   - Cliquez sur `✓` à côté d'un article pour le marquer seul
6. **Email** : cliquez sur `📧 Email` pour envoyer le résumé par mail immédiatement

## Structure du projet

```
xExtension-AIDigest/
├── extension.php          # Classe principale de l'extension
├── metadata.json          # Métadonnées de l'extension
├── configure.phtml        # Page de configuration
├── cron.php               # Script cron pour les emails automatiques
├── static/
│   ├── summary.js         # Interface JS (bouton, modal, mark as read)
│   └── summary.css        # Styles modernes (dark mode, responsive)
└── README.md              # Ce fichier
```

## Foire aux questions

**Q : Le bouton n'apparaît pas dans l'interface ?**  
R : L'extension injecte le bouton dans `#nav_menu` ou `.nav_menu`. Si votre thème FreshRSS utilise une structure différente, un bouton flottant en bas à droite sera utilisé comme fallback.

**Q : Le résumé est vide ou incomplet ?**  
R : Vérifiez le nombre max d'articles et la taille max par article dans la configuration. Augmentez si nécessaire. Vérifiez aussi votre clé API et les quotas.

**Q : Ollama ne fonctionne pas ?**  
R : Assurez-vous qu'Ollama est accessible depuis le serveur PHP (pas depuis votre navigateur). L'URL doit être accessible depuis le serveur, par ex. `http://ollama:11434` en Docker.

**Q : L'email n'est pas envoyé ?**  
R : Vérifiez d'abord avec "Envoyer un email de test" dans la configuration. Si vous utilisez `mail()`, vérifiez que PHP peut envoyer des emails sur votre serveur.

## Licence

MIT — Libre d'utilisation, modification et redistribution.
