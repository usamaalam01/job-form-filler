import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FileStore } from './filestore'

// ─── In-memory File System Access API stub ───────────────────────────────────

type MemFile = { content: string }
type MemDir = { [name: string]: MemFile | MemDir }

function isDir(node: MemFile | MemDir): node is MemDir {
  return !('content' in node)
}

function makeHandle(fs: MemDir): FileSystemDirectoryHandle {
  function getNode(dir: MemDir, parts: string[]): MemFile | MemDir | undefined {
    let cur: MemFile | MemDir = dir
    for (const p of parts) {
      if (!isDir(cur)) return undefined
      cur = cur[p]
      if (cur === undefined) return undefined
    }
    return cur
  }

  function makeDirHandle(dir: MemDir, _name = ''): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: _name,
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
      getFileHandle(name: string, opts?: { create?: boolean }) {
        if (!dir[name]) {
          if (!opts?.create) return Promise.reject(new Error('Not found'))
          dir[name] = { content: '' }
        }
        const file = dir[name] as MemFile
        return Promise.resolve(makeFileHandle(file, name))
      },
      getDirectoryHandle(name: string, opts?: { create?: boolean }) {
        if (!dir[name]) {
          if (!opts?.create) return Promise.reject(new Error('Not found'))
          dir[name] = {} as MemDir
        }
        return Promise.resolve(makeDirHandle(dir[name] as MemDir, name))
      },
      removeEntry(name: string) {
        if (!(name in dir)) return Promise.reject(new Error('Not found'))
        delete dir[name]
        return Promise.resolve()
      },
      async *entries() {
        for (const [k, v] of Object.entries(dir)) {
          yield [k, isDir(v) ? makeDirHandle(v, k) : makeFileHandle(v, k)] as [string, FileSystemHandle]
        }
      },
    } as unknown as FileSystemDirectoryHandle
  }

  function makeFileHandle(file: MemFile, name: string): FileSystemFileHandle {
    return {
      kind: 'file',
      name,
      getFile() {
        return Promise.resolve({ text: () => Promise.resolve(file.content) } as unknown as File)
      },
      createWritable() {
        return Promise.resolve({
          write(data: string) { file.content = data; return Promise.resolve() },
          close() { return Promise.resolve() },
        } as unknown as FileSystemWritableFileStream)
      },
    } as unknown as FileSystemFileHandle
  }

  return makeDirHandle(fs)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FileStore', () => {
  let store: FileStore
  let fs: MemDir

  beforeEach(async () => {
    fs = { profiles: {} as MemDir }
    store = new FileStore()
    // Bypass requestFolder — inject the handle directly via reconnectFolder
    // by mocking IndexedDB to return our in-memory handle.
    const handle = makeHandle(fs)
    // Directly set the private handle (access for testing only)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(store as any).handle = handle
  })

  it('readFile returns null for missing file', async () => {
    const result = await store.readFile('nonexistent.md')
    expect(result).toBeNull()
  })

  it('writeFile + readFile roundtrip', async () => {
    await store.writeFile('test.md', '# Hello')
    const result = await store.readFile('test.md')
    expect(result).toBe('# Hello')
  })

  it('writeProfile + readProfile roundtrip', async () => {
    await store.writeProfile('ml-engineer', '# ML Engineer profile')
    const result = await store.readProfile('ml-engineer')
    expect(result).toBe('# ML Engineer profile')
  })

  it('readProfile returns null for missing profile', async () => {
    const result = await store.readProfile('does-not-exist')
    expect(result).toBeNull()
  })

  it('listProfiles returns .md filenames without extension', async () => {
    await store.writeProfile('ml-engineer', '# ML Engineer')
    await store.writeProfile('data-analyst', '# Data Analyst')
    const profiles = await store.listProfiles()
    expect(profiles).toContain('ml-engineer')
    expect(profiles).toContain('data-analyst')
  })

  it('readHistory returns empty HistoryFile when missing', async () => {
    const h = await store.readHistory()
    expect(h.version).toBe(1)
    expect(h.applications).toHaveLength(0)
  })

  it('writeHistory + readHistory roundtrip', async () => {
    const data = {
      version: 1,
      applications: [{
        id: 'test-id', url: 'https://example.com', url_normalized: 'example.com',
        company: 'Acme', role: 'Engineer', profile_used: 'ml-engineer',
        filled_at: '2026-06-03T10:00:00Z', status: 'filled' as const,
        fields_filled: 10, fields_flagged: 2,
      }],
    }
    await store.writeHistory(data)
    const loaded = await store.readHistory()
    expect(loaded.applications).toHaveLength(1)
    expect(loaded.applications[0].company).toBe('Acme')
  })

  it('readSettings returns empty object when missing', async () => {
    const s = await store.readSettings()
    expect(s).toEqual({})
  })

  it('writeSettings + readSettings roundtrip', async () => {
    await store.writeSettings({ version: 1, aiDrafting: true })
    const s = await store.readSettings()
    expect(s['aiDrafting']).toBe(true)
  })

  it('deleteProfile removes the file', async () => {
    await store.writeProfile('to-delete', '# Delete me')
    await store.deleteProfile('to-delete')
    const result = await store.readProfile('to-delete')
    expect(result).toBeNull()
  })

  it('reconnectFolder returns false when no stored handle', async () => {
    const fresh = new FileStore()
    // idbGet will return undefined since jsdom has no real IndexedDB
    const result = await fresh.reconnectFolder().catch(() => false)
    expect(result).toBe(false)
  })
})
