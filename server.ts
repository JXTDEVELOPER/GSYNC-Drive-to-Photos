import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper to extract Bearer token from Authorization header
function getAuthToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

// 1. Verify health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 2. List Google Drive folders
app.get('/api/drive/folders', async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing access token' });
  }

  const parentId = req.query.parentId as string || 'root';
  const search = req.query.search as string || '';

  try {
    let q = '';
    if (search) {
      // Escape single quotes in search query to prevent injection errors
      const escapedSearch = search.replace(/'/g, "\\'");
      q = `mimeType = 'application/vnd.google-apps.folder' and name contains '${escapedSearch}' and trashed = false`;
    } else {
      q = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=100`;
    
    const response = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Google Drive error: ${errorText}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('Error fetching folders from Drive:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// 3. List photos and videos in a specific Google Drive folder
app.get('/api/drive/folder-contents', async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing access token' });
  }

  const folderId = req.query.folderId as string;
  if (!folderId) {
    return res.status(400).json({ error: 'Missing folderId parameter' });
  }

  try {
    const q = `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`;
    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,thumbnailLink,createdTime)&pageSize=1000`;

    const response = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Google Drive error: ${errorText}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('Error fetching folder contents:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// 4. List Google Photos albums
app.get('/api/photos/albums', async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing access token' });
  }

  try {
    const photosUrl = 'https://photoslibrary.googleapis.com/v1/albums?pageSize=50';
    const response = await fetch(photosUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Google Photos error: ${errorText}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('Error fetching Google Photos albums:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// 5. Create a Google Photos album
app.post('/api/photos/albums', async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing access token' });
  }

  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing album name' });
  }

  try {
    const photosUrl = 'https://photoslibrary.googleapis.com/v1/albums';
    const response = await fetch(photosUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        album: { title: name },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Google Photos error: ${errorText}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('Error creating Google Photos album:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// 6. Transfer a single file from Google Drive to Google Photos
app.post('/api/photos/transfer-item', async (req, res) => {
  const token = getAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing access token' });
  }

  const { fileId, fileName, mimeType, albumId } = req.body;
  if (!fileId || !fileName) {
    return res.status(400).json({ error: 'Missing fileId or fileName' });
  }

  try {
    console.log(`Starting transfer for file: ${fileName} (${fileId})`);

    // Step A: Download the file from Google Drive
    const driveDownloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const driveRes = await fetch(driveDownloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!driveRes.ok) {
      const errorText = await driveRes.text();
      throw new Error(`Failed to download from Drive: ${driveRes.statusText} (${errorText})`);
    }

    const resolvedMimeType = driveRes.headers.get('content-type') || mimeType || 'application/octet-stream';
    const arrayBuffer = await driveRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`Downloaded ${fileName} from Drive (${buffer.length} bytes). Uploading to Google Photos...`);

    // Step B: Upload bytes to Google Photos uploads endpoint
    const photosUploadUrl = 'https://photoslibrary.googleapis.com/v1/uploads';
    const uploadRes = await fetch(photosUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'X-Goog-Upload-Content-Type': resolvedMimeType,
        'X-Goog-Upload-Protocol': 'raw',
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      throw new Error(`Failed to upload to Google Photos: ${uploadRes.statusText} (${errorText})`);
    }

    const uploadToken = await uploadRes.text();
    console.log(`Upload token acquired for ${fileName}. Creating media item...`);

    // Step C: Create the media item in Google Photos (and add to album if provided)
    const createUrl = 'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate';
    const createBody: any = {
      newMediaItems: [
        {
          description: 'Transferred from Google Drive',
          simpleMediaItem: {
            fileName,
            uploadToken,
          },
        },
      ],
    };

    if (albumId) {
      createBody.albumId = albumId;
    }

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      throw new Error(`Failed to create media item in Google Photos: ${createRes.statusText} (${errorText})`);
    }

    const createData = await createRes.json();
    const mediaItemResult = createData.newMediaItemResults?.[0];

    if (mediaItemResult?.status?.message && mediaItemResult.status.message !== 'Success') {
      throw new Error(`Google Photos creation failed: ${mediaItemResult.status.message}`);
    }

    console.log(`Successfully transferred ${fileName} to Google Photos!`);
    res.json({
      success: true,
      mediaItemId: mediaItemResult?.mediaItem?.id,
      fileName,
    });
  } catch (err: any) {
    console.error(`Error transferring file ${fileName}:`, err);
    res.status(500).json({ error: err.message || 'Failed to transfer item' });
  }
});

// Vite dev and prod setup
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
