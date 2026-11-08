// Adresse du serveur en production : le déploiement (Caddy) remplace ce fichier par window.ECOLE_API = "https://votre-domaine";
// Vide = prototype simulé (ou ?api=http://... en développement).
window.ECOLE_API = window.ECOLE_API || '';
// Plateforme multi-écoles : pour qu'un sous-domaine ou un déploiement soit dédié à UNE école, fixez son code ici
// (ex. window.ECOLE_CODE = "horizon") : le champ « Code de l'établissement » disparaît de l'écran de connexion.
// Vide = l'utilisateur saisit le code (ou l'adresse contient ?ecole=horizon).
window.ECOLE_CODE = window.ECOLE_CODE || '';
