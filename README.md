# To Spiti Mas, site de la maison à Ios

Site statique en 5 langues : français, anglais, espagnol, italien et grec.

## Organisation

| Dossier | Contenu |
| --- | --- |
| `src/` | Les pages en français, à modifier ici |
| `src/partials/` | L'en-tête, le pied de page et le `<head>` communs à toutes les pages |
| `src/assets/` | Le CSS, le JavaScript et les photos du site |
| `lang/` | Les traductions, un fichier JSON par langue |
| `dist/` | Le site généré, à mettre en ligne. Ne pas le modifier à la main |
| `images/` | Les photos originales, en pleine résolution |
| `00 - archives/` | L'ancienne version du site |

## Voir le site en local

Il faut Node.js 20 ou plus récent. Aucune dépendance à installer.

Sur Mac, Windows ou Linux, dans un terminal ouvert dans le dossier du site :

```bash
npm start
```

Sur Mac, un double-clic sur `Lancer le site.command` fait la même chose. Si macOS bloque le fichier, faites un clic droit puis Ouvrir.

Sur Windows, un double-clic sur `Lancer le site.bat` fait la même chose.

Le site s'ouvre sur http://localhost:8080/fr/. Si le port 8080 est déjà pris, le serveur essaie 8081, puis 8082, et affiche l'adresse retenue. Chaque modification dans `src/` ou `lang/` régénère le site : rechargez la page pour la voir. Faites `Ctrl+C` pour arrêter.

Sur Mac et Linux, `PORT=3000 npm start` choisit le port, et `NO_OPEN=1 npm start` évite d'ouvrir le navigateur.

Pour générer le site sans le servir, avant une mise en ligne par exemple :

```bash
npm run build
```

Le script affiche les traductions manquantes. Un texte manquant reste en français dans les autres langues.

## Modifier un texte

Chaque texte traduisible porte un attribut `data-i18n="cle"` dans `src/`.

1. Modifiez le texte français dans la page de `src/`.
2. Lancez `node build.js`. Le fichier `lang/fr.json` se met à jour tout seul.
3. Modifiez la même clé dans `lang/en.json`, `lang/es.json`, `lang/it.json` et `lang/el.json`.

Pour ajouter un texte, donnez-lui une nouvelle clé, puis ajoutez cette clé dans les 4 fichiers de traduction.

Pour un texte alternatif d'image ou un `placeholder`, l'attribut s'écrit `data-i18n-alt="cle"` ou `data-i18n-placeholder="cle"`.

## Remplacer une photo

Les emplacements « Photo à venir » sont des blocs `<div class="ph">`. Remplacez-les par une balise `<img>`.

Pour remplacer une photo existante, déposez la nouvelle dans `src/assets/img/` sous le même nom. Gardez une largeur de 1800 px au maximum. Sur Mac, cette commande réduit une photo :

```bash
sips -s format jpeg -s formatOptions 65 -Z 1800 photo.jpg --out src/assets/img/nom.jpg
```

## Textes à compléter

Les textes à compléter apparaissent en rose, entre crochets. Pour les retrouver :

```bash
grep -n 'class="todo"' src/*.html
```

## Outil d'administration

L'outil sert à modifier les informations qui changent souvent, à générer le site et à le publier chez OVH. Il tourne uniquement sur votre ordinateur et n'est jamais mis en ligne.

```bash
npm run admin
```

Sur Mac, un double-clic sur `to-spiti-mas-administration.command` fait la même chose. Sur Windows, utilisez `to-spiti-mas-administration.bat`.

L'outil s'ouvre sur http://localhost:8090/. Il permet de modifier :

- la période d'ouverture des réservations ;
- les prix par saison et le séjour minimum ;
- les heures d'arrivée et de départ ;
- l'acompte, le solde et la caution ;
- la clé Web3Forms ;
- l'adresse du site et le HTTPS forcé.

Les valeurs sont enregistrées dans `data/infos.json`. Le site les affiche dans les 5 langues, au format de chaque langue.

Le bouton Publier sur OVH génère le site, puis envoie en FTP chiffré uniquement les fichiers modifiés. Le mot de passe FTP est demandé à chaque fois et n'est jamais enregistré. Les réglages FTP sont dans `deploy.config.json`, et la liste des fichiers déjà envoyés dans `.deploy-manifest.json`.

Le guide pas à pas pour OVH est dans l'outil, en bas de la page.

## Formulaire de réservation

Le formulaire envoie les demandes par e-mail avec Web3Forms, un service gratuit.

1. Créez une clé sur https://web3forms.com avec l'adresse qui doit recevoir les demandes.
2. Saisissez cette clé dans l'outil d'administration, section Formulaire de demande.

## Mise en ligne

Le site généré dans `dist/` est entièrement statique. Il marche chez tout hébergeur de fichiers.

| Hébergeur | Réglages |
| --- | --- |
| Netlify | Rien à faire : le fichier `netlify.toml` lance `node build.js` et publie `dist/`. |
| Vercel | Commande de build `node build.js`, dossier de sortie `dist`. |
| Cloudflare Pages | Commande de build `node build.js`, dossier de sortie `dist`. |
| GitHub Pages, OVH, FTP | Lancez `npm run build`, puis envoyez le contenu de `dist/`. |

Une adresse inconnue affiche `404.html`, qui renvoie vers l'accueil dans la langue du visiteur. Netlify, Vercel, Cloudflare Pages et GitHub Pages l'utilisent tout seuls. Sur un serveur Apache, comme chez OVH, ajoutez `ErrorDocument 404 /404.html` dans un fichier `.htaccess`. Sur nginx, ajoutez `error_page 404 /404.html;`.

La page `404.html` suppose que le site est à la racine du domaine. Elle ne marche pas dans un sous-dossier, comme `exemple.github.io/site/`.

L'adresse du site se règle dans l'outil d'administration, section Site. Elle sert aux liens entre les langues pour Google. Vérifiez-la avant la mise en ligne.
