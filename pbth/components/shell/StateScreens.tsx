import React from 'react';

// Экраны состояний оболочки: нет команды, режим владельца, чужая команда в
// адресе, запись не найдена. Вид — как у прежних экранов App.tsx.

const Frame: React.FC<{ children: React.ReactNode; fullScreen?: boolean }> = ({ children, fullScreen = true }) => (
  <div
    className={`${fullScreen ? 'min-h-screen' : 'py-24'} bg-pb-background flex items-center justify-center text-white px-6`}
  >
    <div className="text-center max-w-sm">{children}</div>
  </div>
);

const primary = 'bg-pb-primary text-pb-background px-5 py-3 rounded-xl font-bold';
const secondary = 'bg-white/10 text-white px-5 py-3 rounded-xl font-bold';

export const NoTeamScreen: React.FC<{
  userName?: string;
  onboardingRequired: boolean;
  onLogout: () => void;
}> = ({ userName, onboardingRequired, onLogout }) => (
  <Frame>
    <div className="text-2xl font-bold mb-3">Ты вошёл</div>
    {onboardingRequired && (
      <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-left text-sm text-amber-100">
        Профиль создан по данным Telegram. Следующий шаг — вступить в команду по ссылке-приглашению.
      </div>
    )}
    <p className="text-pb-subtext mb-3">{userName ? `${userName}, ты` : 'Ты'} пока не состоишь ни в одной команде.</p>
    <p className="text-pb-subtext mb-6">Попроси капитана прислать ссылку-приглашение и открой её.</p>
    <button onClick={onLogout} className={primary}>
      Выйти
    </button>
  </Frame>
);

export const AdminModeScreen: React.FC<{
  onOpenAdmin: () => void;
  onSwitchToUser: () => void;
  onLogout: () => void;
}> = ({ onOpenAdmin, onSwitchToUser, onLogout }) => (
  <Frame>
    <div className="text-xl font-bold mb-3">Включён режим владельца</div>
    <p className="text-pb-subtext mb-6">Экраны владельца платформы открываются в консоли.</p>
    <div className="flex flex-col gap-3">
      <button onClick={onOpenAdmin} className={primary}>
        Открыть консоль
      </button>
      <button onClick={onSwitchToUser} className={secondary}>
        Открыть приложение команды
      </button>
      <button onClick={onLogout} className={secondary}>
        Выйти
      </button>
    </div>
  </Frame>
);

export const DataUnavailableScreen: React.FC<{ onRetry: () => void; onLogin: () => void }> = ({ onRetry, onLogin }) => (
  <Frame>
    <div className="text-xl font-bold mb-3">Данные команды не загрузились</div>
    <p className="text-pb-subtext mb-6">Проверь связь и попробуй ещё раз. Если не поможет — войди заново.</p>
    <div className="flex flex-col gap-3">
      <button onClick={onRetry} className={primary}>
        Обновить
      </button>
      <button onClick={onLogin} className={secondary}>
        Перейти ко входу
      </button>
    </div>
  </Frame>
);

export const TeamForbiddenScreen: React.FC<{ code: string; onOpenOwn: () => void }> = ({ code, onOpenOwn }) => (
  <Frame fullScreen={false}>
    <div className="text-xl font-bold mb-3">Нет доступа к команде</div>
    <p className="text-pb-subtext mb-6">
      Ты не состоишь в команде «{code.toUpperCase()}». Попроси её капитана прислать ссылку-приглашение.
    </p>
    <button onClick={onOpenOwn} className={primary}>
      Открыть мою команду
    </button>
  </Frame>
);

export const NotFoundScreen: React.FC<{ title: string; text: string; actionLabel: string; onAction: () => void }> = ({
  title,
  text,
  actionLabel,
  onAction,
}) => (
  <Frame fullScreen={false}>
    <div className="text-xl font-bold mb-3">{title}</div>
    <p className="text-pb-subtext mb-6">{text}</p>
    <button onClick={onAction} className={primary}>
      {actionLabel}
    </button>
  </Frame>
);
