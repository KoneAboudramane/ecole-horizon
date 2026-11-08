// Réglages du site en production (O2switch). Ce fichier REMPLACE le config.js de développement dans le dossier du site
// (le script preparer-o2switch le fait pour vous).
// Adresse de l'API : déduite automatiquement de l'adresse du site, ecole.exemple.ci -> https://api.ecole.exemple.ci
// (www. est ignoré). Si votre API a une autre adresse, écrivez-la à la place, sans / final :
//   window.ECOLE_API = "https://api.ecole.exemple.ci";
window.ECOLE_API = "https://api." + location.hostname.replace(/^www\./, "");
// Vide : chaque utilisateur saisit le code de son école. Site dédié à une seule école : son code (ex. "horizon").
window.ECOLE_CODE = "";
