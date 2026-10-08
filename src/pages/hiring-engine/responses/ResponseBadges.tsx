/** Channel and answer shown as icon + word (never colour alone), shared by the Responses tab and the review queue. */
import { Ban, Bot, CalendarClock, CheckCircle2, Circle, FileSpreadsheet, HelpCircle, Mail, MessageCircle, MousePointerClick, Navigation, PhoneMissed, UserCog, UserX, XCircle } from "lucide-react";
import { ANSWER_LABEL, ANSWER_TONE, CHANNEL_LABEL, TONE_CLASS, type ResponseAnswer, type ResponseChannel } from "./responsesModel";

export const CHANNEL_ICON: Record<ResponseChannel, typeof Mail> = { email: Mail, web: MousePointerClick, whatsapp: MessageCircle, voice_bot: Bot, call_file: FileSpreadsheet, hr: UserCog };
const ANSWER_ICON: Record<ResponseAnswer, typeof Mail> = {
  confirm: CheckCircle2, decline: XCircle, reschedule: CalendarClock, question: HelpCircle, unsubscribe: Ban, no_answer: PhoneMissed, on_my_way: Navigation, wrong_person: UserX, other: Circle,
};

export function ChannelBadge({ channel }: { channel: ResponseChannel }) {
  const Icon = CHANNEL_ICON[channel] ?? Circle;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-slate-800 dark:text-slate-100"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />{CHANNEL_LABEL[channel] ?? channel}</span>;
}

export function AnswerBadge({ answer, prefix }: { answer: ResponseAnswer; prefix?: string }) {
  const Icon = ANSWER_ICON[answer] ?? Circle;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE_CLASS[ANSWER_TONE[answer] ?? "neutral"]}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />{prefix ? `${prefix} ` : ""}{ANSWER_LABEL[answer] ?? answer}
    </span>
  );
}
