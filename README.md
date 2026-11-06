# To Spiti Mas, site de la maison à Ios

Le projet contient deux applications :

- le site public, statique, en 5 langues (français, anglais, espagnol, italien et grec), hébergé chez OVH ;
- l'outil d'administration, qui tourne uniquement sur votre ordinateur. Il modifie les prix et les dates, génère le site et le publie chez OVH.

Il faut Node.js 20 ou plus récent. Il n'y a aucune dépendance à installer.

## Démarrer

| Pour | Sur Mac | Sur Windows | Dans un terminal |
| --- | --- | --- | --- |
| Ouvrir l'outil d'administration | double-clic sur `to-spiti-mas-administration.command` | double-clic sur `to-spiti-mas-administration.bat` | `npm run admin` |
| Voir le site en local pendant qu'on modifie le code | double-clic sur `to-spiti-mas-apercu.command` | double-clic sur `to-spiti-mas-apercu.bat` | `npm start` |
| Générer le site sans le servir | | | `npm run build` |

La première fois, macOS peut bloquer un fichier `.command`. Faites un clic droit, choisissez Ouvrir, puis confirmez.

Laissez la fenêtre du terminal ouverte tant que vous utilisez l'outil ou l'aperçu. La fermer les arrête.

## Organisation

Les dossiers techniques portent des noms anglais. Ce que vous manipulez vous-même porte un nom français : les lanceurs, `ressources/` et ce fichier.

```
to-spiti-mas/
├── site/                 le site public, à modifier ici
│   ├── pages/            une page HTML par page du site, en français
│   ├── partials/         l'en-tête, le pied de page et le <head>, communs à toutes les pages
│   ├── styles/           le CSS, un fichier par sujet, assemblé en un seul site.css
│   ├── assets/js/        le JavaScript du site
│   ├── assets/img/       les photos du site, déjà réduites pour le web
│   ├── lang/             les traductions, un fichier par langue
│   └── data/infos.json   les prix, dates et réglages modifiés par l'outil d'administration
├── admin/                l'outil d'administration
│   ├── server.js         le serveur local et ses adresses
│   ├── fields.js         la liste des champs, leurs vérifications et la checklist
│   ├── ftp.js            l'envoi chez OVH et le diagnostic de connexion
│   ├── storage.js        la lecture et l'écriture des réglages locaux
│   └── ui/               la page de l'outil (HTML, CSS, JavaScript)
├── scripts/
│   ├── build.js          génère le site dans dist/
│   └── preview.js        sert dist/ en local et régénère à chaque modification
├── ressources/           les originaux, jamais mis en ligne
│   ├── photos/           les photos en pleine résolution (maison, Airbnb, photos libres et leurs crédits)
│   ├── logo/             le logo et la branche d'olivier, versions originales
│   └── ancien-site/      la première version du site
└── dist/                 le site généré, à ne jamais modifier à la main
```

## Les styles

`scripts/build.js` assemble les fichiers de `site/styles/` dans cet ordre, en un seul `dist/assets/css/site.css` :

| Fichier | Contenu |
| --- | --- |
| `base.css` | couleurs, polices, textes, boutons, sections communes |
| `layout.css` | en-tête et menu, haut des pages intérieures, bandeau bleu, pied de page, branche d'olivier |
| `components.css` | texte et photos côte à côte, galerie et albums, panorama, tableaux, blocs d'informations |
| `home.css`, `house.css`, `guide.css`, `infos.css`, `contact.css`, `legal.css` | une feuille par page |

Les règles pour mobile sont écrites à la fin de chaque fichier, à côté des éléments qu'elles adaptent.

## Modifier un texte

Chaque texte traduisible porte un attribut `data-i18n="cle"` dans `site/pages/`.

1. Modifiez le texte français dans la page de `site/pages/`.
2. Lancez `npm run build`. Le fichier `site/lang/fr.json` se met à jour tout seul.
3. Modifiez la même clé dans `en.json`, `es.json`, `it.json` et `el.json`, dans `site/lang/`.

Pour un nouveau texte, donnez-lui une nouvelle clé, puis ajoutez-la dans les 4 fichiers de traduction. Le build signale les clés manquantes. Un texte manquant reste en français dans les autres langues.

Pour un texte alternatif d'image ou un `placeholder`, l'attribut s'écrit `data-i18n-alt="cle"` ou `data-i18n-placeholder="cle"`.

Les repères comme `{{price:seasons.high.night}}` affichent une valeur de `site/data/infos.json`. Gardez-les à l'identique dans chaque traduction : le build bloque la publication si une langue en perd un.

## Textes à compléter

Les textes à compléter apparaissent en rose, entre crochets. Pour les retrouver :

```bash
grep -n 'class="todo"' site/pages/*.html
```

## Remplacer une photo

Déposez la nouvelle photo dans `site/assets/img/`, sous le même nom que l'ancienne, avec une largeur de 1800 px au maximum. Gardez l'original dans `ressources/photos/`. Sur Mac, cette commande réduit une photo :

```bash
sips -s format jpeg -s formatOptions 65 -Z 1800 original.jpg --out site/assets/img/nom.jpg
```

Les photos sous licence libre doivent rester créditées : leurs auteurs sont listés dans `ressources/photos/libres/credits.json` et sur la page Mentions légales.

## Outil d'administration

L'outil s'ouvre sur http://localhost:8090/. Il permet de modifier :

- la période d'ouverture des réservations ;
- les prix par saison et le séjour minimum ;
- les heures d'arrivée et de départ ;
- l'acompte, le solde, la caution et l'annulation gratuite ;
- la clé Web3Forms, qui fait arriver les demandes de réservation par e-mail ;
- l'adresse du site et le HTTPS forcé.

Les valeurs sont enregistrées dans `site/data/infos.json`. Le site les affiche dans les 5 langues, au format de chaque langue.

Le bouton Publier sur OVH vérifie les réglages et la connexion, génère le site, puis envoie en FTP chiffré uniquement les fichiers modifiés. Le mot de passe FTP est demandé à chaque fois et n'est jamais enregistré. Les réglages FTP sont dans `admin/deploy.config.json`, et la liste des fichiers déjà envoyés dans `admin/.deploy-manifest.json`. Ces deux fichiers restent sur votre ordinateur.

Le guide pas à pas pour OVH est dans l'outil, en bas de la page.

## Mise en ligne sans l'outil

Le build génère un site entièrement statique, avec un fichier `.htaccess` pour OVH : page 404, compression, cache et redirection HTTPS. En secours, lancez `npm run build`, puis envoyez tout le contenu de `dist/` dans le dossier `www` d'OVH avec FileZilla, fichier caché `.htaccess` compris.
