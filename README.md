# TabGroup Notes 📝

**TabGroup Notes** est une extension de navigateur qui simplifie la gestion de vos tâches quotidiennes en ajoutant des "post-it" directement liés à vos groupes d'onglets. Idéal pour garder le contexte d'un projet de recherche ou d'un flux de travail bien en vue !


## ✨ Fonctionnalités

- 🗂️ **Liaison aux Tab Groups** : Chaque groupe d'onglets possède ses propres notes isolées.
- 🚀 **Accès Rapide** : Ouvrez facilement vos post-it via le panneau latéral.
- 💾 **Sauvegarde Automatique** : Ne perdez jamais vos idées grâce à l'enregistrement automatique (Storage API).

## 🛠️ Installation (Mode Développeur)

1. Clonez ou téléchargez ce dépôt sur votre machine.
2. Ouvrez votre navigateur (Chrome/Edge/Brave) et accédez à `chrome://extensions/`.
3. Activez le **Mode développeur** (souvent en haut à droite).
4. Cliquez sur **Charger l'extension non empaquetée** (Load unpacked).
5. Sélectionnez le dossier contenant ce projet.
6. L'extension "TabGroup Notes" apparaît et est prête à l'emploi via l'icône dans votre barre d'outils !

## 🏗️ Structure du projet

- `manifest.json` : Fichier de configuration principale de l'extension (Manifest V3).
- `panel.html` / `panel.css` / `panel.js` : Interface, design et logique du panneau latéral de l'extension.
- `background.js` : Service worker pour gérer les événements en arrière-plan.
