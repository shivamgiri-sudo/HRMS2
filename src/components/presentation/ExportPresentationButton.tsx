// src/components/presentation/ExportPresentationButton.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Presentation } from 'lucide-react'
import { ExportPresentationModal } from './ExportPresentationModal'

interface Props {
  label?: string
  clientId?: string
  processId?: string
  scope: 'client' | 'process'
  isAdminMode?: boolean
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
}

export function ExportPresentationButton({
  label,
  clientId,
  processId,
  scope,
  isAdminMode = false,
  variant = 'outline',
  size = 'sm',
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Presentation className="h-4 w-4 mr-2" />
        {label ?? (scope === 'client' ? 'Export Client Report' : 'Export Process Report')}
      </Button>
      <ExportPresentationModal
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        processId={processId}
        scope={scope}
        isAdminMode={isAdminMode}
      />
    </>
  )
}
