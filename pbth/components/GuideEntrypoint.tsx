import React from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import { guidePathForRole } from "../lib/guide-access";
import { Role } from "../types";

type GuideEntrypointProps = {
  role: Role | null | undefined;
};

export const GuideEntrypoint: React.FC<GuideEntrypointProps> = ({ role }) => {
  if (role == null) return null;

  return (
    <a
      href={guidePathForRole(role)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Открыть инструкцию по работе с PaintBall Team Hub"
      className="w-full min-h-[44px] bg-pb-surface border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-3 hover:bg-white/5 transition-colors active:scale-[0.99] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pb-primary focus-visible:ring-offset-2 focus-visible:ring-offset-pb-background"
    >
      <span className="flex flex-1 min-w-0 items-center gap-3">
        <span className="w-11 h-11 rounded-xl bg-pb-primary/15 flex items-center justify-center flex-shrink-0">
          <BookOpen aria-hidden="true" size={22} className="text-pb-primary" strokeWidth={2.5} />
        </span>
        <span className="min-w-0">
          <span className="block text-white font-bold text-sm">Как пользоваться</span>
          <span className="block text-pb-subtext text-xs">Пошаговая инструкция для вашей роли</span>
        </span>
      </span>
      <ArrowRight aria-hidden="true" size={18} className="text-pb-primary flex-shrink-0" />
    </a>
  );
};
