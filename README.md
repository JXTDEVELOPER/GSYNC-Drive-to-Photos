# Google Drive to Google Photos Sync Orchestrator

A powerful, full-stack, secure web application designed to orchestrate the migration and synchronization of images and videos from Google Drive directly into Google Photos albums.

This application is built with a modern React frontend styled using Tailwind CSS and a fast Express backend proxy. It bypasses browser-side memory limits and safely handles direct binary streaming between Google Drive and Google Photos API endpoints.

---

## 🚀 Core Features

- **Google Workspace Integration**: Seamlessly connect with Google Drive and Google Photos APIs using secure OAuth 2.0.
- **Interactive Directory Navigation**: Browse and search Drive folders, view thumbnails, and select assets to sync.
- **Google Photos Album Management**: Sync assets into an existing Google Photos album or automatically create a new one.
- **Robust Transfer Orchestrator**:
  - **Sequential Upload Queue**: Stream files one-by-one to avoid rate-limiting.
  - **State Controls**: Instantly Pause, Resume, or Terminate sync operations safely.
  - **Dynamic Time Estimation**: Live estimation of sync durations based on selected file counts and adjustable network speeds.
  - **Connection Guard**: Automatic pausing if the network connection drops, and safe resumption once restored.
  - **Fault Tolerance**: Custom auto-pause threshold on consecutive API failures to prevent quota exhaustion.
- **Persistent Local History**: A persistent sync history dashboard storing an audit trail of past operations so you can inspect succeeded/failed file transfers even after a page refresh.

---

## 🛠️ Architecture Overview

The system utilizes a full-stack proxy model to keep API keys, file processing, and authorization credentials secure:

```
┌─────────────────┐             ┌─────────────────┐             ┌────────────────────────┐
│                 │             │                 │             │                        │
│  React Browser  ├────────────►│ Express Backend ├────────────►│  Google Workspace APIs │
│     Client      │  REST APIs  │   (API Proxy)   │  HTTP/REST  │                        │
│                 │             │                 │             │  Drive & Photos Cloud  │
└─────────────────┘             └─────────────────┘             └────────────────────────┘
```

1. **Client**: Authenticates using Google Identity Services (OAuth 2.0).
2. **Backend**: Acts as an intermediary node. It streams file chunks from Drive into memory buffers, and streams them out immediately to Google Photos raw upload endpoints, securing authorization flow without browser context leak.

For more deep-dive architectural information, check out **[SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)**.

---

## 📦 Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons, Framer Motion
- **Backend**: Express, Node.js, TypeScript (bundled via `esbuild`)
- **APIs Integrated**: Google Drive v3 API, Google Photos Library v1 API
- **Persistence**: Browser `localStorage` for sync logs, Firebase for authentication config

---

## ⚙️ Setup & Installation

### 1. Configure Environment Variables
Copy `.env.example` into a new file named `.env` and fill in your credentials:

```env
# Google OAuth Client Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### 2. Install Dependencies
Install all required Node.js and frontend packages:
```bash
npm install
```

### 3. Run in Development Mode
Start the full-stack development server:
```bash
npm run dev
```
The server will bind to `http://localhost:3000`.

### 4. Build for Production
Bundle both frontend and backend for serverless deployment:
```bash
npm run build
```
This compiles the client into `/dist` and the Express server into `dist/server.cjs`.

### 5. Start Production Server
Launch the bundled production instance:
```bash
npm run start
```

---

## 🛡️ Security & Permissions

This application requires the following OAuth scopes to read from Google Drive and upload to Google Photos:
- `https://www.googleapis.com/auth/drive.readonly` (To read and download files from your Drive folders)
- `https://www.googleapis.com/auth/photoslibrary` or `https://www.googleapis.com/auth/photoslibrary.sharing` (To create albums and write assets to your Photos account)

All authentication credentials stay on the client-side or are forwarded securely via temporary HTTP Bearer tokens to the backend proxy. No files or access tokens are saved or indexed persistently on our backend.
