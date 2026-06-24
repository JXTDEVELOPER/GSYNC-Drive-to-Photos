import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  FolderOpen, 
  ChevronRight, 
  Search, 
  Image as ImageIcon, 
  Video as VideoIcon, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  RefreshCw, 
  LogOut, 
  ArrowRightLeft, 
  Plus, 
  Home, 
  AlertCircle, 
  Check,
  Download,
  Upload,
  Layers,
  ArrowRight,
  Play,
  Pause,
  Wifi,
  WifiOff,
  Clock,
  Trash2,
  History,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, getAccessToken, setAccessToken } from './auth';

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  createdTime?: string;
}

interface DriveFileExtended extends DriveFile {
  folderId?: string;
  folderName?: string;
}

interface PhotosAlbum {
  id: string;
  title: string;
  productUrl?: string;
  mediaItemsCount?: string;
}

interface TransferLog {
  id: string;
  text: string;
  timestamp: string;
  type: 'info' | 'success' | 'error';
}

interface TransferItemStatus {
  id: string;
  name: string;
  mimeType: string;
  status: 'pending' | 'transferring' | 'success' | 'failed';
  error?: string;
}

interface HistoricSyncSession {
  id: string;
  timestamp: string;
  albumName: string;
  totalFiles: number;
  succeededCount: number;
  failedCount: number;
  status: 'completed' | 'stopped' | 'failed' | 'in_progress';
  items: {
    name: string;
    status: 'success' | 'failed' | 'pending';
    error?: string;
  }[];
}

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Folder Explorer state
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([
    { id: 'root', name: 'Drive Root' }
  ]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState('');

  // Selected Folders content
  const [selectedFolders, setSelectedFolders] = useState<DriveFolder[]>([]);
  const [folderContents, setFolderContents] = useState<DriveFileExtended[]>([]);
  const [loadingContents, setLoadingContents] = useState(false);
  const [contentsError, setContentsError] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  // Photos Album state
  const [albums, setAlbums] = useState<PhotosAlbum[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [albumMode, setAlbumMode] = useState<'new' | 'existing'>('new');
  const [newAlbumName, setNewAlbumName] = useState('');
  const [selectedAlbumId, setSelectedAlbumId] = useState('');

  // Global app status/message
  const [globalError, setGlobalError] = useState('');

  // Transfer Orchestrator state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const isTransferringRef = React.useRef(false);
  const [transferItems, setTransferItems] = useState<TransferItemStatus[]>([]);
  const [currentTransferIndex, setCurrentTransferIndex] = useState(0);
  const [transferLogs, setTransferLogs] = useState<TransferLog[]>([]);
  const [transferCompleted, setTransferCompleted] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Connection and Pause state
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = React.useRef(false);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [errorLimit, setErrorLimit] = useState(3);
  const [targetAlbumId, setTargetAlbumId] = useState<string>('');

  // Sync History & Time Estimation states
  const [syncHistory, setSyncHistory] = useState<HistoricSyncSession[]>([]);
  const [avgTransferSpeed, setAvgTransferSpeed] = useState<number>(3); // default 3s per file
  const activeSessionIdRef = React.useRef<string | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  // Load sync history from local storage on mount
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('drive_to_photos_sync_history');
      if (savedHistory) {
        setSyncHistory(JSON.parse(savedHistory));
      }
    } catch (err) {
      console.error('Failed to load sync history from localStorage:', err);
    }
  }, []);

  // Save sync history to local storage when changed
  useEffect(() => {
    try {
      localStorage.setItem('drive_to_photos_sync_history', JSON.stringify(syncHistory));
    } catch (err) {
      console.error('Failed to save sync history to localStorage:', err);
    }
  }, [syncHistory]);

  // Sync refs and manage online/offline status
  useEffect(() => {
    isTransferringRef.current = isTransferring;
  }, [isTransferring]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      addLog('Network connection restored!', 'success');
    };
    const handleOffline = () => {
      setIsOnline(false);
      // If actively transferring, auto-pause
      if (isTransferringRef.current && !isPausedRef.current) {
        setIsPaused(true);
        isPausedRef.current = true;
        setIsTransferring(false);
        addLog('Network connection lost! Automatically pausing transfer queue...', 'error');
      } else {
        addLog('Network connection offline.', 'error');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load initial auth
  useEffect(() => {
    initAuth(
      (currentUser, currentToken) => {
        setUser(currentUser);
        setToken(currentToken);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setToken(null);
        setNeedsAuth(true);
      }
    );
  }, []);

  // Fetch Drive folders when currentFolderId changes
  useEffect(() => {
    if (token) {
      fetchFolders(currentFolderId);
    }
  }, [currentFolderId, token]);

  // Fetch Google Photos albums when signed in
  useEffect(() => {
    if (token) {
      fetchAlbums();
    }
  }, [token]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setGlobalError('');
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      setGlobalError('Failed to sign in. Please allow required popup permissions.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setToken(null);
      setNeedsAuth(true);
      // Reset state
      setFolders([]);
      setCurrentFolderId('root');
      setBreadcrumbs([{ id: 'root', name: 'Drive Root' }]);
      setSelectedFolders([]);
      setFolderContents([]);
      setAlbums([]);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  // API Call Wrapper with Token Refresh guidance
  const apiFetch = async (url: string, options: RequestInit = {}) => {
    if (!token) throw new Error('Not authenticated');
    
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      // Access token might be expired. Instruct user to sign in again.
      setNeedsAuth(true);
      setGlobalError('Your login session has expired. Please sign in again.');
      throw new Error('Unauthorized');
    }
    return res;
  };

  const fetchFolders = async (parentId: string, search: string = '') => {
    setLoadingFolders(true);
    setSearchError('');
    try {
      let url = `/api/drive/folders?parentId=${parentId}`;
      if (search) {
        url = `/api/drive/folders?search=${encodeURIComponent(search)}`;
      }
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Failed to fetch folders');
      const data = await res.json();
      setFolders(data.files || []);
    } catch (err: any) {
      console.error('Error fetching folders:', err);
      setSearchError('Error loading folders. Please try again.');
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleSearchFolders = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      fetchFolders('root', searchQuery.trim());
    } else {
      fetchFolders(currentFolderId);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    fetchFolders(currentFolderId);
  };

  const navigateToFolder = (folderId: string, folderName: string) => {
    setSearchQuery('');
    if (folderId === 'root') {
      setBreadcrumbs([{ id: 'root', name: 'Drive Root' }]);
    } else {
      // If already in breadcrumbs, truncate after that
      const index = breadcrumbs.findIndex(b => b.id === folderId);
      if (index !== -1) {
        setBreadcrumbs(breadcrumbs.slice(0, index + 1));
      } else {
        setBreadcrumbs([...breadcrumbs, { id: folderId, name: folderName }]);
      }
    }
    setCurrentFolderId(folderId);
  };

  const toggleFolderSelection = async (folder: DriveFolder) => {
    const exists = selectedFolders.some(f => f.id === folder.id);
    
    if (exists) {
      // Deselect
      const updatedFolders = selectedFolders.filter(f => f.id !== folder.id);
      setSelectedFolders(updatedFolders);
      
      // Remove files of this folder from contents
      const remainingContents = folderContents.filter(file => file.folderId !== folder.id);
      setFolderContents(remainingContents);
      
      // Update selectedFileIds
      const fileIdsToRemove = folderContents
        .filter(file => file.folderId === folder.id)
        .map(file => file.id);
      const updatedFileIds = new Set(selectedFileIds);
      fileIdsToRemove.forEach(id => updatedFileIds.delete(id));
      setSelectedFileIds(updatedFileIds);
      
      // Update prefilled album name
      if (updatedFolders.length === 1) {
        setNewAlbumName(updatedFolders[0].name);
      } else if (updatedFolders.length > 1) {
        setNewAlbumName(`${updatedFolders[0].name} + ${updatedFolders.length - 1} folders`);
      } else {
        setNewAlbumName('');
      }
    } else {
      // Select
      const updatedFolders = [...selectedFolders, folder];
      setSelectedFolders(updatedFolders);
      setLoadingContents(true);
      setContentsError('');
      
      try {
        const res = await apiFetch(`/api/drive/folder-contents?folderId=${folder.id}`);
        if (!res.ok) throw new Error('Failed to fetch folder contents');
        const data = await res.json();
        const files: DriveFile[] = data.files || [];
        
        const extendedFiles: DriveFileExtended[] = files.map(f => ({
          ...f,
          folderId: folder.id,
          folderName: folder.name
        }));
        
        // Append new folder's contents
        setFolderContents(prev => [...prev, ...extendedFiles]);
        
        // Auto-select newly fetched files
        setSelectedFileIds(prev => {
          const updated = new Set(prev);
          extendedFiles.forEach(f => updated.add(f.id));
          return updated;
        });
        
        // Update prefilled album name
        if (updatedFolders.length === 1) {
          setNewAlbumName(updatedFolders[0].name);
        } else if (updatedFolders.length > 1) {
          setNewAlbumName(`${updatedFolders[0].name} + ${updatedFolders.length - 1} folders`);
        }
      } catch (err: any) {
        console.error('Error fetching contents:', err);
        setContentsError('Could not load files from this folder.');
      } finally {
        setLoadingContents(false);
      }
    }
  };

  const toggleAllFoldersInView = async () => {
    const allInViewSelected = folders.length > 0 && folders.every(f => selectedFolders.some(sf => sf.id === f.id));
    
    if (allInViewSelected) {
      // Deselect all folders in current view
      let updatedFolders = [...selectedFolders];
      let updatedContents = [...folderContents];
      let updatedFileIds = new Set(selectedFileIds);
      
      for (const folder of folders) {
        updatedFolders = updatedFolders.filter(f => f.id !== folder.id);
        updatedContents = updatedContents.filter(file => file.folderId !== folder.id);
        const fileIdsToRemove = folderContents
          .filter(file => file.folderId === folder.id)
          .map(file => file.id);
        fileIdsToRemove.forEach(id => updatedFileIds.delete(id));
      }
      
      setSelectedFolders(updatedFolders);
      setFolderContents(updatedContents);
      setSelectedFileIds(updatedFileIds);
      
      if (updatedFolders.length === 1) {
        setNewAlbumName(updatedFolders[0].name);
      } else if (updatedFolders.length > 1) {
        setNewAlbumName(`${updatedFolders[0].name} + ${updatedFolders.length - 1} folders`);
      } else {
        setNewAlbumName('');
      }
    } else {
      // Select all folders in current view that are NOT already selected
      const foldersToSelect = folders.filter(f => !selectedFolders.some(sf => sf.id === f.id));
      if (foldersToSelect.length === 0) return;
      
      setLoadingContents(true);
      setContentsError('');
      
      const newFolders = [...selectedFolders];
      const newFiles: DriveFileExtended[] = [];
      
      try {
        await Promise.all(foldersToSelect.map(async (folder) => {
          newFolders.push(folder);
          const res = await apiFetch(`/api/drive/folder-contents?folderId=${folder.id}`);
          if (res.ok) {
            const data = await res.json();
            const files: DriveFile[] = data.files || [];
            files.forEach(f => {
              newFiles.push({
                ...f,
                folderId: folder.id,
                folderName: folder.name
              });
            });
          }
        }));
        
        setSelectedFolders(newFolders);
        setFolderContents(prev => [...prev, ...newFiles]);
        setSelectedFileIds(prev => {
          const updated = new Set(prev);
          newFiles.forEach(f => updated.add(f.id));
          return updated;
        });
        
        if (newFolders.length === 1) {
          setNewAlbumName(newFolders[0].name);
        } else if (newFolders.length > 1) {
          setNewAlbumName(`${newFolders[0].name} + ${newFolders.length - 1} folders`);
        }
      } catch (err) {
        console.error('Error fetching some folder contents:', err);
        setContentsError('Could not load some files.');
      } finally {
        setLoadingContents(false);
      }
    }
  };

  const reloadSelectedFolders = async () => {
    if (selectedFolders.length === 0) return;
    setLoadingContents(true);
    setContentsError('');
    setFolderContents([]);
    setSelectedFileIds(new Set());
    
    const refreshedFiles: DriveFileExtended[] = [];
    try {
      await Promise.all(selectedFolders.map(async (folder) => {
        const res = await apiFetch(`/api/drive/folder-contents?folderId=${folder.id}`);
        if (res.ok) {
          const data = await res.json();
          const files: DriveFile[] = data.files || [];
          files.forEach(f => {
            refreshedFiles.push({
              ...f,
              folderId: folder.id,
              folderName: folder.name
            });
          });
        }
      }));
      setFolderContents(refreshedFiles);
      setSelectedFileIds(new Set(refreshedFiles.map(f => f.id)));
    } catch (err) {
      console.error('Error reloading contents:', err);
    } finally {
      setLoadingContents(false);
    }
  };

  const fetchAlbums = async () => {
    setLoadingAlbums(true);
    try {
      const res = await apiFetch('/api/photos/albums');
      if (res.ok) {
        const data = await res.json();
        setAlbums(data.albums || []);
      }
    } catch (err) {
      console.error('Error fetching albums:', err);
    } finally {
      setLoadingAlbums(false);
    }
  };

  const toggleFileSelection = (fileId: string) => {
    const updated = new Set(selectedFileIds);
    if (updated.has(fileId)) {
      updated.delete(fileId);
    } else {
      updated.add(fileId);
    }
    setSelectedFileIds(updated);
  };

  const toggleSelectAll = () => {
    if (selectedFileIds.size === folderContents.length) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(folderContents.map(f => f.id)));
    }
  };

  const formatSize = (bytesStr?: string) => {
    if (!bytesStr) return 'Unknown size';
    const bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes)) return 'Unknown size';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatEstimatedTime = (totalSeconds: number) => {
    if (totalSeconds < 60) {
      return `${Math.ceil(totalSeconds)}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.ceil(totalSeconds % 60);
    return `${minutes}m ${seconds}s`;
  };

  // Create the selected Google Photos album or verify existing
  const prepareAndStartTransfer = async () => {
    if (selectedFileIds.size === 0) {
      alert('Please select at least one photo or video to transfer.');
      return;
    }
    setShowConfirmModal(true);
  };

  const addLog = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    const newLog: TransferLog = {
      id: Math.random().toString(36).substring(7),
      text,
      timestamp: new Date().toLocaleTimeString(),
      type
    };
    setTransferLogs(prev => [newLog, ...prev]);
  };

  const executeTransfer = async () => {
    setShowConfirmModal(false);
    setIsTransferring(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setTransferCompleted(false);
    setPipelineError(null);
    setTransferLogs([]);
    setCurrentTransferIndex(0);
    setConsecutiveErrors(0);
    setTargetAlbumId('');

    const itemsToTransfer = folderContents.filter(f => selectedFileIds.has(f.id));
    
    // Set initial status of items
    const initialItemsStatus = itemsToTransfer.map(item => ({
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      status: 'pending' as const
    }));
    setTransferItems(initialItemsStatus);

    // Set active session ID and record a new entry in local history
    const sessionId = Math.random().toString(36).substring(7);
    activeSessionIdRef.current = sessionId;
    const albumTitle = albumMode === 'new'
      ? (newAlbumName.trim() || `${selectedFolders[0]?.name || 'Drive'} Album`)
      : (albums.find(a => a.id === selectedAlbumId)?.title || 'Selected Album');

    const newSession: HistoricSyncSession = {
      id: sessionId,
      timestamp: new Date().toLocaleString(),
      albumName: albumTitle,
      totalFiles: itemsToTransfer.length,
      succeededCount: 0,
      failedCount: 0,
      status: 'in_progress',
      items: itemsToTransfer.map(item => ({
        name: item.name,
        status: 'pending'
      }))
    };
    setSyncHistory(prev => [newSession, ...prev]);

    addLog(`Initiating transfer of ${itemsToTransfer.length} items...`, 'info');

    let targetAlbumIdStr = '';

    try {
      // Step 1: Handle Album Destination
      if (albumMode === 'new') {
        const albumTitleStr = newAlbumName.trim() || `${selectedFolders[0]?.name || 'Drive'} Album`;
        addLog(`Creating Google Photos album "${albumTitleStr}"...`, 'info');
        
        const createAlbumRes = await apiFetch('/api/photos/albums', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: albumTitleStr })
        });

        if (!createAlbumRes.ok) {
          let errMsg = '';
          const resText = await createAlbumRes.text();
          try {
            const errJson = JSON.parse(resText);
            errMsg = errJson.error || JSON.stringify(errJson);
          } catch {
            errMsg = resText;
          }
          throw new Error(errMsg);
        }

        const albumData = await createAlbumRes.json();
        targetAlbumIdStr = albumData.id;
        setTargetAlbumId(targetAlbumIdStr);
        addLog(`Album created successfully! (ID: ${targetAlbumIdStr})`, 'success');
        
        // Add to local album list
        setAlbums(prev => [albumData, ...prev]);
      } else {
        targetAlbumIdStr = selectedAlbumId;
        setTargetAlbumId(targetAlbumIdStr);
        const albumName = albums.find(a => a.id === selectedAlbumId)?.title || 'Selected Album';
        addLog(`Using existing Google Photos album "${albumName}"`, 'info');
      }

      // Start processing the queue
      await runQueue(0, targetAlbumIdStr, initialItemsStatus);
    } catch (err: any) {
      console.error('Fatal transfer pipeline error:', err);
      addLog(`Fatal Pipeline Error: ${err.message}`, 'error');
      setPipelineError(err.message);
      setIsTransferring(false);
      setTransferCompleted(true);

      // Mark session as failed in history
      setSyncHistory(prev => prev.map(session => {
        if (session.id === activeSessionIdRef.current) {
          return {
            ...session,
            status: 'failed'
          };
        }
        return session;
      }));
    }
  };

  const runQueue = async (startIndex: number, albumIdToUse: string, itemsOverride?: TransferItemStatus[]) => {
    setIsTransferring(true);
    setIsPaused(false);
    isPausedRef.current = false;

    const currentItems = itemsOverride ? [...itemsOverride] : [...transferItems];
    let localConsecErrors = 0;

    for (let i = startIndex; i < currentItems.length; i++) {
      // Dynamic pause check
      if (isPausedRef.current) {
        addLog(`Transfer queue paused at item ${i + 1}.`, 'info');
        // Mark active session as stopped
        setSyncHistory(prev => prev.map(session => {
          if (session.id === activeSessionIdRef.current) {
            return { ...session, status: 'stopped' };
          }
          return session;
        }));
        break;
      }

      // Dynamic network check
      if (!navigator.onLine) {
        setIsPaused(true);
        isPausedRef.current = true;
        setIsTransferring(false);
        addLog('Network connection lost! Automatically pausing transfer queue...', 'error');
        // Mark active session as stopped
        setSyncHistory(prev => prev.map(session => {
          if (session.id === activeSessionIdRef.current) {
            return { ...session, status: 'stopped' };
          }
          return session;
        }));
        break;
      }

      const item = currentItems[i];
      if (item.status === 'success') {
        continue;
      }

      setCurrentTransferIndex(i);

      // Update status to transferring
      setTransferItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'transferring' } : p));
      addLog(`[${i + 1}/${currentItems.length}] Processing "${item.name}"...`, 'info');

      try {
        const res = await apiFetch('/api/photos/transfer-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId: item.id,
            fileName: item.name,
            mimeType: item.mimeType,
            albumId: albumIdToUse
          })
        });

        if (!res.ok) {
          let errMsg = '';
          const resText = await res.text();
          try {
            const errJson = JSON.parse(resText);
            errMsg = errJson.error || JSON.stringify(errJson);
          } catch {
            errMsg = resText;
          }
          throw new Error(errMsg);
        }

        // Complete item transfer
        setTransferItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'success', error: undefined } : p));
        currentItems[i].status = 'success';
        addLog(`Successfully transferred "${item.name}"`, 'success');

        // Update in syncHistory
        setSyncHistory(prev => prev.map(session => {
          if (session.id === activeSessionIdRef.current) {
            return {
              ...session,
              succeededCount: session.succeededCount + 1,
              items: session.items.map(si => si.name === item.name ? { ...si, status: 'success' } : si)
            };
          }
          return session;
        }));

        // Reset consecutive errors
        localConsecErrors = 0;
        setConsecutiveErrors(0);
      } catch (err: any) {
        console.error(`Error transferring ${item.name}:`, err);
        setTransferItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'failed', error: err.message } : p));
        currentItems[i].status = 'failed';
        addLog(`Error transferring "${item.name}": ${err.message}`, 'error');

        // Update in syncHistory
        setSyncHistory(prev => prev.map(session => {
          if (session.id === activeSessionIdRef.current) {
            return {
              ...session,
              failedCount: session.failedCount + 1,
              items: session.items.map(si => si.name === item.name ? { ...si, status: 'failed', error: err.message } : si)
            };
          }
          return session;
        }));

        localConsecErrors += 1;
        setConsecutiveErrors(localConsecErrors);

        if (localConsecErrors >= errorLimit) {
          setIsPaused(true);
          isPausedRef.current = true;
          setIsTransferring(false);
          addLog(`Consecutive error limit (${errorLimit}) reached! Automatically pausing transfer queue...`, 'error');
          // Update status to stopped/paused
          setSyncHistory(prev => prev.map(session => {
            if (session.id === activeSessionIdRef.current) {
              return { ...session, status: 'stopped' };
            }
            return session;
          }));
          break;
        }
      }
    }

    // Check if everything is processed
    const allProcessed = !isPausedRef.current && !currentItems.some(item => item.status === 'pending' || item.status === 'transferring');
    if (allProcessed) {
      addLog('All items processed!', 'success');
      setTransferCompleted(true);
      setIsTransferring(false);
      fetchAlbums();

      // Update session status in history
      setSyncHistory(prev => prev.map(session => {
        if (session.id === activeSessionIdRef.current) {
          return {
            ...session,
            status: 'completed'
          };
        }
        return session;
      }));
    } else {
      setIsTransferring(false);
    }
  };

  const handlePause = () => {
    setIsPaused(true);
    isPausedRef.current = true;
    setIsTransferring(false);
    addLog('Pausing transfer queue... (the current item will finish processing)', 'info');
  };

  const handleResume = async () => {
    if (!navigator.onLine) {
      addLog('Cannot resume while offline. Please check your network connection.', 'error');
      return;
    }
    addLog('Resuming transfer queue...', 'info');
    setIsPaused(false);
    isPausedRef.current = false;
    setIsTransferring(true);
    setConsecutiveErrors(0);
    await runQueue(currentTransferIndex, targetAlbumId);
  };

  const toggleSessionExpand = (id: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClearHistory = () => {
    if (window.confirm("Are you sure you want to clear your local sync history? This cannot be undone.")) {
      setSyncHistory([]);
      localStorage.removeItem('drive_to_photos_sync_history');
    }
  };

  const countCompleted = transferItems.filter(i => i.status === 'success').length;
  const countFailed = transferItems.filter(i => i.status === 'failed').length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col antialiased">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 text-white p-2.5 rounded-xl flex items-center justify-center shadow-md shadow-blue-100">
              <ArrowRightLeft className="h-6 w-6" />
            </div>
            <div>
              <h1 id="app-title" className="text-xl font-bold tracking-tight text-slate-900">
                Drive to Photos Transfer
              </h1>
              <p className="text-xs text-slate-500 font-mono hidden sm:block">
                Direct Cloud-to-Cloud Sync Panel
              </p>
            </div>
          </div>

          {!needsAuth && user && (
            <div className="flex items-center space-x-4 bg-slate-100/80 px-3.5 py-1.5 rounded-full border border-slate-200">
              {user.photoURL && (
                <img 
                  referrerPolicy="no-referrer"
                  src={user.photoURL} 
                  alt={user.displayName || 'Google User'} 
                  className="w-7 h-7 rounded-full object-cover border border-slate-300"
                />
              )}
              <div className="text-right hidden md:block">
                <p className="text-xs font-semibold text-slate-800">{user.displayName}</p>
                <p className="text-[10px] text-slate-500 font-mono">{user.email}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="text-slate-500 hover:text-rose-600 transition-colors p-1 rounded-full hover:bg-slate-200"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        {globalError && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start space-x-3 text-rose-800 shadow-xs animate-in fade-in slide-in-from-top-3">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-rose-600" />
            <div className="flex-1">
              <h4 className="font-semibold text-sm">Action Needed</h4>
              <p className="text-xs mt-0.5">{globalError}</p>
            </div>
            <button 
              onClick={() => setGlobalError('')}
              className="text-rose-500 hover:text-rose-800 text-xs font-semibold self-center"
            >
              Dismiss
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {needsAuth ? (
            /* --- LANDING / AUTHENTICATION PAGE --- */
            <motion.div 
              key="auth-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="flex-1 flex flex-col items-center justify-center max-w-lg mx-auto py-12"
            >
              <div className="text-center space-y-6">
                <div className="inline-flex space-x-4 bg-white p-4 rounded-3xl border border-slate-200 shadow-md">
                  <div className="bg-amber-100 text-amber-700 p-3.5 rounded-2xl">
                    <FolderOpen className="h-8 w-8" />
                  </div>
                  <div className="bg-slate-100 text-slate-400 p-3.5 rounded-2xl flex items-center justify-center">
                    <ArrowRight className="h-6 w-6" />
                  </div>
                  <div className="bg-blue-100 text-blue-700 p-3.5 rounded-2xl">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                </div>

                <div className="space-y-2">
                  <h2 className="text-3xl font-extrabold tracking-tight text-slate-950">
                    Connect Google Drive & Photos
                  </h2>
                  <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
                    Select any folder in your Google Drive and import all its photos & videos directly into a Google Photos album. Fast, convenient, and strictly client-orchestrated.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-left space-y-3.5 shadow-sm">
                  <h4 className="text-xs font-bold text-slate-500 tracking-wider uppercase">How it works:</h4>
                  <ul className="space-y-3 text-xs text-slate-600">
                    <li className="flex items-start space-x-2.5">
                      <div className="bg-blue-50 text-blue-600 rounded-full p-0.5 mt-0.5 shrink-0">
                        <Check className="h-3 w-3" />
                      </div>
                      <span>Select any directory of assets inside your Google Drive.</span>
                    </li>
                    <li className="flex items-start space-x-2.5">
                      <div className="bg-blue-50 text-blue-600 rounded-full p-0.5 mt-0.5 shrink-0">
                        <Check className="h-3 w-3" />
                      </div>
                      <span>Choose to create a <strong>new Photos Album</strong> or add to an <strong>existing one</strong>.</span>
                    </li>
                    <li className="flex items-start space-x-2.5">
                      <div className="bg-blue-50 text-blue-600 rounded-full p-0.5 mt-0.5 shrink-0">
                        <Check className="h-3 w-3" />
                      </div>
                      <span>The cloud proxy will stream each photo & video safely without ever leaking data.</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-4 flex flex-col items-center">
                  <button 
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    className="gsi-material-button w-full sm:w-auto shadow-sm"
                    id="sign-in-btn"
                  >
                    <div className="gsi-material-button-state"></div>
                    <div className="gsi-material-button-content-wrapper">
                      <div className="gsi-material-button-icon">
                        {isLoggingIn ? (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                        ) : (
                          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                          </svg>
                        )}
                      </div>
                      <span className="gsi-material-button-contents">
                        {isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
                      </span>
                    </div>
                  </button>
                  <p className="text-[10px] text-slate-400 mt-3 text-center leading-relaxed">
                    By signing in, you grant this application permission to browse your Drive folders and create/add photos to your Google Photos albums.
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (isTransferring || transferCompleted || isPaused) ? (
            /* --- ACTIVE TRANSFER PROGRESS SCREEN --- */
            <motion.div 
              key="transfer-view"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col space-y-6"
            >
              {/* Overall Progress Panel */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-2 items-center">
                      {isPaused ? (
                        <div className="inline-flex items-center px-3 py-1 bg-amber-50 text-amber-700 text-xs font-semibold rounded-full border border-amber-200">
                          <Pause className="h-3 w-3 mr-1.5" />
                          Queue Paused
                        </div>
                      ) : isTransferring ? (
                        <div className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-100 animate-pulse">
                          <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                          Transferring Assets
                        </div>
                      ) : (
                        <div className="inline-flex items-center px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full border border-emerald-100">
                          <CheckCircle2 className="h-3 w-3 mr-1.5 text-emerald-600" />
                          Transfer Completed
                        </div>
                      )}

                      {/* Connection status badge */}
                      {isOnline ? (
                        <div className="inline-flex items-center px-3 py-1 bg-slate-100 text-slate-700 text-xs font-semibold rounded-full border border-slate-200">
                          <Wifi className="h-3 w-3 mr-1.5 text-emerald-600" />
                          Online
                        </div>
                      ) : (
                        <div className="inline-flex items-center px-3 py-1 bg-rose-50 text-rose-700 text-xs font-semibold rounded-full border border-rose-200 animate-pulse">
                          <WifiOff className="h-3 w-3 mr-1.5 text-rose-600" />
                          Offline
                        </div>
                      )}
                    </div>
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 mt-2">
                      {albumMode === 'new' ? `Creating: "${newAlbumName}"` : 'Syncing to Existing Album'}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Origin: <span className="font-mono">{selectedFolders.map(f => f.name).join(', ')}</span> folders on Drive
                    </p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex gap-6 text-center shadow-2xs">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Processed</p>
                      <p className="text-xl font-black text-slate-800 mt-1">
                        {currentTransferIndex + (transferCompleted && countFailed === 0 ? transferItems.length : 0)} / {transferItems.length}
                      </p>
                    </div>
                    <div className="w-px bg-slate-200"></div>
                    <div>
                      <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Succeeded</p>
                      <p className="text-xl font-black text-emerald-600 mt-1">{countCompleted}</p>
                    </div>
                    <div className="w-px bg-slate-200"></div>
                    <div>
                      <p className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">Failed</p>
                      <p className="text-xl font-black text-rose-600 mt-1">{countFailed}</p>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-8">
                  <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden border border-slate-200/50">
                    <motion.div 
                      className={`h-full ${isTransferring ? 'bg-blue-600' : countFailed > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      initial={{ width: 0 }}
                      animate={{ 
                        width: `${transferItems.length > 0 ? ((countCompleted + countFailed) / transferItems.length) * 100 : 0}%` 
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mt-2.5">
                    <p className="text-xs font-semibold text-slate-600">
                      {transferItems.length > 0 ? Math.round(((countCompleted + countFailed) / transferItems.length) * 100) : 0}% Complete
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 font-mono">
                      <span>{transferItems.length - (countCompleted + countFailed)} items remaining</span>
                      <span className="text-slate-300">|</span>
                      {transferCompleted ? (
                        <span className="text-emerald-600 font-semibold flex items-center">
                          <Check className="h-3 w-3 mr-1" />
                          Done
                        </span>
                      ) : (
                        <span className="text-blue-600 font-semibold flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          Est. Remaining: ~{formatEstimatedTime((transferItems.length - (countCompleted + countFailed)) * avgTransferSpeed)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {isPaused && (
                  <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start space-x-3 text-amber-900 animate-in fade-in slide-in-from-top-2 animate-pulse">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600" />
                    <div>
                      <h4 className="font-bold text-sm">Transfer Queue Paused</h4>
                      <p className="text-xs mt-0.5 leading-relaxed">
                        {!isOnline ? (
                          <>
                            <strong>Network Connection Lost:</strong> Your internet connection appears to be offline. We have paused your transfer queue to prevent data loss. Please reconnect and click <strong>Resume Transfer</strong>.
                          </>
                        ) : consecutiveErrors >= errorLimit ? (
                          <>
                            <strong>Error Limit Reached:</strong> The transfer queue has been paused because we encountered <strong>{consecutiveErrors} consecutive errors</strong> (Limit: {errorLimit}). Check the execution console logs below to diagnose the issue, then click <strong>Resume Transfer</strong> when you're ready.
                          </>
                        ) : (
                          <>
                            The transfer queue is currently paused. You can review the logs below and resume whenever you're ready.
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {/* Control Action Buttons (Pause / Resume / Cancel) */}
                {!transferCompleted && (
                  <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                    <div className="text-left">
                      <p className="text-xs font-bold text-slate-700">Queue Controls</p>
                      <p className="text-2xs text-slate-400 mt-0.5">
                        {isPaused 
                          ? "The queue is paused. You can resume at any time." 
                          : "Uploads are running sequentially. You can pause the transfer safely."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 w-full sm:w-auto">
                      {isPaused ? (
                        <button
                          onClick={handleResume}
                          disabled={!isOnline}
                          className="flex-1 sm:flex-none px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Resume Transfer
                        </button>
                      ) : (
                        <button
                          onClick={handlePause}
                          className="flex-1 sm:flex-none px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5"
                        >
                          <Pause className="h-3.5 w-3.5" />
                          Pause Transfer
                        </button>
                      )}
                      
                      <button
                        onClick={() => {
                          setIsTransferring(false);
                          setIsPaused(false);
                          isPausedRef.current = false;
                          setTransferCompleted(true);
                          addLog("Transfer session terminated by user.", "info");
                          
                          // Update session status in history
                          setSyncHistory(prev => prev.map(session => {
                            if (session.id === activeSessionIdRef.current) {
                              return {
                                ...session,
                                status: 'stopped'
                              };
                            }
                            return session;
                          }));
                        }}
                        className="flex-1 sm:flex-none px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs border border-slate-200 rounded-xl transition-all flex items-center justify-center gap-1.5"
                      >
                        Stop Queue
                      </button>
                    </div>
                  </div>
                )}

                {pipelineError && (pipelineError.includes('403') || pipelineError.toLowerCase().includes('forbidden') || pipelineError.toLowerCase().includes('permission') || pipelineError.toLowerCase().includes('unauthorized')) ? (
                  <div className="mt-6 p-5 bg-rose-50/80 border border-rose-200 rounded-2xl text-slate-800 animate-in fade-in slide-in-from-top-3">
                    <div className="flex items-start space-x-3">
                      <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                      <div className="space-y-3 flex-1">
                        <div>
                          <h4 className="font-bold text-rose-900 text-sm flex items-center gap-1.5">
                            Google Photos API Access Denied (403 Forbidden)
                          </h4>
                          <p className="text-xs text-rose-700/90 mt-1 leading-relaxed">
                            This error typically means the <strong>Google Photos Library API</strong> has not been enabled for your Google Cloud Project, or the required OAuth credentials/scopes are restricted.
                          </p>
                        </div>
                        
                        <div className="bg-white/80 border border-rose-100 rounded-xl p-4 space-y-2.5 text-xs text-slate-700">
                          <p className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">
                            How to fix this in your Google Cloud Console:
                          </p>
                          <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                            <li>
                              Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline">Google Cloud Console</a>.
                            </li>
                            <li>
                              Ensure your project <code className="bg-slate-100 px-1 py-0.5 rounded text-rose-600 font-mono text-[10px] font-bold">smart-parking-alert-e552c</code> is selected in the top project dropdown.
                            </li>
                            <li>
                              In the left navigation menu, click <strong>APIs & Services</strong> &gt; <strong>Library</strong>.
                            </li>
                            <li>
                              Search for <strong className="text-slate-900">"Photos Library API"</strong>, click on it, and click the blue <strong className="text-slate-900">Enable</strong> button.
                            </li>
                            <li>
                              Go to the <strong>OAuth consent screen</strong> tab under APIs & Services, make sure you have added the necessary Photos scopes, and that your developer email (<code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[10px] bg-slate-200">{user?.email}</code>) is listed as a <strong>Test User</strong> if the publishing status is "Testing".
                            </li>
                          </ol>
                          <p className="text-[11px] text-slate-500 font-medium pt-1 border-t border-slate-100 mt-2">
                            💡 After enabling the API, please click <strong>Sign Out</strong> at the top right, then sign back in to issue a fresh access token with the newly enabled permissions.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : pipelineError ? (
                  <div className="mt-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start space-x-3 text-rose-800 animate-in fade-in slide-in-from-top-3">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-rose-600" />
                    <div>
                      <h4 className="font-semibold text-sm">Transfer Pipeline Interrupted</h4>
                      <p className="text-xs mt-0.5 leading-relaxed">{pipelineError}</p>
                    </div>
                  </div>
                ) : null}

                {transferCompleted && (
                  <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
                    <div className="text-xs text-slate-500">
                      {countFailed > 0 ? (
                        <span className="text-amber-700 font-medium flex items-center">
                          <AlertCircle className="h-4 w-4 mr-1.5 shrink-0" />
                          Transfer finished with {countFailed} failure(s). You can retry failed items or check logs.
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium flex items-center">
                          <CheckCircle2 className="h-4 w-4 mr-1.5 shrink-0" />
                          All items transferred successfully!
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        // Reset transfer states and refresh
                        setIsTransferring(false);
                        setTransferCompleted(false);
                        reloadSelectedFolders();
                      }}
                      className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Back to Dashboard
                    </button>
                  </div>
                )}
              </div>

              {/* Grid Logs & Status List */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Status List */}
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl flex flex-col overflow-hidden shadow-xs">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center">
                      <Layers className="h-4 w-4 mr-1.5 text-slate-400" />
                      File Sync Status
                    </h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-200 text-slate-600 rounded-md font-bold">
                      Queue
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[350px] p-4 divide-y divide-slate-100">
                    {transferItems.map((item, index) => (
                      <div key={item.id} className="py-2.5 flex items-center justify-between gap-4 text-xs">
                        <div className="flex items-center space-x-3 min-w-0">
                          {item.mimeType.startsWith('video/') ? (
                            <VideoIcon className="h-4 w-4 text-purple-500 shrink-0" />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-sky-500 shrink-0" />
                          )}
                          <span className="font-medium text-slate-700 truncate" title={item.name}>
                            {item.name}
                          </span>
                        </div>
                        <div className="shrink-0">
                          {item.status === 'pending' && (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-400 font-medium rounded-full text-[10px]">
                              Pending
                            </span>
                          )}
                          {item.status === 'transferring' && (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 font-semibold rounded-full text-[10px] flex items-center">
                              <Loader2 className="h-3 w-3 animate-spin mr-1 shrink-0" />
                              Syncing
                            </span>
                          )}
                          {item.status === 'success' && (
                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold rounded-full text-[10px] flex items-center">
                              <Check className="h-3 w-3 mr-1 shrink-0" />
                              Ready
                            </span>
                          )}
                          {item.status === 'failed' && (
                            <span className="px-2 py-0.5 bg-rose-50 text-rose-700 font-semibold rounded-full text-[10px] flex items-center" title={item.error}>
                              <XCircle className="h-3 w-3 mr-1 shrink-0" />
                              Failed
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live Console Logs */}
                <div className="bg-slate-900 border border-slate-950 rounded-3xl flex flex-col overflow-hidden shadow-md text-slate-300 font-mono text-xs">
                  <div className="p-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
                    <h3 className="text-2xs font-extrabold uppercase tracking-widest text-slate-400">
                      Execution Console
                    </h3>
                    <div className="flex space-x-1">
                      <span className="w-2.5 h-2.5 bg-rose-500 rounded-full"></span>
                      <span className="w-2.5 h-2.5 bg-amber-500 rounded-full"></span>
                      <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full"></span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[350px] p-4 space-y-2 flex flex-col-reverse">
                    {transferLogs.length === 0 ? (
                      <p className="text-slate-500 text-2xs italic text-center py-8">Awaiting commands...</p>
                    ) : (
                      transferLogs.map(log => (
                        <div key={log.id} className="leading-relaxed">
                          <span className="text-slate-500 text-[10px] mr-1.5">[{log.timestamp}]</span>
                          <span className={
                            log.type === 'success' ? 'text-emerald-400' :
                            log.type === 'error' ? 'text-rose-400 font-bold' :
                            'text-slate-300'
                          }>
                            {log.text}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            /* --- BROWSER / CONTROL BOARD PANEL --- */
            <motion.div 
              key="dashboard-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col space-y-8 flex-1"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              {/* Left Column: Drive Folder Picker (lg:col-span-5) */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 flex flex-col min-h-[500px] shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <FolderOpen className="h-5 w-5 text-amber-500 shrink-0" />
                    <h3 className="font-extrabold text-slate-900 tracking-tight text-sm">
                      1. Browse Google Drive
                    </h3>
                  </div>
                  {folders.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAllFoldersInView}
                      className="text-xs text-blue-600 hover:text-blue-800 font-bold tracking-normal transition-colors"
                    >
                      {folders.every(f => selectedFolders.some(sf => sf.id === f.id)) ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>

                {/* Folder search form */}
                <form onSubmit={handleSearchFolders} className="relative mb-4 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input 
                      type="text"
                      placeholder="Search folders globally..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-8 text-xs focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all placeholder:text-slate-400"
                    />
                    {searchQuery && (
                      <button 
                        type="button"
                        onClick={clearSearch}
                        className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-slate-600 font-medium"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <button 
                    type="submit"
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
                  >
                    Search
                  </button>
                </form>

                {/* Breadcrumbs */}
                <div className="flex items-center space-x-1.5 overflow-x-auto pb-3 mb-2 border-b border-slate-100 text-xs text-slate-500 scrollbar-none shrink-0">
                  <button 
                    onClick={() => navigateToFolder('root', 'Drive Root')}
                    className="hover:text-blue-600 font-medium transition-colors shrink-0 flex items-center"
                  >
                    <Home className="h-3 w-3 mr-1" />
                    Root
                  </button>
                  {breadcrumbs.slice(1).map((crumb) => (
                    <div key={crumb.id} className="flex items-center space-x-1.5 shrink-0">
                      <ChevronRight className="h-3 w-3 text-slate-300" />
                      <button 
                        onClick={() => navigateToFolder(crumb.id, crumb.name)}
                        className="hover:text-blue-600 font-medium transition-colors truncate max-w-[80px]"
                        title={crumb.name}
                      >
                        {crumb.name}
                      </button>
                    </div>
                  ))}
                </div>

                {/* Folders List */}
                <div className="flex-1 overflow-y-auto max-h-[380px] space-y-1.5 pr-1 mt-2">
                  {loadingFolders ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                      <span className="text-xs font-medium">Scanning Drive folders...</span>
                    </div>
                  ) : searchError ? (
                    <div className="text-center py-12 text-slate-500 text-xs">
                      <AlertCircle className="h-5 w-5 text-rose-500 mx-auto mb-2" />
                      {searchError}
                    </div>
                  ) : folders.length === 0 ? (
                    <div className="text-center py-16 text-slate-400 text-xs">
                      {searchQuery ? 'No matching folders found.' : 'This directory contains no subfolders.'}
                    </div>
                  ) : (
                    folders.map((folder) => {
                      const isCurrentlySelected = selectedFolders.some(sf => sf.id === folder.id);
                      return (
                        <div 
                          key={folder.id}
                          onClick={() => toggleFolderSelection(folder)}
                          className={`group w-full p-3 rounded-2xl text-left border flex items-center justify-between cursor-pointer transition-all duration-200 ${
                            isCurrentlySelected 
                              ? 'bg-blue-50/70 border-blue-200 shadow-2xs' 
                              : 'bg-white border-slate-100 hover:bg-slate-50 hover:border-slate-200'
                          }`}
                        >
                          <div className="flex items-center space-x-3 min-w-0">
                            <input 
                              type="checkbox"
                              checked={isCurrentlySelected}
                              onChange={() => {}} // Handled by outer click
                              className="h-3.5 w-3.5 text-blue-600 border-slate-300 rounded-md focus:ring-blue-500 shrink-0 pointer-events-none"
                            />
                            <div className={`p-2 rounded-xl transition-colors ${
                              isCurrentlySelected 
                                ? 'bg-blue-100 text-blue-700' 
                                : 'bg-amber-50 text-amber-600 group-hover:bg-amber-100'
                            }`}>
                              <Folder className="h-4.5 w-4.5 shrink-0" />
                            </div>
                            <div className="min-w-0">
                              <p className={`text-xs font-semibold truncate ${
                                isCurrentlySelected ? 'text-blue-900' : 'text-slate-800'
                              }`}>
                                {folder.name}
                              </p>
                              <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                                ID: {folder.id.substring(0, 10)}...
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigateToFolder(folder.id, folder.name);
                              }}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-[10px] rounded-lg transition-colors flex items-center"
                              title="Enter folder to view nested subfolders"
                            >
                              Enter
                              <ChevronRight className="h-3 w-3 ml-0.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Files List & Album Settings (lg:col-span-7) */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 flex flex-col min-h-[500px] shadow-xs">
                {selectedFolders.length > 0 ? (
                  <div className="flex-1 flex flex-col space-y-6">
                    {/* Folder Info Banner */}
                    <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex flex-col gap-3 shrink-0 animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Selected Folders ({selectedFolders.length})</span>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Photos and videos from these folders are merged below
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold text-slate-700">
                            {selectedFileIds.size} / {folderContents.length} selected
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Ready to transfer
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-1.5">
                        {selectedFolders.map(folder => (
                          <div 
                            key={folder.id}
                            className="inline-flex items-center bg-blue-50 text-blue-800 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-blue-100 gap-1"
                          >
                            <Folder className="w-3 h-3 text-blue-600 shrink-0" />
                            <span className="truncate max-w-[120px]">{folder.name}</span>
                            <button 
                              onClick={() => toggleFolderSelection(folder)}
                              className="text-blue-400 hover:text-blue-800 transition-colors p-0.5 rounded-full hover:bg-blue-100 font-bold"
                              title="Deselect folder"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button 
                          onClick={() => {
                            setSelectedFolders([]);
                            setFolderContents([]);
                            setSelectedFileIds(new Set());
                          }}
                          className="text-[11px] text-rose-600 hover:text-rose-800 font-bold ml-1 hover:underline self-center"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>

                    {/* Content view with split lists */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-0 items-stretch">
                      {/* Left Block: Check and Select Files */}
                      <div className="flex flex-col border border-slate-150 rounded-2xl overflow-hidden bg-white">
                        <div className="p-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between text-2xs font-extrabold uppercase tracking-wider text-slate-500 shrink-0">
                          <span className="flex items-center">
                            Files in Folder
                          </span>
                          <button 
                            onClick={toggleSelectAll}
                            className="text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                          >
                            {selectedFileIds.size === folderContents.length ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto max-h-[250px] p-2 divide-y divide-slate-100">
                          {loadingContents ? (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                              <span className="text-2xs font-semibold">Reading assets...</span>
                            </div>
                          ) : contentsError ? (
                            <p className="text-center py-8 text-rose-500 text-xs font-medium">{contentsError}</p>
                          ) : folderContents.length === 0 ? (
                            <div className="text-center py-12 text-slate-400 text-xs">
                              <AlertCircle className="h-5 w-5 mx-auto mb-2 text-slate-300" />
                              No photos or videos found in this folder.
                            </div>
                          ) : (
                            folderContents.map((file) => {
                              const isChecked = selectedFileIds.has(file.id);
                              const isVideo = file.mimeType.startsWith('video/');
                              return (
                                <div 
                                  key={file.id}
                                  onClick={() => toggleFileSelection(file.id)}
                                  className={`p-2.5 flex items-center justify-between text-xs cursor-pointer transition-colors hover:bg-slate-50/80 ${
                                    isChecked ? 'bg-blue-50/20' : ''
                                  }`}
                                >
                                  <div className="flex items-center space-x-2.5 min-w-0">
                                    <input 
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {}} // Handled by outer click
                                      className="h-3.5 w-3.5 text-blue-600 border-slate-300 rounded-md focus:ring-blue-500"
                                    />
                                    {file.thumbnailLink ? (
                                      <img 
                                        src={file.thumbnailLink} 
                                        alt="" 
                                        className="w-8 h-8 rounded-md object-cover border border-slate-200 shrink-0"
                                        referrerPolicy="no-referrer"
                                      />
                                    ) : isVideo ? (
                                      <div className="w-8 h-8 bg-purple-50 text-purple-600 rounded-md flex items-center justify-center shrink-0 border border-purple-100">
                                        <VideoIcon className="h-4 w-4" />
                                      </div>
                                    ) : (
                                      <div className="w-8 h-8 bg-sky-50 text-sky-600 rounded-md flex items-center justify-center shrink-0 border border-sky-100">
                                        <ImageIcon className="h-4 w-4" />
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <p className="font-semibold text-slate-700 truncate" title={file.name}>
                                        {file.name}
                                      </p>
                                      <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[200px]" title={`${formatSize(file.size)}${file.folderName ? ` • in ${file.folderName}` : ''}`}>
                                        {formatSize(file.size)} {file.folderName ? `• ${file.folderName}` : ''}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* Right Block: Configure Google Photos destination */}
                      <div className="flex flex-col space-y-4">
                        <div className="space-y-1">
                          <label className="text-2xs font-extrabold uppercase tracking-wider text-slate-500">
                            2. Destination Album
                          </label>
                          <div className="grid grid-cols-2 gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => setAlbumMode('new')}
                              className={`p-2.5 border text-xs font-bold rounded-xl transition-all ${
                                albumMode === 'new'
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              Create New Album
                            </button>
                            <button
                              type="button"
                              onClick={() => setAlbumMode('existing')}
                              className={`p-2.5 border text-xs font-bold rounded-xl transition-all ${
                                albumMode === 'existing'
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              Add to Existing
                            </button>
                          </div>
                        </div>

                        {albumMode === 'new' ? (
                          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1">
                            <label className="text-[11px] font-semibold text-slate-600">
                              Album Title
                            </label>
                            <input
                              type="text"
                              value={newAlbumName}
                              onChange={(e) => setNewAlbumName(e.target.value)}
                              placeholder="E.g. Summer Vacation 2025"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                            />
                            <p className="text-[10px] text-slate-400 leading-normal">
                              We'll automatically establish this album on Google Photos and upload your chosen images/videos there.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1">
                            <div className="flex items-center justify-between">
                              <label className="text-[11px] font-semibold text-slate-600">
                                Select Existing Album
                              </label>
                              <button 
                                onClick={fetchAlbums}
                                className="text-[10px] text-blue-600 hover:text-blue-800 font-bold flex items-center"
                                title="Refresh album list"
                              >
                                <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                                Refresh
                              </button>
                            </div>
                            {loadingAlbums ? (
                              <div className="flex items-center space-x-2 py-3 justify-center bg-slate-50 border border-slate-200 rounded-xl">
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                                <span className="text-2xs text-slate-500 font-medium">Loading albums...</span>
                              </div>
                            ) : albums.length === 0 ? (
                              <div className="p-3 bg-slate-50 border border-dashed border-slate-200 text-center rounded-xl">
                                <p className="text-2xs text-slate-400">No existing albums discovered.</p>
                                <button 
                                  onClick={() => setAlbumMode('new')}
                                  className="text-2xs text-blue-600 font-bold mt-1.5 hover:underline"
                                >
                                  Create a new one instead
                                </button>
                              </div>
                            ) : (
                              <select
                                value={selectedAlbumId}
                                onChange={(e) => setSelectedAlbumId(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                              >
                                <option value="">-- Choose an Album --</option>
                                {albums.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.title} ({a.mediaItemsCount || '0'} items)
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}

                        {/* Queue Controls & Time Estimation */}
                        <div className="space-y-3.5 pt-3 border-t border-slate-100">
                          <label className="text-2xs font-extrabold uppercase tracking-wider text-slate-500 block">
                            3. Queue Controls & Time Estimation
                          </label>
                          
                          {/* Speed Selector */}
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <span className="text-xs font-semibold text-slate-700 block">
                                Average Transfer Speed
                              </span>
                              <span className="text-[10px] text-slate-400 block leading-tight mt-0.5">
                                Estimated time baseline per asset
                              </span>
                            </div>
                            <select
                              value={avgTransferSpeed}
                              onChange={(e) => setAvgTransferSpeed(Number(e.target.value))}
                              className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-none transition-all font-semibold text-slate-700 shrink-0"
                            >
                              <option value="1.5">Fast Network (1.5s/file)</option>
                              <option value="3">Standard (3s/file)</option>
                              <option value="5">Conservative (5s/file)</option>
                              <option value="8">Slow Connection (8s/file)</option>
                            </select>
                          </div>

                          {/* Error Limit Selection */}
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-xs font-semibold text-slate-600">
                              Auto-pause on consecutive errors
                            </span>
                            <select
                              value={errorLimit}
                              onChange={(e) => setErrorLimit(Number(e.target.value))}
                              className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white outline-none transition-all font-semibold text-slate-700 shrink-0"
                            >
                              <option value="1">After 1 error</option>
                              <option value="3">After 3 errors (Recommended)</option>
                              <option value="5">After 5 errors</option>
                              <option value="10">After 10 errors</option>
                              <option value="999999">Never pause</option>
                            </select>
                          </div>
                          
                          {/* Live Time Estimation Display */}
                          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                            <div className="p-2 bg-blue-100/70 text-blue-700 rounded-lg">
                              <Clock className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-baseline justify-between">
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-500 block">
                                  Estimated Sync Duration
                                </span>
                                <span className="text-xs font-mono font-bold text-blue-700 bg-blue-100/50 px-1.5 py-0.5 rounded">
                                  {formatEstimatedTime(selectedFileIds.size * avgTransferSpeed)}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 leading-normal mt-0.5">
                                Syncing {selectedFileIds.size} files sequentially is expected to take around <strong>{formatEstimatedTime(selectedFileIds.size * avgTransferSpeed)}</strong> based on standard cloud streaming benchmarks.
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2">
                          <button
                            onClick={prepareAndStartTransfer}
                            disabled={selectedFileIds.size === 0 || (albumMode === 'existing' && !selectedAlbumId) || (albumMode === 'new' && !newAlbumName.trim())}
                            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-extrabold text-sm rounded-xl shadow-md shadow-blue-100 disabled:shadow-none transition-all flex items-center justify-center space-x-2 cursor-pointer"
                          >
                            <span>Start Transfer Sync</span>
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                    <div className="w-14 h-14 bg-slate-50 text-slate-300 rounded-2xl flex items-center justify-center border border-slate-100/60 mb-3.5">
                      <FolderOpen className="h-6 w-6" />
                    </div>
                    <h4 className="font-extrabold text-slate-800 text-sm">No Folders Selected</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                      Please explore and select one or more directories from Google Drive on the left. We'll extract their files and organize your upload destination here.
                    </p>
                  </div>
                )}
              </div>
              </div>

              {/* --- Sync History / Past Sync Operations Section --- */}
              <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-xs mt-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-4">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 bg-slate-100 text-slate-600 rounded-xl">
                      <History className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-slate-900 tracking-tight text-sm">
                        Sync History & Past Operations Log
                      </h3>
                      <p className="text-xs text-slate-400">
                        Audit trail of completed, paused, or terminated transfer operations (stored locally)
                      </p>
                    </div>
                  </div>
                  {syncHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearHistory}
                      className="px-3.5 py-1.5 bg-slate-50 hover:bg-rose-50 text-slate-600 hover:text-rose-600 border border-slate-200 hover:border-rose-250 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear History
                    </button>
                  )}
                </div>

                {syncHistory.length === 0 ? (
                  <div className="py-12 text-center">
                    <History className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                    <p className="text-xs text-slate-400 max-w-sm mx-auto font-medium">
                      No past operations recorded yet. Once you run a sync transfer operation, the details will be archived here for reference.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                    {syncHistory.map((session) => {
                      const isExpanded = expandedSessions.has(session.id);
                      return (
                        <div key={session.id} className="border border-slate-200 rounded-2xl overflow-hidden transition-all hover:border-slate-300">
                          {/* Session Header Clickable Area */}
                          <div 
                            onClick={() => toggleSessionExpand(session.id)}
                            className="p-4 bg-slate-50/50 hover:bg-slate-50 cursor-pointer flex flex-wrap items-center justify-between gap-4 transition-colors"
                          >
                            <div className="flex items-center space-x-3 min-w-[200px] max-w-md">
                              <div className="shrink-0">
                                {session.status === 'completed' && (
                                  <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
                                    <CheckCircle2 className="h-4 w-4" />
                                  </div>
                                )}
                                {session.status === 'stopped' && (
                                  <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
                                    <Pause className="h-4 w-4" />
                                  </div>
                                )}
                                {session.status === 'failed' && (
                                  <div className="p-2 bg-rose-100 text-rose-700 rounded-lg">
                                    <XCircle className="h-4 w-4" />
                                  </div>
                                )}
                                {session.status === 'in_progress' && (
                                  <div className="p-2 bg-blue-100 text-blue-700 rounded-lg animate-pulse">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  </div>
                                )}
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-800 text-xs leading-normal truncate" title={session.albumName}>
                                  Album: {session.albumName}
                                </h4>
                                <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                                  {session.timestamp}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center space-x-4">
                              <div className="text-right">
                                <span className="text-xs font-black text-slate-700 font-mono">
                                  {session.succeededCount} / {session.totalFiles}
                                </span>
                                <span className="text-[10px] text-slate-400 block font-semibold">
                                  Succeeded
                                </span>
                              </div>

                              {session.failedCount > 0 && (
                                <div className="text-right">
                                  <span className="text-xs font-black text-rose-600 font-mono">
                                    {session.failedCount}
                                  </span>
                                  <span className="text-[10px] text-rose-400 block font-semibold">
                                    Failed
                                  </span>
                                </div>
                              )}

                              <div className="shrink-0 flex items-center space-x-2">
                                <span className={`inline-flex items-center px-2 py-0.5 text-3xs font-black uppercase rounded-full border ${
                                  session.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                  session.status === 'stopped' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  session.status === 'failed' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                  'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
                                }`}>
                                  {session.status}
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-slate-400" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-slate-400" />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Session Items Details Expanded Area */}
                          <AnimatePresence initial={false}>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: 'auto' }}
                                exit={{ height: 0 }}
                                className="overflow-hidden border-t border-slate-200 bg-white"
                              >
                                <div className="p-4 max-h-[300px] overflow-y-auto space-y-2">
                                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                    Transferred Assets List ({session.items.length} items)
                                  </div>
                                  {session.items.map((item, idx) => (
                                    <div key={idx} className="flex items-start justify-between p-2 hover:bg-slate-50 rounded-xl border border-slate-100/50 text-xs">
                                      <span className="font-semibold text-slate-700 truncate max-w-[280px]" title={item.name}>
                                        {item.name}
                                      </span>
                                      <div className="flex items-center space-x-2 shrink-0">
                                        {item.status === 'success' && (
                                          <span className="text-emerald-600 font-extrabold flex items-center text-3xs bg-emerald-50 px-1.5 py-0.5 rounded">
                                            <Check className="h-3 w-3 mr-0.5 shrink-0" />
                                            Success
                                          </span>
                                        )}
                                        {item.status === 'failed' && (
                                          <div className="flex flex-col items-end">
                                            <span className="text-rose-600 font-extrabold flex items-center text-3xs bg-rose-50 px-1.5 py-0.5 rounded">
                                              <XCircle className="h-3 w-3 mr-0.5 shrink-0" />
                                              Failed
                                            </span>
                                            {item.error && (
                                              <span className="text-[9px] text-rose-400 mt-0.5 truncate max-w-[150px]" title={item.error}>
                                                {item.error}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                        {item.status === 'pending' && (
                                          <span className="text-slate-400 font-extrabold flex items-center text-3xs bg-slate-50 px-1.5 py-0.5 rounded">
                                            <Clock className="h-3 w-3 mr-0.5 shrink-0" />
                                            Skipped / Pending
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Confirmation Dialog / Modal */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-xl space-y-4 text-slate-800"
            >
              <div className="flex items-start space-x-3.5 text-slate-900">
                <div className="bg-amber-100 text-amber-700 p-2.5 rounded-xl shrink-0">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-slate-950">
                    Confirm Sync Transfer
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    You are initiating a direct import operation.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 text-xs space-y-2 border border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-400">Selected Items:</span>
                  <span className="font-bold text-slate-700">{selectedFileIds.size} files</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">From Folders:</span>
                  <span className="font-semibold text-slate-700 truncate max-w-[200px]" title={selectedFolders.map(f => f.name).join(', ')}>
                    {selectedFolders.length === 1 ? selectedFolders[0].name : `${selectedFolders.length} folders`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">To Photos Album:</span>
                  <span className="font-bold text-blue-700 truncate max-w-[200px]" title={albumMode === 'new' ? newAlbumName : albums.find(a => a.id === selectedAlbumId)?.title}>
                    {albumMode === 'new' ? newAlbumName : albums.find(a => a.id === selectedAlbumId)?.title}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200/60 pt-2 mt-1">
                  <span className="text-slate-500 font-semibold flex items-center">
                    <Clock className="h-3.5 w-3.5 mr-1 text-blue-600" />
                    Estimated Sync Time:
                  </span>
                  <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-2xs">
                    ~ {formatEstimatedTime(selectedFileIds.size * avgTransferSpeed)}
                  </span>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 leading-normal">
                Google Photos API will write copies of these items into your account. Files in your Google Drive will remain unmodified. This operation cannot be undone.
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={executeTransfer}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                >
                  Yes, Transfer Sync
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Subtle Footer */}
      <footer className="py-6 border-t border-slate-200 bg-white/50 text-center text-xs text-slate-400 tracking-normal mt-auto">
        <p>© 2026 Drive to Photos Transfer Utility. Secured via Google Firebase Auth.</p>
      </footer>
    </div>
  );
}
