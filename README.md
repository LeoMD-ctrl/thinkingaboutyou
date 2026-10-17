# Pense à toi 💗

Deux petits êtres tout doux, toi et l'autre, posés sur un îlot.

- **Une pensée = un toucher.** Touche l'autre personnage : ton petit être sautille, un cœur traverse l'écran, l'autre reçoit une notif « Maman — pense à toi 💗 ». Quand tu ouvres l'app, les cœurs reçus arrivent en volant vers toi.
- **Ils se rapprochent quand vous vous pensez.** Plus les pensées vont dans les deux sens, plus les deux personnages se rapprochent. Quand vous vous manquez tous les deux, ils se touchent et sourient. Une personne seule ne peut les amener qu'à mi-chemin.
- **Notre ciel.** Une semaine découpée en matin / midi / aprèm / soir. Chacun peint au doigt ses moments libres, comme à l'aérographe, dans sa couleur. Là où les couleurs se mêlent apparaît un petit cœur : on le touche, on choisit « on s'appelle » ou « on se voit », et c'est calé, sans aller-retour ni créneau horaire. Rappel un peu avant, et un événement « 🫶 Maman » pour le calendrier.
- **Inviter** : la dernière page (balaye vers la gauche) montre une place vide à côté de toi ; le lien partagé relie automatiquement.

## Direction artistique

Inspirée de *Subpar Pool*, en plus minimaliste : aplats pastel, typo ronde et grasse (Fredoka), pilules épaisses, et des ombres en **grain d'aérographe** (un filtre SVG qui transforme un dégradé en nuage de points). Presque aucun texte : pas de compteurs ni de listes, seulement des personnages qui bougent.

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
public/            l'app : app.js (écrans), avatar.js (personnages + grain), sky.js (notre ciel),
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
- Deux taps rapprochés ne comptent qu'une fois. Plusieurs pensées dans la journée deviennent « pense encore à toi 💗 ×3 ».
- Une notif « a peint ses moments libres » part au plus une fois par jour, et « vos ciels se croisent » une seule fois par moment commun.

## La suite : une vraie app iOS

Cette version web sert de labo pour le design. L'étape d'après est une app SwiftUI qui parlera au même serveur. Elle demande un compte Apple Developer (99 €/an) ; pas besoin de Mac, la compilation et l'envoi sur TestFlight peuvent se faire dans le cloud. Elle débloquerait :

- un bouton « 💗 renvoyer une pensée » directement dans la notif ;
- le **bouton Action** des iPhone 15 Pro / 16 Pro pour envoyer une pensée sans ouvrir l'app ;
- un widget écran verrouillé avec les deux personnages ;
- une **Live Activity** le jour d'un moment calé : les deux personnages qui se rapprochent dans la Dynamic Island.
