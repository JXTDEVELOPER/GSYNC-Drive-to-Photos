# System Architecture & Technical Specifications

This document outlines the system architecture, component layout, file transfer sequence, and fault-tolerance mechanics implemented in the Google Drive to Google Photos Sync Orchestrator application.

---

## 1. High-Level Architecture

The application is a full-stack web application designed to run on containerized infrastructure (such as Google Cloud Run). It employs a dual-tier architecture:

1. **Client Tier (React Single Page App)**:
   - Drives the presentation layer, asset discovery, user interaction, and queue management.
   - Communicates with Google APIs indirectly through the backend proxy.
   - Orchestrates transfer sessions, monitors network connection status, and logs metrics locally.

2. **Server Tier (Express API Server)**:
   - Hosts the REST endpoints used by the frontend.
   - Acts as a secure middleware node to stream media contents between Google Drive and Google Photos without holding files persistently.
   - Protects credentials by keeping the binary transfer and API configurations handled securely in Node memory buffers.

```
                  ┌───────────────────────────────────────────────┐
                  │                 BROWSER CLIENT                │
                  │                                               │
                  │   ┌───────────────────┐ ┌─────────────────┐   │
                  │   │   Auth Manager    │ │  Queue Manager  │   │
                  │   └─────────┬─────────┘ └────────┬────────┘   │
                  └─────────────┼────────────────────┼────────────┘
                                │ Bearer Token       │ REST APIs
                                ▼                    ▼
                  ┌───────────────────────────────────────────────┐
                  │                EXPRESS SERVER                 │
                  │                                               │
                  │  ┌─────────────────────────────────────────┐  │
                  │  │          API Proxy Controllers          │  │
                  │  └──────────────┬──────────────────┬───────┘  │
                  └─────────────────┼──────────────────┼──────────┘
                                    │ (Download File)  │ (Upload Media Item)
                                    ▼                  ▼
                  ┌───────────────────────────────────────────────┐
                  │               GOOGLE WORKSPACE                │
                  │                                               │
                  │       ┌──────────────┐     ┌─────────────┐    │
                  │       │  Drive API   │     │ Photos API  │    │
                  │       └──────────────┘     └─────────────┘    │
                  └───────────────────────────────────────────────┘
```

---

## 2. API Endpoint Mapping

The Express backend exposes the following internal endpoints (`/api/*`):

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/health` | Service health status | No |
| **GET** | `/api/drive/folders` | Fetches Google Drive folders (supports keyword search or child lookup) | Yes (Bearer Token) |
| **GET** | `/api/drive/folder-contents` | Fetches image & video files inside a specific Google Drive folder ID | Yes (Bearer Token) |
| **GET** | `/api/photos/albums` | Lists existing Google Photos albums (first page limit of 50 albums) | Yes (Bearer Token) |
| **POST** | `/api/photos/albums` | Creates a new Google Photos album | Yes (Bearer Token) |
| **POST** | `/api/photos/transfer-item` | Streams a single selected file from Google Drive to Google Photos | Yes (Bearer Token) |

---

## 3. Sequence Flow of a Single File Transfer

The key challenge of migrating files between Google Drive and Google Photos in a browser application is avoiding client-side RAM crashes on large raw image/video files and bypassing CORS (Cross-Origin Resource Sharing) limitations on direct API uploads. 

To solve this, the orchestrator routes the transfer through the Express backend via a stream-and-upload pipeline.

The diagram below details how a single file is transferred:

```
┌────────┐               ┌────────────────┐                ┌───────────┐                 ┌────────────┐
│ Client │               │ Express Server │                │ Drive API │                 │ Photos API │
└───┬────┘               └───────┬────────┘                └─────┬─────┘                 └─────┬──────┘
    │                            │                               │                             │
    │ POST /transfer-item        │                               │                             │
    ├───────────────────────────►│                               │                             │
    │ (fileId, fileName, etc.)   │                               │                             │
    │                            │ GET /files/{id}?alt=media     │                             │
    │                            ├──────────────────────────────►│                             │
    │                            │                               │                             │
    │                            │ Stream File Bytes (Buffer)    │                             │
    │                            │◄──────────────────────────────┤                             │
    │                            │                               │                             │
    │                            │ POST /uploads (Raw Binary Stream)                           │
    │                            ├────────────────────────────────────────────────────────────►│
    │                            │                                                             │
    │                            │ Upload Token                                                │
    │                            │◄────────────────────────────────────────────────────────────┤
    │                            │                                                             │
    │                            │ POST /mediaItems:batchCreate                                 │
    │                            ├────────────────────────────────────────────────────────────►│
    │                            │ (Creates Item & assigns to AlbumId)                         │
    │                            │                                                             │
    │                            │ Success Response                                            │
    │                            │◄────────────────────────────────────────────────────────────┤
    │                            │                                                             │
    │ JSON Response (success)    │                                                             │
    │◄───────────────────────────┤                                                             │
    │                            │                                                             │
```

### Detailed Pipeline Steps:
1. **Initiate Transfer**: The browser triggers a POST request to `/api/photos/transfer-item`, passing the asset's Google Drive `fileId`, original filename, mime type, and target Google Photos `albumId`.
2. **Retrieve File from Drive**: The Express server uses the user's OAuth access token to request the raw file from Google Drive's API. The response is streamed directly into an in-memory `ArrayBuffer`.
3. **Stage Binary Upload**: The Express server issues a raw HTTP upload request to Google Photos' `/v1/uploads` endpoint. It sends the buffered file bytes with the appropriate header variables (`X-Goog-Upload-Content-Type` set to the file's mime type, and `X-Goog-Upload-Protocol` set to `raw`).
4. **Acquire Upload Token**: Google Photos processes the bytes and returns a plain-text temporary **Upload Token**.
5. **Commit Media Creation**: The Express server takes this upload token and registers a new media item inside Google Photos via the `/v1/mediaItems:batchCreate` endpoint. If an `albumId` was selected, this endpoint automatically attaches the new photo/video to that specific album in the same operation.
6. **Confirm Status**: The server parses the batch creation results and reports success back to the browser client, updating the UI.

---

## 4. Resilience and Queue Logic

Migrating thousands of photos requires structural defenses against transient errors, rate limits, and network loss.

### A. Client-Driven Sequential Queue
Rather than batching files asynchronously (which would flood the Google Photos API, hit strict rate-limiting caps, and consume excess server memory), the frontend implements a **Strictly Sequential Upload Queue (`runQueue`)**. This ensures only one file is processed at a time.

### B. Dynamic Time Estimation
The system calculates transfer times dynamically based on a user-adjustable speed baseline:
$$\text{Estimated Time} = \text{Remaining Queue Count} \times \text{Average Transfer Speed (sec/file)}$$

Users can calibrate the estimation based on their network status:
- **Fast Network**: 1.5 seconds per file
- **Standard**: 3.0 seconds per file
- **Conservative**: 5.0 seconds per file
- **Slow Connection**: 8.0 seconds per file

This value is rendered dynamically in the staging overview and automatically counts down in real-time as the queue runs.

### C. Connection Guard (Online/Offline Monitor)
A window listener monitors network connection states:
- If a connection is lost during a transfer, the app triggers an auto-pause event immediately:
  `navigator.onLine === false` $\rightarrow$ `isPaused = true`.
- It prompts the user with a notification badge and a resume option once connection is restored.

### D. Consecutive Error Guard
To prevent recursive failures from exhausting API tokens, users can configure an error limit threshold:
- If consecutive errors reach the limit (e.g., 3 consecutive failures), the queue **automatically pauses**.
- Users can review the detailed REST error response directly inside the live log console, address permissions, and click **Resume Transfer** to continue right from where they left off.

### E. Persistent Sync History Dashboard
To maintain an audit trail, the application uses local storage persistence:
- **State Serialization**: At the start of a transfer, a unique `sessionId` is created. All statuses are written into a structured log collection.
- **LocalStorage Sync**: The queue logs the results of each asset (Success, Fail with detailed error response) to the browser's `localStorage` via a `drive_to_photos_sync_history` key.
- **Collapsible Audit Panel**: Users can expand previous sync sessions to review exact filenames, timestamps, album destinations, and specific errors encountered in past days or weeks.

---

## 5. Security & Isolation

- **Zero Persistence Server-Side**: The backend does not write, cache, or log file bytes to a local disk. Files exist solely in volatile RAM buffers while streaming.
- **No Shared Credentials**: Access tokens are supplied by the user's browser context and sent only as short-lived Bearer tokens. They are never kept on the server once the HTTP connection terminates.
