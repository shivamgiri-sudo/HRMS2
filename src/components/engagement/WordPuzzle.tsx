import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Delete, Sparkles, Trophy, Users, ChevronRight, Check, X, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type LetterState = "correct" | "present" | "absent" | "empty" | "tbd";

interface LetterResult { letter: string; state: "correct" | "present" | "absent" }
interface GuessResult { guess: string; result: LetterResult[]; solved: boolean }

interface PuzzlePublic {
  id: string;
  puzzle_date: string;
  hint: string | null;
  category: string | null;
  difficulty: "easy" | "medium" | "hard";
}

interface PuzzleAttempt {
  guesses: string[];
  solved: boolean;
  attempts_used: number;
  points_awarded: number;
}

interface TodayPuzzleResult {
  puzzle: PuzzlePublic;
  attempt: PuzzleAttempt | null;
  guessResults: GuessResult[];
  participantCount: number;
  solvedCount: number;
  pointsSchedule: Record<number, number>;
}

interface SubmitGuessResult {
  guessResult: GuessResult;
  attemptsUsed: number;
  attemptsRemaining: number;
  gameOver: boolean;
  solved: boolean;
  word?: string;
  pointsAwarded: number;
  guessResults: GuessResult[];
}

const KEYBOARD_ROWS = [
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L"],
  ["ENTER","Z","X","C","V","B","N","M","⌫"],
];

const TILE_COLORS: Record<LetterState, string> = {
  correct: "bg-green-500 border-green-500 text-white",
  present: "bg-amber-500 border-amber-500 text-white",
  absent:  "bg-slate-500 border-slate-500 text-white",
  empty:   "bg-white border-slate-200 text-transparent",
  tbd:     "bg-white border-slate-400 text-slate-900",
};

const KEY_COLORS: Record<string, string> = {};

const DIFF_CONFIG = {
  easy:   { label: "Easy",   color: "bg-green-100 text-green-700" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-700" },
  hard:   { label: "Hard",   color: "bg-red-100 text-red-700" },
};

export function WordPuzzle({ compact = false }: { compact?: boolean }) {
  const [currentGuess, setCurrentGuess] = useState("");
  const [shake, setShake] = useState(false);
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [localGuessResults, setLocalGuessResults] = useState<GuessResult[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [gameWord, setGameWord] = useState<string | undefined>();
  const [finalPoints, setFinalPoints] = useState(0);
  const [finalSolved, setFinalSolved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const queryClient = useQueryClient();
  const boardRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery<TodayPuzzleResult | null>({
    queryKey: ["word-puzzle-today"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: TodayPuzzleResult | null }>("/api/engagement/word-puzzle/today");
      return res.data;
    },
    staleTime: 60_000,
  });

  // Initialise local state from server data
  useEffect(() => {
    if (!data) return;
    if (data.guessResults.length > 0) {
      setLocalGuessResults(data.guessResults);
    }
    if (data.attempt?.solved || (data.attempt && data.attempt.attempts_used >= 6)) {
      setGameOver(true);
      setFinalSolved(!!data.attempt.solved);
      setFinalPoints(data.attempt.points_awarded);
      // word is not exposed until game ends; if already ended server may give it
    }
  }, [data]);

  const submitMutation = useMutation({
    mutationFn: async (guess: string) => {
      const res = await hrmsApi.post<{ data: SubmitGuessResult }>("/api/engagement/word-puzzle/guess", {
        puzzleId: data!.puzzle.id,
        guess,
      });
      return res.data;
    },
    onSuccess: (result) => {
      setLocalGuessResults(result.guessResults);
      setRevealRow(result.attemptsUsed - 1);
      setTimeout(() => setRevealRow(null), 600);
      if (result.gameOver) {
        setGameOver(true);
        setFinalSolved(result.solved);
        setFinalPoints(result.pointsAwarded);
        setGameWord(result.word);
        queryClient.invalidateQueries({ queryKey: ["word-puzzle-today"] });
        queryClient.invalidateQueries({ queryKey: ["engagement-me"] });
        queryClient.invalidateQueries({ queryKey: ["gamification-points"] });
      }
    },
    onError: () => {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    },
  });

  const handleKey = useCallback((key: string) => {
    if (gameOver || submitMutation.isPending) return;
    if (key === "BACKSPACE" || key === "⌫") {
      setCurrentGuess(g => g.slice(0, -1));
    } else if (key === "ENTER") {
      if (currentGuess.length !== 5) {
        setShake(true); setTimeout(() => setShake(false), 500);
        return;
      }
      submitMutation.mutate(currentGuess);
      setCurrentGuess("");
    } else if (/^[A-Z]$/.test(key) && currentGuess.length < 5) {
      setCurrentGuess(g => g + key);
    }
  }, [gameOver, submitMutation, currentGuess]);

  // Physical keyboard listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Backspace") handleKey("⌫");
      else if (e.key === "Enter") handleKey("ENTER");
      else handleKey(e.key.toUpperCase());
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleKey]);

  if (isLoading) return (
    <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-slate-50 to-indigo-50">
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="flex justify-center gap-1">
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-12 rounded-lg" />)}
        </div>
      </CardContent>
    </Card>
  );

  if (error || !data?.puzzle) return (
    <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-slate-50 to-slate-100">
      <CardContent className="p-4 flex items-center gap-3 text-slate-500">
        <span className="text-lg">🔤</span>
        <span className="text-sm">No word puzzle today. Check back tomorrow!</span>
      </CardContent>
    </Card>
  );

  const { puzzle, participantCount, solvedCount, pointsSchedule } = data;
  const diffConfig = DIFF_CONFIG[puzzle.difficulty] || DIFF_CONFIG.medium;
  const filledRows = localGuessResults.length;
  const currentRow = gameOver ? filledRows : filledRows;

  // Build keyboard letter states
  const keyStates: Record<string, LetterState> = {};
  for (const gr of localGuessResults) {
    for (const lr of gr.result) {
      const existing = keyStates[lr.letter];
      if (existing === "correct") continue;
      if (lr.state === "correct" || !existing) keyStates[lr.letter] = lr.state;
      else if (lr.state === "present" && existing === "absent") keyStates[lr.letter] = "present";
    }
  }

  // Compact variant
  if (compact) {
    return (
      <div className={cn(
        "flex items-start gap-3 rounded-2xl p-3 transition-all",
        gameOver
          ? finalSolved ? "bg-green-50" : "bg-red-50"
          : "bg-gradient-to-r from-indigo-50 to-violet-50"
      )}>
        <div className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 text-base",
          gameOver
            ? finalSolved ? "bg-green-100" : "bg-red-100"
            : "bg-gradient-to-br from-indigo-500 to-violet-600"
        )}>
          {gameOver ? (finalSolved ? <Check className="h-5 w-5 text-green-600" /> : <X className="h-5 w-5 text-red-500" />) : <span className="text-white font-bold text-xs">WORD</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-slate-900 truncate">Word Puzzle</p>
            {!gameOver && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-indigo-100 text-indigo-700">
                up to +{pointsSchedule[1]} pts
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {gameOver
              ? finalSolved ? `Solved in ${filledRows} guess${filledRows > 1 ? "es" : ""}!` : `Word was: ${gameWord ?? "?"}`
              : `${filledRows}/6 guesses used`}
          </p>
        </div>
        {!gameOver && <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />}
      </div>
    );
  }

  return (
    <Card className="relative overflow-hidden border-0 shadow-xl bg-white">
      <div className="h-2 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-600" />

      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl shadow-lg bg-gradient-to-br from-indigo-500 to-violet-600">
              <span className="text-white font-black text-sm tracking-tight">WORD</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-slate-900">Word Puzzle</span>
                {!gameOver && (
                  <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100 font-bold">
                    up to +{pointsSchedule[1]} pts
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge className={cn("text-xs", diffConfig.color)}>{diffConfig.label}</Badge>
                {puzzle.category && (
                  <Badge variant="outline" className="text-xs text-slate-500">{puzzle.category}</Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-slate-400">
              <Users className="h-3.5 w-3.5" />
              <span className="text-xs">{solvedCount}/{participantCount}</span>
            </div>
            <button
              onClick={() => setShowHelp(h => !h)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              How to play
            </button>
          </div>
        </div>

        {/* How to play panel */}
        {showHelp && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3 text-sm">
            <p className="font-bold text-slate-800">How to play Word Puzzle</p>
            <p className="text-slate-600">Guess the hidden <span className="font-bold">5-letter word</span> in 6 tries.</p>
            <ul className="space-y-1.5 text-slate-600">
              <li>• Type any 5-letter word using the keyboard below (or your physical keyboard)</li>
              <li>• Press <span className="font-bold">ENTER</span> to submit your guess</li>
              <li>• Press <span className="font-bold">⌫</span> to delete a letter</li>
            </ul>
            <div className="space-y-1.5">
              <p className="font-semibold text-slate-700">After each guess, tiles change colour:</p>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-green-500 text-white text-xs font-black">A</div>
                <span className="text-slate-600"><span className="font-bold text-green-700">Green</span> — correct letter, correct position</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500 text-white text-xs font-black">B</div>
                <span className="text-slate-600"><span className="font-bold text-amber-700">Yellow</span> — letter is in the word, but wrong position</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-500 text-white text-xs font-black">C</div>
                <span className="text-slate-600"><span className="font-bold text-slate-600">Grey</span> — letter is not in the word at all</span>
              </div>
            </div>
            <p className="text-xs text-slate-400">💡 The hint above helps you narrow down the theme (e.g. "HR Terms")</p>
          </div>
        )}

        {/* Hint */}
        {puzzle.hint && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
            <span className="text-amber-500 text-sm">💡</span>
            <span className="text-xs text-amber-800 font-medium">{puzzle.hint}</span>
          </div>
        )}

        {/* 6×5 Board */}
        <div ref={boardRef} className="flex flex-col items-center gap-1.5">
          {Array(6).fill(null).map((_, rowIdx) => {
            const guessResult = localGuessResults[rowIdx];
            const isCurrentRow = !gameOver && rowIdx === filledRows;
            const isRevealing = revealRow === rowIdx;

            return (
              <div
                key={rowIdx}
                className={cn(
                  "flex gap-1.5",
                  isCurrentRow && shake && "animate-[shake_0.5s_ease-in-out]"
                )}
              >
                {Array(5).fill(null).map((_, colIdx) => {
                  let letter = "";
                  let state: LetterState = "empty";

                  if (guessResult) {
                    letter = guessResult.result[colIdx].letter;
                    state = guessResult.result[colIdx].state;
                  } else if (isCurrentRow) {
                    letter = currentGuess[colIdx] ?? "";
                    state = letter ? "tbd" : "empty";
                  }

                  return (
                    <div
                      key={colIdx}
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-lg border-2 text-sm font-black uppercase transition-all duration-300 select-none",
                        TILE_COLORS[state],
                        isRevealing && `[animation-delay:${colIdx * 0.1}s] animate-[flip_0.5s_ease-in-out_forwards]`
                      )}
                    >
                      {letter}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Game over banner */}
        {gameOver && (
          <div className={cn(
            "rounded-xl p-4 space-y-1.5 text-center",
            finalSolved ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"
          )}>
            <div className="flex items-center justify-center gap-2">
              {finalSolved
                ? <><Check className="h-5 w-5 text-green-600" /><span className="font-bold text-green-700">Solved in {filledRows}!</span></>
                : <><X className="h-5 w-5 text-red-500" /><span className="font-bold text-red-700">Better luck tomorrow!</span></>}
            </div>
            {gameWord && !finalSolved && (
              <p className="text-sm text-slate-600">The word was <span className="font-black text-slate-900">{gameWord}</span></p>
            )}
            {finalPoints > 0 && (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 font-bold">
                <Sparkles className="h-3 w-3 mr-1" />+{finalPoints} pts
              </Badge>
            )}
          </div>
        )}

        {/* On-screen keyboard */}
        {!gameOver && (
          <div className="space-y-1.5">
            {KEYBOARD_ROWS.map((row, rIdx) => (
              <div key={rIdx} className="flex justify-center gap-1">
                {row.map((key) => {
                  const state = keyStates[key];
                  const isWide = key === "ENTER" || key === "⌫";
                  return (
                    <button
                      key={key}
                      onClick={() => handleKey(key)}
                      className={cn(
                        "flex items-center justify-center rounded-lg text-xs font-bold uppercase transition-colors h-10 select-none",
                        isWide ? "px-3 min-w-[52px]" : "w-8",
                        state === "correct" ? "bg-green-500 text-white"
                          : state === "present" ? "bg-amber-500 text-white"
                          : state === "absent" ? "bg-slate-400 text-white"
                          : "bg-slate-100 text-slate-800 hover:bg-slate-200"
                      )}
                    >
                      {key === "⌫" ? <Delete className="h-3.5 w-3.5" /> : key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Points schedule */}
        {!gameOver && (
          <div className="flex items-center justify-between gap-1 flex-wrap">
            <span className="text-xs text-slate-400 font-medium">Points by guess:</span>
            <div className="flex gap-1">
              {[1,2,3,4,5,6].map(n => (
                <div key={n} className={cn(
                  "flex flex-col items-center rounded-lg px-1.5 py-0.5",
                  filledRows + 1 === n ? "bg-indigo-100" : "bg-slate-50"
                )}>
                  <span className="text-[9px] text-slate-400">{n}</span>
                  <span className={cn("text-xs font-bold", filledRows + 1 === n ? "text-indigo-600" : "text-slate-500")}>
                    {pointsSchedule[n] ?? 2}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default WordPuzzle;
