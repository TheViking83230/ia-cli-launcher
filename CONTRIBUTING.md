# Travailler à deux sur IA CLI Launcher

## Avant de modifier le code

1. Récupérer la dernière version : `git pull --rebase origin main`.
2. Vérifier la version de départ dans `package.json`. Elle doit correspondre à la dernière release : https://github.com/TheViking83230/ia-cli-launcher/releases/latest

Si GitHub a des commits que tu n'as pas, intègre-les avant de commencer.

## Pendant le travail

- Tester en développement avec `npm start`. Cette version utilise un dossier de données séparé : elle ne touche pas à l'appli installée.
- Committer à ton propre nom (`git config user.name` / `user.email`).

## Publier une version

1. Monter le numéro de version dans `package.json`. Un correctif monte aussi le dernier chiffre : la mise à jour automatique ignore les suffixes comme `-rev`.
2. Ajouter les notes de version dans le `CHANGELOG` de `src/renderer/renderer.js`.
3. Committer.
4. Lancer `npm run release -- --check`, puis `npm run release`.

Le script refuse de publier dans ces cas :

- la branche n'est pas `main` ;
- GitHub a des commits que tu n'as pas (le travail de l'autre) ;
- le tag ou une version supérieure ou égale existe déjà ;
- des fichiers suivis ne sont pas committés.

Chacun enregistre son propre jeton GitHub, dans le Gestionnaire d'identifiants Windows :
`powershell -ExecutionPolicy Bypass -File scripts/gh-token.ps1 -Set`

## Module JARVIS

| Élément | Emplacement |
|---|---|
| État (installé, actif) | `src/main/jarvis.js` |
| Option de l'installateur | `build/installer.nsh` |
| Interface | section « JARVIS » de `src/renderer/renderer.js` |
| Thème | `body.jarvis` dans `src/renderer/styles.css` |
| Sons | `src/renderer/jarvis/sounds/` |

Pour ajouter la vidéo de la cinématique, renseigner `JARVIS_INTRO_VIDEO` dans `renderer.js`.

Le dépôt est public : ne pas y mettre de musique ni d'images soumises à des droits.
