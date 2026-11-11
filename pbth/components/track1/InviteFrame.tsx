import React from 'react';
import { Button, Glass, Icon, Screen, TeamMark, teamPaint } from '../../ui';
import './invite-frame.css';

// Общий каркас экранов приглашения и заявки (`/invite/:token`, `/join/:code`):
// знак продукта сверху, стеклянная панель, знак команды, заголовок. Человек
// ещё не в приложении, поэтому нижней панели нет.

export const InviteFrame: React.FC<{ teamId?: string | null; children: React.ReactNode }> = ({ teamId, children }) => (
  <Screen className="pbth-invite-screen" paints={teamId ? [teamPaint(teamId)] : undefined}>
    <div className="pbth-invite__brand">
      <Icon name="hexagon" size={24} />
      <span className="pbth-invite__brand-name">Paintball TeamHub</span>
    </div>
    <Glass layer={1} className="pbth-invite__panel">
      {children}
    </Glass>
  </Screen>
);

export const InviteHero: React.FC<{
  team?: { id: string; name: string; shortCode?: string } | null;
  /** Отметка на знаке: заявка отправлена. */
  checked?: boolean;
  title: React.ReactNode;
  children?: React.ReactNode;
}> = ({ team, checked, title, children }) => (
  <div className="pbth-invite__hero">
    {team ? (
      <span className="pbth-invite__mark">
        <TeamMark teamId={team.id} name={team.name} code={team.shortCode} size={96} />
        {checked ? (
          <span className="pbth-invite__check">
            <Icon name="check" size={20} />
          </span>
        ) : null}
      </span>
    ) : null}
    <h1 className="pbth-invite__title">{title}</h1>
    {children ? <p className="pbth-invite__text">{children}</p> : null}
  </div>
);

export const InviteActions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pbth-invite__actions">{children}</div>
);

export const InviteNotNow: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button variant="ghost" block onClick={onClick}>
    Не сейчас
  </Button>
);
