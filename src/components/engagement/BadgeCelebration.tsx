import { useEffect, useState } from "react";
import Confetti from "react-confetti";
import { Award, Share2, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BadgeCelebrationProps {
  isOpen: boolean;
  onClose: () => void;
  badge: {
    badge_name: string;
    badge_icon: string | null;
    badge_description: string | null;
    badge_category: string;
    points_value: number;
  };
}

const categoryColors = {
  performance: "from-amber-400 to-yellow-500",
  activity: "from-blue-400 to-indigo-500",
  tenure: "from-purple-400 to-pink-500",
  social: "from-green-400 to-emerald-500",
};

export function BadgeCelebration({ isOpen, onClose, badge }: BadgeCelebrationProps) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (isOpen) {
      setShowConfetti(true);
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });

      // Stop confetti after 5 seconds
      const timer = setTimeout(() => setShowConfetti(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const gradientClass = categoryColors[badge.badge_category as keyof typeof categoryColors] || "from-slate-400 to-gray-500";

  return (
    <>
      {showConfetti && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          recycle={false}
          numberOfPieces={500}
          gravity={0.3}
        />
      )}

      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md p-0 overflow-hidden border-0">
          <div className="relative bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 p-8 text-white">
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Celebration Header */}
            <div className="text-center space-y-4">
              <div className="inline-block animate-bounce">
                <div className="text-6xl mb-4">🎉</div>
              </div>

              <h2 className="text-3xl font-bold tracking-tight">
                Congratulations!
              </h2>

              <p className="text-white/90 text-lg">
                You've earned a new badge!
              </p>
            </div>

            {/* Badge Display */}
            <div className="mt-8 flex justify-center">
              <div className="relative">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-white/30 rounded-full blur-2xl scale-150 animate-pulse" />

                {/* Badge */}
                <div
                  className={cn(
                    "relative h-32 w-32 rounded-full flex items-center justify-center shadow-2xl",
                    "bg-gradient-to-br border-4 border-white/50",
                    "animate-[spin_3s_ease-in-out]",
                    gradientClass
                  )}
                  style={{
                    animationIterationCount: 1,
                  }}
                >
                  {badge.badge_icon ? (
                    <span className="text-6xl">{badge.badge_icon}</span>
                  ) : (
                    <Award className="h-16 w-16 text-white" />
                  )}

                  {/* Sparkles */}
                  <div className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-yellow-300 animate-ping" />
                  <div className="absolute -bottom-2 -left-2 h-4 w-4 rounded-full bg-pink-300 animate-ping animation-delay-500" />
                </div>
              </div>
            </div>

            {/* Badge Info */}
            <div className="mt-8 text-center space-y-2">
              <h3 className="text-2xl font-bold">{badge.badge_name}</h3>
              {badge.badge_description && (
                <p className="text-white/80 text-sm max-w-sm mx-auto">
                  {badge.badge_description}
                </p>
              )}
              <div className="inline-block bg-white/20 rounded-full px-4 py-2 mt-4">
                <p className="text-sm font-semibold">
                  +{badge.points_value} Points Earned
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex gap-3">
              <Button
                onClick={onClose}
                className="flex-1 bg-white text-purple-600 hover:bg-white/90"
              >
                Continue
              </Button>
              <Button
                variant="outline"
                className="bg-white/20 border-white/30 text-white hover:bg-white/30"
              >
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
