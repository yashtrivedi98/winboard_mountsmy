# Winboard

Winboard is a freelance opportunity board for work matching MoWeb's service areas: AI and automation, cloud and data, enterprise applications, web and mobile development, and product design.

It ships with two verified Reddit opportunities so the public board does not start empty. The optional collector can search approved Reddit communities every 30 seconds after Reddit OAuth credentials are added as environment variables.

## Run locally

Install [Node.js 20 or later](https://nodejs.org/) and run:

```powershell
npm start
```

Then open `http://127.0.0.1:4174`.

## Publish on Render

1. Create a new GitHub repository named `winboard` and push this folder to it.
2. In [Render](https://render.com), choose **New** → **Blueprint**, then select the repository.
3. Render reads `render.yaml`, deploys the board, and gives you a public `onrender.com` address.
4. In the Render service's **Environment** section, add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` when you have an approved Reddit application. Restart the service after adding them.

The Reddit collector respects returned API rate limits, so its 30-second interval is a target rather than a guarantee. LinkedIn and Discord are intentionally disabled until the required approved app or bot access is connected.

## Data storage

The starter opportunities are part of the repository. Collected leads are stored by the running service. For durable lead history on a production host that does not retain a disk between restarts, connect a database before relying on it as the only record.

