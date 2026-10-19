# Pense à toi 💗

Un petit monde où vivent les gens que tu aimes. Il n'y a aucun bouton : tout se passe dans le paysage. Le vocabulaire de l'app (pensée, signe, mot doux, lieu, carte…) est défini dans [`GLOSSARY.md`](GLOSSARY.md).

- **Ta carte** : tu choisis où tu vis en arrivant. Pour l'instant, c'est la **campagne luxuriante** ; le jardin japonais, le phare et l'océan, et la montagne enneigée arrivent ensuite. Un appui long sur ton ponton permet de changer de carte.
- **Tes proches habitent des lieux** : la maison, le moulin, la ferme, la roulotte, la cabane dans l'arbre, le pigeonnier, soit 6 places. Chacun reçoit le premier lieu libre et le garde. Une fenêtre brille d'autant plus que la personne a pensé à toi récemment, et sa cheminée fume.
- **Une pensée = toucher son lieu.** Une lanterne part de ton ponton, traverse l'étang et va jusque chez lui ou elle, qui reçoit « pense à toi 💗 ». Pas de texte, pas d'accusé de lecture.
- **Les pensées reçues** montent de leur lieu sous forme de lanternes et flottent dans ton ciel pendant une journée.
- **Le signe** : quand chacun a envoyé au moins 3 pensées à l'autre sur les 7 derniers jours, un signe apparaît. La nuit, c'est une étoile au-dessus de son lieu ; le jour, un cerf-volant attaché à son toit. Il s'efface si les pensées s'arrêtent.
- **La météo (si on le veut)** : un appui long sur ton ponton ouvre « Chez toi », avec un interrupteur « Partager ma météo ». Une fois activé, le temps qu'il fait vraiment chez toi recouvre ta carte (ciel gris, pluie avec des ronds sur l'étang, neige, brume, orage) et apparaît en petit au-dessus de ton lieu chez tes proches. En le touchant, on lit « Chez Maman · pluie · 12° ». Seule une position arrondie à ~10 km est utilisée, elle n'est jamais montrée, et on peut arrêter à tout moment. La météo vient d'[Open-Meteo](https://open-meteo.com), gratuit et sans clé.
- **Le mot doux** : toucher un signe fait apparaître 6 lucioles, chacune portant un mot (« courage ! », « belle journée », « tu me manques »…). On en touche une, elle s'envole. L'autre reçoit « Léo pense à toi · courage ! » et voit une lanterne dorée au-dessus de ton lieu ; en la touchant, il ou elle lit le mot. Un seul mot doux par signe, pour que ça ne devienne jamais pressant.
- **Laisser partir** : un appui long sur un lieu propose « Laisser partir Maman ? ». Son lieu s'efface comme une brume, sans prévenir personne. Le compte reste, et une nouvelle invitation peut recréer le lien.
- **La campagne vit** : une cane et ses canetons, une grenouille sur les nénuphars, des poissons qui sautent, des oiseaux, des moutons qui broutent, des papillons, un chat qui dort sur le ponton, un cerisier qui perd ses pétales, un champ de fleurs, des lucioles le soir, des arbres et des roseaux dans le vent. Presque tout se touche (« coin ! », « bêê », « miaou », « croâ »), et toucher l'eau fait des ronds.
- **Le paysage suit l'heure réelle** : aube, jour, crépuscule, nuit.
- **Inviter** : un petit panneau « + » planté à la première place libre. Une phrase d'aide s'affiche seulement tant que tu n'as pas encore fait le geste.

## Direction artistique

Inspirée de *Subpar Pool*, en plus onirique : aplats pastel, ombres en **grain d'aérographe** (un filtre SVG qui transforme un dégradé en nuage de points), écailles en premier plan, ondes concentriques sur l'étang. Un léger **tilt-shift** donne l'effet maquette : le ciel et le premier plan sont flous, l'autre rive nette. Tout ce qui est posé sur l'eau suit **un point de fuite unique** au milieu de l'horizon : le ponton se resserre en s'éloignant, ses planches se rapprochent, et canards, nénuphars ou reflets rapetissent avec la distance. Chaque moment de la journée est pré-rendu en image, et l'app fond de l'un à l'autre.

## La stack, et pourquoi

C'est une **web app installable (PWA)** plus un petit serveur **Node.js**, sans framework ni étape de build.

Depuis iOS 16.4, une web app ajoutée à l'écran d'accueil reçoit de vraies notifications push, avec la pastille sur l'icône. Pour un test avec ta mère et ta copine, ça évite :

- d'avoir un Mac et Xcode,
- de payer le compte Apple Developer (99 €/an),
- de passer par TestFlight ou la review de l'App Store.

Tu leur envoies un lien et c'est tout. Si l'idée prend, on pourra écrire une vraie app SwiftUI qui parlera au même serveur.

```
server.js          démarrage, clés VAPID, envoi des push (web-push)
src/app.js         API (pensées, signes, mots doux, liens, météo) + fichiers statiques
src/weather.js     météo réelle (Open-Meteo), positions arrondies
src/store.js       mini base JSON (data/db.json), écritures atomiques
public/            l'app : app.js (le monde, les gestes, signes et mots doux), scene.js (le paysage et les lieux),
                   life.js (animaux et animations),
                   style.css, sw.js (service worker), icônes
test/              tests de l'API (node --test)
```

## Lancer en local

```bash
npm install
npm start          # http://localhost:3000
npm test
```

Sans réseau, `FAKE_WEATHER=1 npm start` invente la météo à partir de la latitude partagée (décimale .0 grand beau, .1 nuages, .2 gris, .3 brouillard, .4 pluie, .5 neige, .6 orage).

Les push marchent sur `localhost` dans Chrome ou Firefox sur ordinateur. Pour un iPhone, il faut une URL en **HTTPS**, donc un déploiement.

## Mettre en ligne (≈ 10 min)

Le serveur doit garder un **disque persistant** (pour `db.json`). Les offres gratuites sans disque ou qui mettent le serveur en veille ne conviennent donc pas. **Railway** est le plus simple (≈ 5 $/mois) :

1. Sur [railway.app](https://railway.app) : *New Project → Deploy from GitHub repo* → choisis ce dépôt. Le `Dockerfile` est détecté tout seul.
2. Dans le service : *Settings → Volumes → Add volume*, monté sur **`/data`**.
3. *Variables* : ajoute `VAPID_SUBJECT=mailto:ton-email@exemple.com`. Apple refuse les push si cette adresse n'est pas valide.
4. *Settings → Networking → Generate domain* : tu obtiens une URL `https://….up.railway.app`.

Les clés VAPID sont générées au premier démarrage et rangées dans `/data/vapid.json`. Ne supprime pas ce fichier, sinon les abonnements aux notifications existants ne marcheront plus. Tu peux aussi les fournir via `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` (à générer avec `npx web-push generate-vapid-keys`).

N'importe quel hébergeur Docker avec un volume fait l'affaire (Fly.io, un VPS…).

## Faire tester à Maman et à ta copine

1. **Toi d'abord** : ouvre l'URL dans **Safari** sur ton iPhone → bouton Partager (ou ⋯) → **Sur l'écran d'accueil**. Ouvre l'app depuis l'icône, choisis ton prénom et ton emoji, puis **active les notifications**.
2. Touche **+** → **Partager le lien** et envoie-le à ta mère, puis à ta copine.
3. De leur côté : elles ouvrent le lien **dans Safari** (depuis WhatsApp, appuyer longuement → *Ouvrir dans Safari*). La page leur montre les 3 étapes pour installer l'app. Ensuite elles l'ouvrent depuis l'écran d'accueil, tapent leur prénom et activent les notifs. Vous êtes reliés automatiquement.

Si quelqu'un a déjà l'app installée, il suffit d'entrer le code à 6 lettres (bouton **+**).

> ⚠️ Sur iPhone, les notifications ne marchent **que** depuis l'icône de l'écran d'accueil, pas dans un onglet Safari. Il faut iOS 16.4 ou plus récent.

## Bon à savoir

- Pas de mot de passe : chaque téléphone garde une clé secrète. Si l'app est supprimée, on recrée un profil et on se ré-invite.
- Deux taps rapprochés ne comptent qu'une fois. Plusieurs pensées dans la journée deviennent « pense encore à toi 💗 ×3 ».
- Les décisions de conception sont dans [`docs/adr/`](docs/adr/).

## La suite : une vraie app iOS

Cette version web sert de labo pour le design. L'étape d'après est une app SwiftUI qui parlera au même serveur. Elle demande un compte Apple Developer (99 €/an) ; pas besoin de Mac, la compilation et l'envoi sur TestFlight peuvent se faire dans le cloud. Elle débloquerait :

- un bouton « 💗 renvoyer une pensée » directement dans la notif ;
- le **bouton Action** des iPhone 15 Pro / 16 Pro pour envoyer une pensée sans ouvrir l'app ;
- un widget écran verrouillé avec ta carte et les fenêtres allumées ;
- une **Live Activity** quand un signe apparaît : l'étoile ou l'arc-en-ciel dans la Dynamic Island.
