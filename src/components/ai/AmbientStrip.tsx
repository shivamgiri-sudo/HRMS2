import { MessageCircle } from "lucide-react";

export function AmbientStrip({
  contextType: _contextType,
  onOpen,
}: {
  contextType: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open PeopleOS Copilot"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 active:scale-95 transition-all duration-150 lg:bottom-6 lg:right-6"
    >
      <MessageCircle className="h-6 w-6" />
    </button>
  );
}
