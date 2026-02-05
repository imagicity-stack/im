# IMAGICITY Next.js + Firebase (secure migration)

This folder contains the migrated app in **Next.js** (`main/`) while preserving the existing UI and workflow from the previous frontend.

## What this migration does

- Keeps the frontend pages/components design and behavior.
- Replaces backend runtime with Next.js API routes (`app/api/[...path]/route.js`).
- Uses **Firebase Authentication** for login/signup.
- Uses **Firestore** for all persistent data (users, clients, services, invoices, expenses, settings).
- Enforces admin-only API access:
  - API verifies Firebase ID token with **Firebase Admin SDK**.
  - Looks up `users/{uid}` and allows access only if `role == "admin"`.

---

## Architecture

- Client login/signup: Firebase Web SDK (`src/lib/firebaseClient.js`)
- API auth & DB: Firebase Admin SDK (`src/server/firebaseAdmin.js`)
- API endpoints: catch-all route (`app/api/[...path]/route.js`)

### Collections used

- `users` (document id = Firebase UID)
- `clients`
- `services`
- `invoices`
- `expenses`
- `settings` (document id = Firebase UID)

All business records store:
- `id`
- `user_id`
- `created_at`

---

## Required Firebase setup

## 1) Create Firebase project

1. Go to Firebase Console.
2. Create/select project.
3. Enable **Authentication** (Email/Password provider).
4. Enable **Cloud Firestore** in production mode.

## 2) Web App credentials

From Project Settings → General → Your Apps → Web app config, copy:

- `apiKey`
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

Set them as `NEXT_PUBLIC_*` environment variables.

## 3) Admin SDK credentials

Project Settings → Service Accounts → Generate private key.

Use either:

- `FIREBASE_SERVICE_ACCOUNT_KEY` (full JSON string), or
- split values:
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`

> For split private key in Vercel, keep escaped newlines (`\n`).

---

## Firestore security rules (strict)

Use `firestore.rules` in this folder.

Behavior:
- `users/{uid}`: read-only by same authenticated user.
- Everything else: denied from client SDK.
- Writes/reads for app data must go via Next API + Admin SDK.

Deploy rules:

```bash
firebase deploy --only firestore:rules
```

---

## Vercel environment variables

Set all in Vercel Project → Settings → Environment Variables:

### Public (Client)
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

### Server-only (API)
- `FIREBASE_SERVICE_ACCOUNT_KEY`

or split:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

---

## Firebase hosting options

You asked for Firebase hosting. For Next.js SSR, use one of:

1. **Firebase App Hosting** (recommended modern path), or
2. Firebase Hosting + Cloud Functions adapter.

If you deploy on Vercel, the same env vars above work, but hosting is then Vercel (not Firebase Hosting).

---

## Local run

```bash
cd main
npm install
npm run dev
```

Open `http://localhost:3000`.

---

## Admin access model

- On first signup, if no admin exists in `users`, role is auto-set to `admin`.
- Subsequent signups default to `user`.
- API access is allowed only when `users/{uid}.role == "admin"`.

To promote someone manually:

```bash
# using Firebase Console
# Firestore -> users/{uid} -> set role: "admin"
```

---

## Important hardening notes

- Never expose service account credentials to browser.
- Keep all mutations in server routes only.
- Keep Firestore client rules deny-all except minimal profile read.
- Rotate service account keys periodically.
- Enable Firebase Auth abuse protections and email verification if required.

