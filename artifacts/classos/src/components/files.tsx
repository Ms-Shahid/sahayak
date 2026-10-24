import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, FileText, FileUp, Check, Send, RefreshCw } from 'lucide-react';
import {
  useRequestFileUpload, useCompleteFileUpload, useGetStoredFile, useReviewSubmission, useSubmitAssignment,
  getStoredFile, getGetStudentOverviewQueryKey,
  downloadStoredFile, getGetStoredFileQueryKey, getGetMaterialsQueryKey, getGetSchoolMaterialsQueryKey,
  getGetSchoolDashboardQueryKey, getGetSubmissionsQueryKey, getGetMasteryQueryKey, getGetAssignmentsQueryKey,
} from '@workspace/api-client-react';
import type { SourcePage, StoredFile, Submission } from '@workspace/api-client-react';
import { Button, FormField, Modal, errMsg, inputClass, relativeDate } from '@/components/kit';

export const MAX_BYTES = 20 * 1024 * 1024;
const EXT: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const SOURCE_TYPES = Object.values(EXT).filter((v, i, a) => a.indexOf(v) === i);
const SUBMISSION_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const SOURCE_ACCEPT = '.pdf,.docx,.pptx,.jpg,.jpeg,.png,.webp';
export const SUBMISSION_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';

export function contentTypeOf(f: File) { return f.type || EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] || ''; }
export function validateFile(f: File, purpose: 'source' | 'submission'): string | null {
  const t = contentTypeOf(f);
  if (!(purpose === 'source' ? SOURCE_TYPES : SUBMISSION_TYPES).includes(t)) return purpose === 'source' ? 'Use a PDF, DOCX, PPTX, JPEG, PNG or WebP file.' : 'Use a PDF, JPEG, PNG or WebP file.';
  if (f.size > MAX_BYTES) return 'This file is over the 20 MB limit.';
  if (f.size < 1) return 'This file is empty.';
  return null;
}
export function sizeLabel(n: number) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; }
export const isFailed = (s?: string | null) => !!s && /fail|error/i.test(s);
export const isReady = (s?: string | null) => !s || /ready|complete|done|extracted|success/i.test(s);
export const isProcessing = (s?: string | null) => !isFailed(s) && !isReady(s);

export type UploadPhase = 'idle' | 'reserving' | 'uploading' | 'extracting' | 'done' | 'error';
interface UploadMeta { purpose: 'source' | 'submission'; classId?: number; assignmentId?: number; title?: string; topic?: string }

export function useFileUpload() {
  const request = useRequestFileUpload(); const complete = useCompleteFileUpload();
  const [phase, setPhase] = useState<UploadPhase>('idle'); const [progress, setProgress] = useState(0);
  const [error, setError] = useState(''); const [stored, setStored] = useState<StoredFile | null>(null);
  const reqRef = useRef(request.mutateAsync); reqRef.current = request.mutateAsync;
  const compRef = useRef(complete.mutateAsync); compRef.current = complete.mutateAsync;
  const reset = () => { setPhase('idle'); setProgress(0); setError(''); setStored(null); };
  const run = async (file: File, meta: UploadMeta): Promise<StoredFile | null> => {
    const contentType = contentTypeOf(file);
    setError(''); setStored(null); setProgress(0);
    try {
      setPhase('reserving');
      const slot = await reqRef.current({ data: { filename: file.name, contentType, size: file.size, ...meta } });
      setPhase('uploading');
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open('PUT', slot.uploadURL); xhr.setRequestHeader('Content-Type', contentType);
        xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The file could not be uploaded.')));
        xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
        xhr.send(file);
      });
      setPhase('extracting');
      let result: StoredFile;
      try {
        result = await compRef.current({ uploadId: slot.id, data: {} });
      } catch {
        // A proxy may close a long OCR request while the server is still processing.
        result = await getStoredFile(slot.id);
        for (let i = 0; isProcessing(result.status) && i < 190; i++) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          result = await getStoredFile(slot.id);
        }
        if (isProcessing(result.status)) throw new Error('Extraction is still running. Check this file in the source library shortly.');
      }
      setStored(result);
      if (isFailed(result.status) || result.error) { setError(result.error || 'We could not read this file.'); setPhase('error'); return result; }
      setPhase('done'); return result;
    } catch (e) { setError(errMsg(e, 'Upload failed. Please try again.')); setPhase('error'); return null; }
  };
  return { phase, progress, error, stored, run, reset, busy: phase === 'reserving' || phase === 'uploading' || phase === 'extracting' };
}

export function UploadProgress({ phase, progress, error }: { phase: UploadPhase; progress: number; error: string }) {
  if (phase === 'idle') return null;
  const steps = [['reserving', 'Preparing'], ['uploading', `Uploading${phase === 'uploading' ? ` ${progress}%` : ''}`], ['extracting', 'Reading pages']];
  const idx = phase === 'done' ? 3 : phase === 'error' ? -1 : steps.findIndex(s => s[0] === phase);
  return <div className="upload-progress" role="status" data-testid="status-upload">
    <div className="upload-steps">{steps.map((s, i) => <span key={s[0]} className={i < idx ? 'step-done' : i === idx ? 'step-now' : ''}>{i < idx ? <Check size={12}/> : <i/>}{s[1]}</span>)}</div>
    {phase === 'extracting' && <p>Extracting text can take a few minutes for long files. You can leave this page; it keeps working.</p>}
    {phase === 'uploading' && <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }}/></div>}
    {phase === 'error' && <p className="form-error" data-testid="text-upload-error">{error}</p>}
  </div>;
}

export function ExtractedPages({ pages, docx }: { pages?: SourcePage[]; docx?: boolean }) {
  if (!pages?.length) return null;
  return <details className="extracted"><summary>{pages.length} extracted {docx ? 'sections' : 'pages'}</summary>
    {docx && <p className="field-help">Word files are split into labelled sections, not printed pages.</p>}
    <div className="extracted-list">{pages.map(p => <div key={p.page} className="extracted-page"><span>{p.label || `Page ${p.page}`}</span><p>{p.text || 'No readable text found here.'}</p></div>)}</div></details>;
}

export function ExtractionBadge({ status, error }: { status?: string | null; error?: string | null }) {
  if (!status && !error) return null;
  const cls = isFailed(status) || error ? 'ex-bad' : isReady(status) ? 'ex-ok' : 'ex-wait';
  return <span className={`extract-badge ${cls}`}>{isFailed(status) || error ? 'Extraction failed' : isReady(status) ? 'Text extracted' : 'Reading file'}</span>;
}

export function CiteRef({ materialId, sourcePage }: { materialId?: number; sourcePage?: number }) {
  if (materialId == null && sourcePage == null) return null;
  return <span className="cite-ref" data-testid="text-citation-ref"><FileText size={12}/>{materialId != null && `Material #${materialId}`}{materialId != null && sourcePage != null && ', '}{sourcePage != null && `source page ${sourcePage}`}</span>;
}

export function DownloadButton({ id, filename, label = 'Download original' }: { id: number; filename?: string; label?: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const blob = await downloadStoredFile(id); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename || `file-${id}`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { setErr(errMsg(e, 'Download failed.')); } finally { setBusy(false); }
  };
  return <span className="download-wrap"><Button variant="outline" type="button" onClick={go} disabled={busy} data-testid={`button-download-${id}`}><Download size={14}/>{busy ? 'Preparing…' : label}</Button>{err && <small className="form-error">{err}</small>}</span>;
}

export function SourceUploadModal({ classId, scope, onClose }: { classId?: number; scope: 'class' | 'school'; onClose: () => void }) {
  const qc = useQueryClient(); const up = useFileUpload();
  const [file, setFile] = useState<File | null>(null); const [title, setTitle] = useState(''); const [topic, setTopic] = useState(''); const [fileErr, setFileErr] = useState('');
  const pick = (f: File | null) => { setFile(f); setFileErr(f ? validateFile(f, 'source') ?? '' : ''); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '')); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!file || fileErr) return;
    await up.run(file, { purpose: 'source', ...(scope === 'class' ? { classId } : {}), title: title.trim(), topic: topic.trim() });
    qc.invalidateQueries({ queryKey: getGetMaterialsQueryKey(scope === 'school' ? undefined : { classId: classId ?? 0 }) });
    qc.invalidateQueries({ queryKey: getGetSchoolMaterialsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSchoolDashboardQueryKey() });
  };
  const finished = up.phase === 'done' || (up.phase === 'error' && up.stored);
  return <Modal title={scope === 'school' ? 'Upload a master source' : 'Upload a class source'} onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label className={`dropzone ${file ? 'dropzone-has' : ''}`}><FileUp size={22}/><strong>{file ? file.name : 'Choose a file'}</strong><span>{file ? sizeLabel(file.size) : 'PDF, DOCX, PPTX, JPEG, PNG or WebP · up to 20 MB · up to 40 pages'}</span>
        <input type="file" accept={SOURCE_ACCEPT} disabled={up.busy} data-testid="input-source-file" onChange={e => pick(e.target.files?.[0] ?? null)}/></label>
      {fileErr && <p className="form-error">{fileErr}</p>}
      <div className="form-two"><FormField label="Source title"><input required className={inputClass} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} disabled={up.busy}/></FormField><FormField label="Topic"><input required className={inputClass} value={topic} onChange={e => setTopic(e.target.value)} maxLength={200} disabled={up.busy} placeholder="Topic"/></FormField></div>
      <p className="field-help">{scope === 'school' ? 'Master sources are readable by every teacher from their class source view.' : 'Photos of textbook pages and slides are read for text, so keep them sharp and well lit.'}</p>
      <UploadProgress phase={up.phase} progress={up.progress} error={up.error}/>
      {finished && up.stored && <><ExtractionBadge status={up.stored.status} error={up.stored.error}/><ExtractedPages pages={up.stored.pages} docx={/docx$/i.test(up.stored.filename)}/></>}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={onClose}>{up.phase === 'done' ? 'Close' : 'Cancel'}</Button>{up.phase !== 'done' && <Button disabled={!file || !!fileErr || up.busy || !title.trim() || !topic.trim()} data-testid="button-upload-source">{up.busy ? 'Working…' : up.phase === 'error' ? 'Try again' : 'Upload source'}</Button>}</div>
    </form></Modal>;
}

export function FileSubmitPanel({ assignmentId, classId, onDone }: { assignmentId: number; classId: number; onDone: () => void }) {
  return <FileSubmitForm key={assignmentId} assignmentId={assignmentId} classId={classId} onDone={onDone}/>;
}
function FileSubmitForm({ assignmentId, classId }: { assignmentId: number; classId: number; onDone: () => void }) {
  const qc = useQueryClient(); const up = useFileUpload(); const sub = useSubmitAssignment();
  const subRef = useRef(sub.mutateAsync); subRef.current = sub.mutateAsync;
  const [sent, setSent] = useState(false);
  const [file, setFile] = useState<File | null>(null); const [fileErr, setFileErr] = useState(''); const [subErr, setSubErr] = useState('');
  const [preview, setPreview] = useState('');
  const pick = (f: File | null) => { up.reset(); setFile(f); setFileErr(f ? validateFile(f, 'submission') ?? '' : ''); setSubErr(''); if (preview) URL.revokeObjectURL(preview); setPreview(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : ''); };
  const send = async (e: FormEvent) => {
    e.preventDefault(); if (!file || fileErr) return; setSubErr('');
    const stored = up.stored && (isReady(up.stored.status) || up.stored.originalAvailable) ? up.stored : await up.run(file, { purpose: 'submission', classId, assignmentId });
    if (!stored || (isFailed(stored.status) && !stored.originalAvailable)) return;
    if (isFailed(stored.status) && !up.stored) return; // Let the student explicitly choose to submit an unreadable original.
    try {
      await subRef.current({ assignmentId, data: { attachmentId: stored.id } });
      [getGetSubmissionsQueryKey(assignmentId), getGetMasteryQueryKey({ classId }), getGetAssignmentsQueryKey({ classId }), getGetSchoolDashboardQueryKey(), getGetStudentOverviewQueryKey()].forEach(queryKey => qc.invalidateQueries({ queryKey }));
      // Query invalidation, not a stale parent callback, updates the selected assignment.
      setSent(true);
    } catch (err) { setSubErr(errMsg(err, 'Your file uploaded but the submission was not saved. Try again.')); }
  };
  if (sent) return <p className="review-saved">File submitted. Waiting for your teacher to review it.</p>;
  return <form className="file-submit" onSubmit={send}>
    <label className={`dropzone ${file ? 'dropzone-has' : ''}`}><FileUp size={22}/><strong>{file ? file.name : 'Add a photo or PDF of your work'}</strong><span>{file ? sizeLabel(file.size) : 'JPEG, PNG, WebP or PDF · up to 20 MB · up to 40 pages'}</span>
      <input type="file" accept={SUBMISSION_ACCEPT} capture={undefined} disabled={up.busy || sub.isPending} data-testid="input-submission-file" onChange={e => pick(e.target.files?.[0] ?? null)}/></label>
    {preview && <img className="file-preview" src={preview} alt="Preview of your work"/>}
    {fileErr && <p className="form-error">{fileErr}</p>}
    <UploadProgress phase={up.phase} progress={up.progress} error={up.error}/>
    {subErr && <p className="form-error" data-testid="text-submit-error">{subErr}</p>}
    <p className="field-help">Your teacher will read your work and send a score with feedback. Until then it shows as pending.</p>
    {up.stored?.originalAvailable && isFailed(up.stored.status) && <p className="field-help">The text could not be read automatically. You can still send the original for your teacher to review.</p>}
    <Button disabled={!file || !!fileErr || up.busy || sub.isPending} data-testid="button-submit-file"><Send size={15}/>{up.busy || sub.isPending ? 'Sending your work…' : up.stored?.originalAvailable && isFailed(up.stored.status) ? 'Submit original for teacher review' : 'Submit my file'}</Button>
  </form>;
}

export function ScoreView({ s }: { s: Submission }) {
  if (s.reviewStatus === 'pending') return <div className="score score-pending" data-testid={`text-score-${s.id}`}>Pending</div>;
  return <div className="score" data-testid={`text-score-${s.id}`}>{Math.round(s.score)}<small>%</small></div>;
}

function ReviewForm({ s, assignmentId, classId, existing }: { s: Submission; assignmentId: number; classId: number; existing: boolean }) {
  const qc = useQueryClient(); const review = useReviewSubmission();
  const [score, setScore] = useState(s.reviewStatus === 'pending' ? '' : String(Math.round(s.score))); const [feedback, setFeedback] = useState(s.teacherFeedback ?? ''); const [saved, setSaved] = useState(false);
  const save = (e: FormEvent) => { e.preventDefault(); setSaved(false);
    review.mutate({ submissionId: s.id, data: { score: Number(score), feedback: feedback.trim() } }, { onSuccess: () => {
      [getGetSubmissionsQueryKey(assignmentId), getGetMasteryQueryKey({ classId }), getGetSchoolDashboardQueryKey()].forEach(queryKey => qc.invalidateQueries({ queryKey })); setSaved(true); } }); };
  return <form className="review-form" onSubmit={save}><div className="form-two"><FormField label="Score (0 to 100)"><input required type="number" min={0} max={100} step="1" className={inputClass} value={score} onChange={e => setScore(e.target.value)} data-testid={`input-score-${s.id}`}/></FormField><div className="review-state">{existing ? 'Update your review' : 'Awaiting your review'}</div></div>
    <FormField label="Feedback for the student"><textarea required maxLength={4000} className={`${inputClass} textarea`} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="What worked, what to revisit" data-testid={`input-feedback-${s.id}`}/></FormField>
    {review.isError && <p className="form-error">{errMsg(review.error, 'Could not save this review.')}</p>}{saved && <p className="review-saved"><Check size={13}/> Review saved</p>}
    <Button disabled={review.isPending || score === '' || !feedback.trim()} data-testid={`button-review-${s.id}`}>{review.isPending ? 'Saving…' : 'Save review'}</Button></form>;
}

function AttachmentView({ id }: { id: number }) {
  const q = useGetStoredFile(id, { query: { queryKey: getGetStoredFileQueryKey(id), refetchInterval: query => (query.state.data && isProcessing(query.state.data.status) ? 5000 : false) } });
  if (q.isLoading) return <p className="subtle-empty">Loading the file…</p>;
  if (q.isError || !q.data) return <div className="inline-error">The file details are unavailable. <button className="table-action" onClick={() => q.refetch()}><RefreshCw size={12}/> Retry</button></div>;
  const f = q.data;
  return <div className="attachment"><div className="attachment-head"><span><FileText size={15}/> <strong>{f.filename}</strong> · {sizeLabel(f.size)}</span><ExtractionBadge status={f.status} error={f.error}/></div>
    {f.error && <p className="form-error" data-testid={`text-extract-error-${id}`}>{f.error}</p>}
    <ExtractedPages pages={f.pages} docx={/docx$/i.test(f.filename)}/><DownloadButton id={id} filename={f.filename}/></div>;
}

export function SubmissionItem({ s, assignmentId, classId, staff, avatar }: { s: Submission; assignmentId: number; classId: number; staff: boolean; avatar: string }) {
  const [open, setOpen] = useState(false);
  const hasFile = s.attachmentId != null; const expandable = hasFile || (!staff && !!s.teacherFeedback) || (staff && hasFile);
  return <div className="submission-item" data-testid={`row-submission-${s.id}`}>
    <button type="button" className="submission-row submission-toggle" onClick={() => setOpen(o => !o)} disabled={!expandable}><div className="avatar avatar-peach">{avatar}</div><div><strong>{s.studentName}</strong><span>{relativeDate(s.submittedAt)}{hasFile ? ' · file work' : ''}{s.reviewStatus === 'reviewed' ? ' · reviewed' : ''}</span></div><ScoreView s={s}/></button>
    {(open || (!staff && s.teacherFeedback)) && <div className="submission-detail">
      {s.teacherFeedback && <div className="teacher-note"><span className="label-caps">TEACHER FEEDBACK</span><p data-testid={`text-feedback-${s.id}`}>{s.teacherFeedback}</p></div>}
      {open && hasFile && <AttachmentView id={s.attachmentId as number}/>}
      {open && staff && hasFile && <ReviewForm s={s} assignmentId={assignmentId} classId={classId} existing={s.reviewStatus === 'reviewed'}/>}
    </div>}
    {!staff && s.reviewStatus === 'pending' && <p className="pending-note"><BookOpen size={12}/> Waiting for your teacher to review this.</p>}
  </div>;
}
