/**
 * IndexedDB 本地持久化存储层
 * 用于永久缓存：
 * 1. icons: 网站图标 DataURL（实现 0ms 瞬开，彻底无视代理延迟与断网）
 * 2. wallpapers: 用户本地上传的高清壁纸 DataURL
 */

const DB_NAME = 'MiroTabCacheDB';
const DB_VERSION = 1;
const STORE_ICONS = 'icons';
const STORE_WALLPAPERS = 'wallpapers';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        dbPromise = null;
        reject(new Error('IndexedDB open timeout'));
      }
    }, 1500);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ICONS)) {
          db.createObjectStore(STORE_ICONS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_WALLPAPERS)) {
          db.createObjectStore(STORE_WALLPAPERS, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(req.result); }
      };
      req.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); dbPromise = null; reject(req.error); }
      };
      req.onblocked = () => {
        if (!settled) { settled = true; clearTimeout(timer); dbPromise = null; reject(new Error('IndexedDB blocked')); }
      };
    } catch (err) {
      if (!settled) { settled = true; clearTimeout(timer); dbPromise = null; reject(err); }
    }
  });
  return dbPromise;
}

export async function getCachedIcon(key) {
  if (!key) return null;
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_ICONS, 'readonly');
      const req = tx.objectStore(STORE_ICONS).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedIcon(key, dataUrl, meta = {}) {
  if (!key || !dataUrl) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ICONS, 'readwrite');
      tx.objectStore(STORE_ICONS).put({
        key,
        dataUrl,
        updatedAt: Date.now(),
        ...meta
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 忽略存储配额等异常
  }
}

export async function deleteCachedIcon(key) {
  if (!key) return;
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_ICONS, 'readwrite');
      tx.objectStore(STORE_ICONS).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

export async function getAllCachedIcons() {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_ICONS, 'readonly');
      const req = tx.objectStore(STORE_ICONS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function clearAllCachedIcons() {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ICONS, 'readwrite');
    tx.objectStore(STORE_ICONS).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('清空图标缓存失败'));
    tx.onabort = () => reject(tx.error || new Error('清空图标缓存事务被中止'));
  });
}

export async function getCustomWallpaper(key = 'user-custom') {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_WALLPAPERS, 'readonly');
      const req = tx.objectStore(STORE_WALLPAPERS).get(key);
      req.onsuccess = () => resolve(req.result?.dataUrl || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCustomWallpaper(dataUrl, key = 'user-custom') {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WALLPAPERS, 'readwrite');
      tx.objectStore(STORE_WALLPAPERS).put({
        key,
        dataUrl,
        updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function clearAllWallpapers() {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WALLPAPERS, 'readwrite');
    tx.objectStore(STORE_WALLPAPERS).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('清空壁纸缓存失败'));
    tx.onabort = () => reject(tx.error || new Error('清空壁纸缓存事务被中止'));
  });
}

export async function pruneOldBingWallpapers(maxKeep = 10) {
  try {
    const db = await openDB();
    const all = await new Promise((resolve) => {
      const tx = db.transaction(STORE_WALLPAPERS, 'readonly');
      const req = tx.objectStore(STORE_WALLPAPERS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const bings = all
      .filter((item) => typeof item?.key === 'string' && item.key.startsWith('bing-'))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (bings.length <= maxKeep) return 0;
    const toDelete = bings.slice(maxKeep);
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_WALLPAPERS, 'readwrite');
      const store = tx.objectStore(STORE_WALLPAPERS);
      for (const item of toDelete) store.delete(item.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    return toDelete.length;
  } catch {
    return 0;
  }
}
