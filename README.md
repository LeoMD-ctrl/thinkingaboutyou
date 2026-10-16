# Pense à toi 💗

Un petit pager du cœur pour iPhone.

- **Un seul bouton** : le gros cœur. Tu le touches et l'autre reçoit une notif : « 🌷 Maman — pense à toi 💗 ».
- **« On se trouve un moment ? »** : tu proposes un appel 📞 ou de se voir 🫶, tu touches 1 à 3 créneaux suggérés (ou « Autre… »), c'est envoyé. L'autre touche le créneau qui lui va : c'est calé, vous recevez tous les deux une notif, puis un rappel 30 min avant. Si rien ne va, « Aucun ne me va » permet de proposer d'autres moments.
- **Inviter** : le bouton « + » partage un lien (iMessage, WhatsApp…). La personne qui l'ouvre est reliée à toi automatiquement.

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
public/            l'app : index.html, style.css, app.js, sw.js (service worker), icônes
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
- Deux taps rapprochés sur le cœur ne comptent qu'une fois. Plusieurs cœurs dans la journée deviennent « pense encore à toi 💗 ×3 ».
- « Ajouter à mon calendrier » télécharge un fichier `.ics`, avec une alarme 30 min avant.

## Idées pour la suite

- Une petite relance douce quand ça fait longtemps qu'on ne s'est pas parlé (« Ça fait 3 semaines… on s'appelle ? »).
- Des moments récurrents (« l'appel du dimanche »).
- Une vraie app SwiftUI avec un widget écran d'accueil / Apple Watch pour envoyer le cœur sans ouvrir l'app.
