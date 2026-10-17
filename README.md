# Pense à toi 💗

Un petit lac au bord duquel tu vis. Les gens que tu aimes habitent sur l'autre rive. Il n'y a aucun bouton : tout se passe dans le paysage.

- **Le paysage suit l'heure réelle** : aube, jour, crépuscule, nuit, avec le soleil puis la lune qui traversent le ciel.
- **Tes proches sont des lieux** : la maison de Maman, le phare, le moulin, la cabane. Leur fenêtre brille d'autant plus qu'ils ont pensé à toi récemment.
- **Penser à quelqu'un = toucher sa maison.** Une lanterne part de ton ponton, traverse le lac et va jusque chez lui ou elle, qui reçoit la notif « pense à toi 💗 ».
- **Les pensées reçues** montent de leur maison sous forme de lanternes et flottent dans ton ciel pendant une journée.
- **Voyager dans le temps** : fais glisser le ciel, le soleil avance et les jours défilent, avec le moment écrit dans un nuage (« demain soir »). Le paysage revient tout seul au présent.
- **Une bougie = « je suis libre ».** Appui long sur ton ponton à un moment donné : une bougie s'allume. Les autres voient ta bougie quand ils voyagent jusqu'à ce moment.
- **Deux bougies au même moment = une étoile** : c'est un moment ensemble, sans avoir à choisir entre s'appeler ou se voir. Les deux personnes sont prévenues, un rappel arrive un peu avant, et l'étoile attend au-dessus de sa maison ; la toucher fait voyager jusqu'au moment. Souffler sa bougie (nouvel appui long) annule.
- **Le lac vit** : une cane et ses canetons qui nagent (touche-les : « coin ! »), une grenouille sur les nénuphars (elle saute de feuille en feuille), des poissons qui sautent, des oiseaux qui passent, des lucioles le soir, des arbres et des roseaux dans le vent, des reflets sur l'eau, des nuages qui dérivent, la cheminée qui fume quand quelqu'un a pensé à toi, le faisceau du phare la nuit. Toucher l'eau fait des ronds.
- **Inviter** : un petit panneau « + » planté sur l'autre rive. Une seule phrase d'aide s'affiche, et seulement tant que tu n'as pas encore fait le geste.

## Direction artistique

Inspirée de *Subpar Pool*, en plus onirique : aplats pastel, ombres en **grain d'aérographe** (un filtre SVG qui transforme un dégradé en nuage de points), écailles en premier plan, ondes concentriques sur le lac. Un léger **tilt-shift** donne l'effet maquette : le ciel et le premier plan sont flous, l'autre rive nette. Tout ce qui est posé sur l'eau suit **un point de fuite unique** au milieu de l'horizon : le ponton se resserre en s'éloignant, ses planches se rapprochent, et canards, nénuphars ou reflets rapetissent avec la distance. Chaque moment de la journée est pré-rendu en image, et l'app fond de l'un à l'autre.

## La stack, et pourquoi

C'est une **web app installable (PWA)** plus un petit serveur **Node.js**, sans framework ni étape de build.

Depuis iOS 16.4, une web app ajoutée à l'écran d'accueil reçoit de vraies notifications push, avec la pastille sur l'icône. Pour un test avec ta mère et ta copine, ça évite :

- d'avoir un Mac et Xcode,
- de payer le compte Apple Developer (99 €/an),
- de passer par TestFlight ou la review de l'App Store.

Tu leur envoies un lien et c'est tout. Si l'idée prend, on pourra écrire une vraie app SwiftUI qui parlera au même serveur.

```
server.js          démarrage, clés VAPID, envoi des push (web-push)
src/app.js         API + fichiers statiques + rappels
src/store.js       mini base JSON (data/db.json), écritures atomiques
public/            l'app : app.js (le lac, les gestes, le temps), scene.js (le paysage dessiné),
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

Les push marchent sur `localhost` dans Chrome ou Firefox sur ordinateur. Pour un iPhone, il faut une URL en **HTTPS**, donc un déploiement.

## Mettre en ligne (≈ 10 min)

Le serveur doit **tourner en continu** (pour les rappels) et garder un **disque persistant** (pour `db.json`). Les offres gratuites qui mettent le serveur en veille ne conviennent donc pas. **Railway** est le plus simple (≈ 5 $/mois) :

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
- Jusqu'à 4 proches (4 lieux sur l'autre rive).
- Les moments de la journée : matin (dès 9 h), midi, après-midi, soir (dès 19 h). La nuit, pas de bougie.
- Deux taps rapprochés ne comptent qu'une fois. Plusieurs pensées dans la journée deviennent « pense encore à toi 💗 ×3 ».
- La notif « a allumé une bougie » part au plus une fois par jour.

## La suite : une vraie app iOS

Cette version web sert de labo pour le design. L'étape d'après est une app SwiftUI qui parlera au même serveur. Elle demande un compte Apple Developer (99 €/an) ; pas besoin de Mac, la compilation et l'envoi sur TestFlight peuvent se faire dans le cloud. Elle débloquerait :

- un bouton « 💗 renvoyer une pensée » directement dans la notif ;
- le **bouton Action** des iPhone 15 Pro / 16 Pro pour envoyer une pensée sans ouvrir l'app ;
- un widget écran verrouillé avec le lac et les fenêtres allumées ;
- une **Live Activity** le jour d'un moment ensemble : l'étoile et le compte à rebours dans la Dynamic Island.
