# My OpenClaw

AI coding agent with project isolation and team collaboration.

## Quick Start

### Download Release (Recommended)

Download the latest release from GitHub:

- [my-openclaw-v0.1.0-dist.zip](https://github.com/fengyonghui/my-openclaw/releases/tag/v0.1.0)
- [my-openclaw-v0.1.0-dist.tar.gz](https://github.com/fengyonghui/my-openclaw/releases/tag/v0.1.0)

Extract and run:

```bash
unzip my-openclaw-v0.1.0-dist.zip
cd my-openclaw-v0.1.0-dist

# Install backend dependencies
npm run install

# Start the server
npm start
```

Then open [http://localhost:3001](http://localhost:3001) in your browser.

### Development

```bash
# Install dependencies
pnpm install

# Start dev server (frontend + backend with hot reload)
yarn dev

# Or run them separately:
pnpm run dev --filter @my-openclaw/backend   # backend on :3001
pnpm run dev --filter @my-openclaw/ui         # frontend on :3000
```

## Development

### Backend

```bash
cd backend
pnpm install
pnpm run dev     # tsx watch mode
pnpm run build   # compile TypeScript
pnpm start       # run production build
```

### Frontend (UI)

```bash
cd ui
pnpm install
pnpm run dev     # Vite dev server
pnpm run build   # production build
```

## Project Structure

```
my-openclaw/
├── backend/          # Fastify backend (port 3001)
│   ├── dist/         # Compiled JS (after build)
│   └── src/          # TypeScript source
├── ui/               # React frontend (Vite, port 3000)
│   └── src/          # React source
├── scripts/          # Build & release scripts
│   └── package-release.sh   # Creates distribution zip/tar.gz
└── .github/workflows/
    └── release.yml   # GitHub Actions release workflow
```

## Release & Packaging

Releases are built automatically via GitHub Actions. To trigger a new release:

### Option 1: GitHub Actions (Recommended)

1. Go to **Actions** → **Release** workflow
2. Click **Run workflow**
3. Enter the version (e.g., `0.2.0`) and click **Run workflow**

### Option 2: Push a Git Tag

```bash
git tag v0.2.0
git push --tags
```

### Option 3: Local Build

```bash
bash scripts/package-release.sh 0.2.0
```

The output goes to `dist-package/`:

```
dist-package/
├── my-openclaw-v0.2.0-dist.tar.gz
└── my-openclaw-v0.2.0-dist.zip
```

### What's in the package

The distribution contains compiled code only (no `node_modules`):

```
my-openclaw-vX.X.X-dist/
├── backend/
│   ├── dist/          # Compiled backend JS
│   └── package.json   # Dependencies manifest
├── ui/
│   └── dist/          # Compiled frontend static files
└── package.json       # "install" + "start" scripts
```

Users run `npm run install` once to install backend dependencies, then `npm start` to launch.

## Configuration

Backend environment variables (set in `backend/.env`):

| Variable | Description | Required |
|----------|-------------|----------|
| `DINGTALK_CLIENT_ID` | DingTalk Stream Mode App ID | Yes |
| `DINGTALK_CLIENT_SECRET` | DingTalk App Secret | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `MYSQL_HOST` | MySQL host | Yes |
| `MYSQL_PORT` | MySQL port (default 3306) | No |
| `MYSQL_USER` | MySQL user | Yes |
| `MYSQL_PASSWORD` | MySQL password | Yes |
| `MYSQL_DATABASE` | MySQL database name | Yes |
| `PORT` | Server port (default 3001) | No |

See `backend/.env.example` for a template.
