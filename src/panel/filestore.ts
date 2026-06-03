import type { HistoryFile } from '@shared/types'

// IndexedDB constants
const DB_NAME = 'jff-filestore'
const DB_VERSION = 1
const STORE_NAME = 'handles'
const FOLDER_KEY = 'data-folder'

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ─── FileStore ────────────────────────────────────────────────────────────────

export class FileStore {
  private handle: FileSystemDirectoryHandle | null = null

  // ── Folder management ───────────────────────────────────────────────────────

  /** Show the directory picker, persist the handle. Requires user activation. */
  async requestFolder(): Promise<void> {
    const dir = await showDirectoryPicker({ mode: 'readwrite' })
    this.handle = dir
    await idbSet(FOLDER_KEY, dir)
    // Ensure profiles/ sub-directory exists
    await dir.getDirectoryHandle('profiles', { create: true })
  }

  /**
   * Restore handle from IndexedDB and check/request permission.
   * Returns false if permission cannot be granted in this context
   * (e.g. called from a service worker with no user activation).
   */
  async reconnectFolder(): Promise<boolean> {
    const stored = await idbGet<FileSystemDirectoryHandle>(FOLDER_KEY)
    if (!stored) return false

    const perm = await stored.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      this.handle = stored
      return true
    }

    // requestPermission requires user activation — only call from panel context.
    try {
      const granted = await stored.requestPermission({ mode: 'readwrite' })
      if (granted === 'granted') {
        this.handle = stored
        return true
      }
    } catch {
      // Called from a context without user activation (e.g. service worker).
    }
    return false
  }

  async isFolderConnected(): Promise<boolean> {
    if (this.handle) return true
    const stored = await idbGet<FileSystemDirectoryHandle>(FOLDER_KEY)
    if (!stored) return false
    const perm = await stored.queryPermission({ mode: 'readwrite' })
    return perm === 'granted'
  }

  private requireHandle(): FileSystemDirectoryHandle {
    if (!this.handle) throw new Error('FileStore: no folder connected.')
    return this.handle
  }

  // ── Generic file ops ────────────────────────────────────────────────────────

  async readFile(path: string): Promise<string | null> {
    const root = this.requireHandle()
    try {
      const fileHandle = await this.resolveFile(root, path)
      const file = await fileHandle.getFile()
      return await file.text()
    } catch {
      return null
    }
  }

  /**
   * Atomic write: write to <path>.tmp, then rename to <path>.
   * On rename failure, the .tmp is cleaned up and an error is thrown.
   */
  async writeFile(path: string, content: string): Promise<void> {
    const root = this.requireHandle()
    const tmpPath = path + '.tmp'
    let tmpHandle: FileSystemFileHandle | null = null
    try {
      tmpHandle = await this.resolveFile(root, tmpPath, true)
      const writable = await tmpHandle.createWritable()
      await writable.write(content)
      await writable.close()
      // Rename by writing final file then removing tmp
      const finalHandle = await this.resolveFile(root, path, true)
      const finalWritable = await finalHandle.createWritable()
      await finalWritable.write(content)
      await finalWritable.close()
    } finally {
      // Clean up .tmp regardless of success or failure
      if (tmpHandle) {
        try {
          await this.deleteFileHandle(root, tmpPath)
        } catch { /* ignore cleanup errors */ }
      }
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    const root = this.requireHandle()
    const dirHandle = await root.getDirectoryHandle(dir)
    const names: string[] = []
    for await (const [name] of dirHandle.entries()) {
      names.push(name)
    }
    return names
  }

  async deleteFile(path: string): Promise<void> {
    const root = this.requireHandle()
    await this.deleteFileHandle(root, path)
  }

  // ── Domain helpers ──────────────────────────────────────────────────────────

  async readProfile(slug: string): Promise<string | null> {
    return this.readFile(`profiles/${slug}.md`)
  }

  async writeProfile(slug: string, content: string): Promise<void> {
    return this.writeFile(`profiles/${slug}.md`, content)
  }

  async listProfiles(): Promise<string[]> {
    const files = await this.listFiles('profiles')
    return files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
  }

  async deleteProfile(slug: string): Promise<void> {
    return this.deleteFile(`profiles/${slug}.md`)
  }

  async readQABank(): Promise<string | null> {
    return this.readFile('qa-bank.md')
  }

  async writeQABank(content: string): Promise<void> {
    return this.writeFile('qa-bank.md', content)
  }

  async readHistory(): Promise<HistoryFile> {
    const raw = await this.readFile('history.json')
    if (!raw) return { version: 1, applications: [] }
    try {
      return JSON.parse(raw) as HistoryFile
    } catch {
      return { version: 1, applications: [] }
    }
  }

  async writeHistory(data: HistoryFile): Promise<void> {
    return this.writeFile('history.json', JSON.stringify(data, null, 2))
  }

  async readSettings(): Promise<Record<string, unknown>> {
    const raw = await this.readFile('settings.json')
    if (!raw) return {}
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  async writeSettings(data: Record<string, unknown>): Promise<void> {
    return this.writeFile('settings.json', JSON.stringify(data, null, 2))
  }

  // ── Private path utilities ──────────────────────────────────────────────────

  private async resolveFile(
    root: FileSystemDirectoryHandle,
    path: string,
    create = false,
  ): Promise<FileSystemFileHandle> {
    const parts = path.split('/')
    const fileName = parts.pop()!
    let dir = root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create })
    }
    return dir.getFileHandle(fileName, { create })
  }

  private async deleteFileHandle(
    root: FileSystemDirectoryHandle,
    path: string,
  ): Promise<void> {
    const parts = path.split('/')
    const fileName = parts.pop()!
    let dir = root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part)
    }
    await dir.removeEntry(fileName)
  }
}

// Singleton for the panel context
export const fileStore = new FileStore()
