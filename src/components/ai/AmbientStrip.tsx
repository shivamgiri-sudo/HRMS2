import { MiraAvatar } from './MiraAvatar';

export function AmbientStrip({
  contextType: _contextType,
  onOpen,
  open = false,
}: {
  contextType: string;
  onOpen: () => void;
  open?: boolean;
}) {
  return (
    <div className="group fixed bottom-5 right-4 z-50 sm:bottom-6 sm:right-6">
      <div className="pointer-events-none absolute bottom-full right-0 mb-2 translate-y-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100">
        Ask Mira about your HRMS account
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open Mira, your private HR assistant"
        aria-expanded={open}
        className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-white bg-white shadow-[0_12px_38px_rgba(30,41,59,0.28)] transition duration-base hover-pointer:-translate-y-1 hover-pointer:scale-105 active:translate-y-0 active:scale-95"
      >
        <MiraAvatar mood={open ? 'happy' : 'idle'} size="md" />
        <span className="absolute -left-1 -top-1 rounded-full border-2 border-white bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white shadow-sm">AI</span>
      </button>
    </div>
  );
}
