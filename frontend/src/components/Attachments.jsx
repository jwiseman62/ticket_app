import { useState, useEffect, useRef, useCallback } from 'react'
import * as api from '../api.js'
import { useConfirm } from '../context/ConfirmContext.jsx'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']

function fileIcon(contentType, filename) {
  if (IMAGE_TYPES.includes(contentType)) return '🖼️'
  if (contentType === 'application/pdf') return '📕'
  if (filename.endsWith('.zip'))         return '🗜️'
  if (filename.match(/\.(txt|log|csv)$/)) return '📄'
  if (filename.match(/\.(docx?|xlsx?|pptx?)$/)) return '📘'
  return '📎'
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Lazily loads an authenticated image preview. */
function ImagePreview({ attachmentId, alt }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let objectUrl = null
    let cancelled = false

    api.fetchAttachmentBlobUrl(attachmentId)
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachmentId])

  if (!url) return <div className="attachment-thumb-placeholder">🖼️</div>
  return <img src={url} alt={alt} className="attachment-thumb" />
}

export default function Attachments({ ticketId, currentUser }) {
  const confirm = useConfirm()
  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error,    setError]    = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef(null)

  // useCallback so the effect below has a stable dependency instead of a
  // function identity that changes on every render.
  const load = useCallback(async () => {
    try {
      setItems(await api.listAttachments(ticketId))
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [ticketId])

  useEffect(() => { load() }, [load])

  async function uploadFiles(fileList) {
    const files = Array.from(fileList)
    if (files.length === 0) return
    setUploading(true)
    setError('')
    for (const f of files) {
      try {
        const created = await api.uploadAttachment(ticketId, f)
        setItems((prev) => [...prev, created])
      } catch (err) {
        setError(`${f.name}: ${err.message}`)
      }
    }
    setUploading(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function handleDelete(att) {
    const ok = await confirm({
      title: 'Delete this file?',
      message: att.filename,
      detail: 'This cannot be undone.',
      confirmLabel: 'Delete file',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteAttachment(att.id)
      setItems((prev) => prev.filter((a) => a.id !== att.id))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDownload(att) {
    try {
      await api.downloadAttachment(att.id, att.filename)
    } catch (err) {
      setError(err.message)
    }
  }

  const canDelete = (att) =>
    att.uploaded_by === currentUser.name || currentUser.role !== 'Requester'

  return (
    <div className="attachments">
      {error && <div className="alert alert-error">{error}</div>}

      {/* Drop zone */}
      <div
        className={`dropzone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          uploadFiles(e.dataTransfer.files)
        }}
        onClick={() => fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => uploadFiles(e.target.files)}
        />
        <div className="dropzone-icon">{uploading ? '⏳' : '📤'}</div>
        <div className="dropzone-text">
          {uploading ? 'Uploading…' : 'Drop files here or click to browse'}
        </div>
        <div className="dropzone-hint">
          Images, PDFs, documents, logs · max 10 MB each
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="list-placeholder">Loading attachments…</div>
      ) : items.length === 0 ? (
        <div className="list-placeholder">No attachments yet.</div>
      ) : (
        <div className="attachment-grid">
          {items.map((att) => (
            <div key={att.id} className="attachment-card">
              <div className="attachment-preview">
                {IMAGE_TYPES.includes(att.content_type)
                  ? <ImagePreview attachmentId={att.id} alt={att.filename} />
                  : <div className="attachment-thumb-placeholder">
                      {fileIcon(att.content_type, att.filename)}
                    </div>}
              </div>
              <div className="attachment-info">
                <div className="attachment-name" title={att.filename}>{att.filename}</div>
                <div className="attachment-meta">
                  {humanSize(att.size)} · {att.uploaded_by}
                </div>
                <div className="attachment-actions">
                  <button type="button" className="btn btn-sm btn-secondary"
                          onClick={() => handleDownload(att)}>
                    Download
                  </button>
                  {canDelete(att) && (
                    <button type="button" className="btn btn-sm btn-danger"
                            onClick={() => handleDelete(att)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}