import React from 'react';
import { Loader2 } from 'lucide-react';

/** Загрузка во весь экран — до входа и при первом открытии. */
export const ScreenLoader: React.FC = () => (
  <div className="min-h-screen bg-pb-background flex items-center justify-center text-white">
    <Loader2 className="animate-spin text-pb-primary" size={48} />
  </div>
);

/** Загрузка внутри оболочки: шапка и нижняя навигация остаются на месте. */
export const ContentLoader: React.FC = () => (
  <div className="flex items-center justify-center py-24 text-white">
    <Loader2 className="animate-spin text-pb-primary" size={36} />
  </div>
);
