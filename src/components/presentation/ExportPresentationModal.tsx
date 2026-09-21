// src/components/presentation/ExportPresentationModal.tsx
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Loader2, Download, Presentation } from 'lucide-react'
import { generatePresentation } from '@/lib/presentationApi'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId?: string
  processId?: string
  scope: 'client' | 'process'
  isAdminMode?: boolean
}

type PeriodType = 'last_month' | 'current_month' | 'custom'

const MONTHS = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December']

const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => String(currentYear - i))

export function ExportPresentationModal({
  open, onOpenChange, clientId, processId, scope, isAdminMode = false
}: Props) {
  const [periodType, setPeriodType] = useState<PeriodType>('last_month')
  const [customMonth, setCustomMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [customYear, setCustomYear] = useState(String(currentYear))
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [fileUrl, setFileUrl] = useState<string>('')
  const [filename, setFilename] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string>('')

  const customPeriod = `${customYear}-${customMonth}`

  async function handleGenerate() {
    setStatus('loading')
    setErrorMsg('')
    try {
      const result = await generatePresentation(
        { clientId, processId, scope, periodType, customPeriod: periodType === 'custom' ? customPeriod : undefined },
        !isAdminMode
      )
      setFileUrl(result.fileUrl)
      setFilename(result.filename)
      setStatus('done')
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Generation failed')
      setStatus('error')
    }
  }

  function handleClose() {
    setStatus('idle')
    setFileUrl('')
    setFilename('')
    setErrorMsg('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Presentation className="h-5 w-5 text-blue-600" />
            Export as Presentation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Period type selector */}
          <div className="space-y-1.5">
            <Label>Period</Label>
            <Select value={periodType} onValueChange={v => setPeriodType(v as PeriodType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_month">Last completed month</SelectItem>
                <SelectItem value="current_month">Current month (partial)</SelectItem>
                <SelectItem value="custom">Custom month</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom month/year pickers — only shown for 'custom' */}
          {periodType === 'custom' && (
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Month</Label>
                <Select value={customMonth} onValueChange={setCustomMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1).padStart(2, '0')}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Year</Label>
                <Select value={customYear} onValueChange={setCustomYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Scope label (read-only, shows what will be generated) */}
          <p className="text-sm text-slate-500">
            {scope === 'client'
              ? 'Generates a client summary deck covering all processes.'
              : 'Generates a per-process drilldown deck.'}
          </p>

          {status === 'error' && (
            <p className="text-sm text-red-600 bg-red-50 rounded p-2">{errorMsg}</p>
          )}

          {status === 'done' && (
            <a
              href={fileUrl}
              download={filename}
              className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded p-2 hover:bg-blue-100 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download {filename}
            </a>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {status !== 'done' && (
            <Button onClick={handleGenerate} disabled={status === 'loading'}>
              {status === 'loading' ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating&hellip;</>
              ) : 'Generate'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
